import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { claude, textOf, toolUseOf } from "@/lib/llm";
import { retrieve, formatSources } from "@/lib/rag";

// Claude starts its reply with this marker when the sources can't answer the question.
// The route strips it and sets refused: true, so callers never have to guess from wording.
const NOT_COVERED = "NOT_COVERED:";

const SYSTEM = `You are SiteShift, an assistant for Sitecore developers and content authors.
Answer ONLY from the provided sources. Cite every claim with its source number like [1] or [2][3].
If the sources don't contain the information needed to answer, start your reply with exactly ${NOT_COVERED}
then briefly say what's missing and what to look up. Never invent APIs or settings.
If the question rests on a false premise, correct it without the marker and cite what the sources do say.
If the user asks you to create, draft, or add a page or content item, call the create_sitecore_item tool
with a complete, realistic draft instead of describing it in prose.`;

const TOOLS = [
  {
    name: "create_sitecore_item",
    description:
      "Draft a new Sitecore content item for review. Use when the user asks to create or draft a page/content item. The draft is shown to the user; it is not saved to Sitecore.",
    input_schema: {
      type: "object",
      properties: {
        itemName: { type: "string", description: "Item name, no spaces (e.g. 'spring-open-house')" },
        parentPath: { type: "string", description: "Content tree path, e.g. /sitecore/content/Site/Home/Events" },
        templateName: { type: "string", description: "Template to base the item on, e.g. 'Event Page'" },
        fields: {
          type: "object",
          description: "Field name -> value. Rich Text fields may contain simple HTML.",
          additionalProperties: { type: "string" },
        },
        rationale: { type: "string", description: "One or two sentences on template/placement choices" },
      },
      required: ["itemName", "parentPath", "templateName", "fields"],
    },
  },
];

type CitationCheck = { valid: number[]; invalid: number[]; uncited: boolean };

/**
 * Find [n] citations in prose (skipping code, where [0] is usually array indexing),
 * check each against the number of sources, and strip any that point nowhere.
 */
function validateCitations(answer: string, sourceCount: number) {
  const valid = new Set<number>();
  const invalid = new Set<number>();

  // Odd indices are code (```blocks``` or `inline`); even indices are prose.
  const parts = answer.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  const cleaned = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/\[(\d+)\]/g, (match, digits) => {
        const n = Number(digits);
        if (n >= 1 && n <= sourceCount) {
          valid.add(n);
          return match;
        }
        invalid.add(n);
        return ""; // never show the user a citation that points nowhere
      });
    })
    .join("");

  return {
    answer: cleaned,
    valid: [...valid].sort((a, b) => a - b),
    invalid: [...invalid].sort((a, b) => a - b),
  };
}

export async function POST(req: Request) {
  try {
    // Rate limit first, before any retrieval or Claude call can spend money.
    const { env } = await getCloudflareContext({ async: true });
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.ASK_LIMITER.limit({ key: ip });
    if (!success) {
      return NextResponse.json({ error: "Too many questions; please wait a minute." }, { status: 429 });
    }

    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

    const sources = await retrieve(question);

    // Deterministic refusal #1: nothing relevant was retrieved, so don't call Claude at all.
    if (sources.length === 0) {
      return NextResponse.json({
        answer: "The indexed docs don't cover this, so I won't guess. Try rephrasing, or add a relevant doc to the index.",
        draft: null,
        sources: [],
        refused: true,
        refusal_reason: "no_sources",
        citations: { valid: [], invalid: [], uncited: false } satisfies CitationCheck,
      });
    }

    const r = await claude({
      system: SYSTEM,
      tools: TOOLS,
      messages: [{ role: "user", content: `${formatSources(sources)}\n\nQuestion: ${question}` }],
    });

    const draft = toolUseOf(r, "create_sitecore_item")?.input ?? null;
    const raw = (textOf(r) || "").trimStart();

    // Deterministic refusal #2: Claude used the marker, so we set the flag in code.
    const refused = !draft && raw.startsWith(NOT_COVERED);
    let answer = refused ? raw.slice(NOT_COVERED.length).trim() : raw;
    if (!answer && draft) answer = "Here's a draft item for review.";

    // Citation validation, done in code instead of trusting the model.
    const checked = validateCitations(answer, sources.length);
    answer = checked.answer;
    const citations: CitationCheck = {
      valid: checked.valid,
      invalid: checked.invalid,
      uncited: !refused && !draft && checked.valid.length === 0,
    };

    return NextResponse.json({
      answer,
      draft,
      refused,
      refusal_reason: refused ? "model_not_covered" : null,
      citations,
      sources: sources.map(({ title, url, score }, i) => ({
        n: i + 1,
        title,
        url,
        score: +score.toFixed(3),
        cited: checked.valid.includes(i + 1),
      })),
      usage: r.usage,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
