import { NextResponse } from "next/server";
import { claude, textOf, toolUseOf } from "@/lib/llm";
import { retrieve, formatSources } from "@/lib/rag";

const SYSTEM = `You are SiteShift, an assistant for Sitecore developers and content authors.
Answer ONLY from the provided sources. Cite every claim with its source number like [1] or [2][3].
If the sources don't cover the question, say so plainly and suggest what to look up. Never invent APIs or settings.
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

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

    const sources = await retrieve(question);
    const r = await claude({
      system: SYSTEM,
      tools: TOOLS,
      messages: [{ role: "user", content: `${formatSources(sources)}\n\nQuestion: ${question}` }],
    });

    const draft = toolUseOf(r, "create_sitecore_item")?.input ?? null;
    return NextResponse.json({
      answer: textOf(r) || (draft ? "Here's a draft item for review." : ""),
      draft,
      sources: sources.map(({ title, url, score }) => ({ title, url, score: +score.toFixed(3) })),
      usage: r.usage,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
