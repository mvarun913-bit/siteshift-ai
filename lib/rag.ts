import { getCloudflareContext } from "@opennextjs/cloudflare";

// Must match the model used in ingest/ingest.py (768 dimensions).
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export type Source = { id: string; title: string; url: string; text: string; score: number };

/**
 * Retrieve the most relevant chunks for a query.
 *
 * 1. Ask Vectorize for more candidates than we need (candidateK).
 * 2. Drop anything below minScore.
 * 3. Keep at most maxPerDoc chunks from any one document, so a single
 *    page can't crowd out other relevant sources.
 * 4. Return the best topK that survive.
 */
export async function retrieve(
  query: string,
  topK = 8,
  minScore = 0.55,
  maxPerDoc = 3,
  candidateK = 20, // Vectorize's max topK when returning metadata
): Promise<Source[]> {
  const { env } = await getCloudflareContext({ async: true });
  const emb = (await env.AI.run(EMBED_MODEL, { text: [query] })) as { data: number[][] };
  const res = await env.VECTORIZE.query(emb.data[0], { topK: candidateK, returnMetadata: "all" });

  const perDoc = new Map<string, number>();
  const picked: Source[] = [];

  // Matches come back sorted by score, highest first.
  for (const m of res.matches) {
    if (m.score < minScore) continue;

    const source: Source = {
      id: m.id,
      score: m.score,
      title: String(m.metadata?.title ?? "Untitled"),
      url: String(m.metadata?.url ?? ""),
      text: String(m.metadata?.text ?? ""),
    };

    // Group by URL; fall back to title for docs without a URL (your conventions doc).
    const docKey = source.url || source.title;
    const count = perDoc.get(docKey) ?? 0;
    if (count >= maxPerDoc) continue;

    perDoc.set(docKey, count + 1);
    picked.push(source);
    if (picked.length >= topK) break;
  }

  return picked;
}

/** Numbered context block the model cites as [1], [2], ... */
export const formatSources = (sources: Source[]) =>
  sources.length
    ? sources.map((s, i) => `<source id="${i + 1}" title="${s.title}" url="${s.url}">\n${s.text}\n</source>`).join("\n\n")
    : "<no_sources/>";
