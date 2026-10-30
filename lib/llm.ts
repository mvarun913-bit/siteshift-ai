import { getCloudflareContext } from "@opennextjs/cloudflare";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ClaudeResponse = {
  content: Array<TextBlock | ToolUseBlock>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
};

/** Thin wrapper around the Messages API. Pass system, messages, tools, tool_choice, etc. */
export async function claude(body: Record<string, unknown>): Promise<ClaudeResponse> {
  const { env } = await getCloudflareContext({ async: true });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: env.CLAUDE_MODEL ?? "claude-sonnet-5-5", max_tokens: 4096, ...body }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return (await res.json()) as ClaudeResponse;
}

export const textOf = (r: ClaudeResponse) =>
  r.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

export const toolUseOf = (r: ClaudeResponse, name: string) =>
  r.content.find((b): b is ToolUseBlock => b.type === "tool_use" && b.name === name);
