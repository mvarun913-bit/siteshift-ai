import { NextResponse } from "next/server";
import { claude, toolUseOf } from "@/lib/llm";
import { retrieve, formatSources } from "@/lib/rag";

type Target = "plain" | "sitecore";

const system = (target: Target) => `You convert legacy markup (ASP.NET WebForms/MVC views, Razor, old Sitecore renderings, plain HTML)
into a single modern Next.js (App Router) React component in TypeScript, styled with Tailwind CSS.
Rules:
- Semantic HTML; fix accessibility to WCAG 2.1 AA (alt text, labels, heading order, link text, landmarks, focus states).
- No inline styles, no jQuery, no runat/server controls; replace server logic with typed props.
- Keep the visual structure recognisable; map old CSS intent to Tailwind utilities.
${
  target === "sitecore"
    ? "- Props are Sitecore fields. Render them with the Sitecore Content SDK field helpers (Text, RichText, Image, Link) from '@sitecore-content-sdk/nextjs' so they stay editable in Pages."
    : "- Props are plain typed values (strings, { src, alt }, { href, text })."
}
- Use the provided sources for team conventions and Sitecore guidance when relevant.
Always respond by calling emit_component.`;

const TOOLS = [
  {
    name: "emit_component",
    description: "Return the converted component and its content model.",
    input_schema: {
      type: "object",
      properties: {
        componentName: { type: "string", description: "PascalCase name" },
        tsx: { type: "string", description: "Complete .tsx file contents" },
        sitecoreTemplate: {
          type: "object",
          properties: {
            name: { type: "string" },
            fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["Single-Line Text", "Multi-Line Text", "Rich Text", "Image", "General Link", "Checkbox", "Date", "Number"],
                  },
                },
                required: ["name", "type"],
              },
            },
          },
          required: ["name", "fields"],
        },
        accessibilityFixes: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" }, description: "Assumptions and follow-ups for a developer" },
      },
      required: ["componentName", "tsx", "sitecoreTemplate", "accessibilityFixes", "notes"],
    },
  },
];

export async function POST(req: Request) {
  try {
    const { markup, target = "sitecore" } = (await req.json()) as { markup?: string; target?: Target };
    if (!markup?.trim()) return NextResponse.json({ error: "Paste some legacy markup first." }, { status: 400 });
    if (markup.length > 20000) return NextResponse.json({ error: "Markup is over 20,000 characters. Convert one rendering at a time." }, { status: 400 });

    const sources = await retrieve(`Next.js headless component conventions for: ${markup.slice(0, 600)}`, 4);
    const r = await claude({
      system: system(target),
      tools: TOOLS,
      tool_choice: { type: "tool", name: "emit_component" },
      max_tokens: 8000,
      messages: [{ role: "user", content: `${formatSources(sources)}\n\n<legacy_markup>\n${markup}\n</legacy_markup>` }],
    });

    const out = toolUseOf(r, "emit_component");
    if (!out) return NextResponse.json({ error: "The model didn't return a component. Try again." }, { status: 502 });
    return NextResponse.json({ ...out.input, sources: sources.map(({ title, url }) => ({ title, url })), usage: r.usage });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
