import { getCloudflareContext } from "@opennextjs/cloudflare";

// Must match the model used in ingest/ingest.py (768 dimensions).
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export type Source = { id: string; title: string; url: string; text: string; score: number };

export async function retrieve(query: string, topK = 5, minScore = 0.55): Promise<Source[]> {
  const { env } = await getCloudflareContext({ async: true });
  const emb = (await env.AI.run(EMBED_MODEL, { text: [query] })) as { data: number[][] };
  const res = await env.VECTORIZE.query(emb.data[0], { topK, returnMetadata: "all" });
  return res.matches
    .filter((m) => m.score >= minScore)
    .map((m) => ({
      id: m.id,
      score: m.score,
      title: String(m.metadata?.title ?? "Untitled"),
      url: String(m.metadata?.url ?? ""),
      text: String(m.metadata?.text ?? ""),
    }));
}

/** Numbered context block the model cites as [1], [2], ... */
export const formatSources = (sources: Source[]) =>
  sources.length
    ? sources.map((s, i) => `<source id="${i + 1}" title="${s.title}" url="${s.url}">\n${s.text}\n</source>`).join("\n\n")
    : "<no_sources/>";
