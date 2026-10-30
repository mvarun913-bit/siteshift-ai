"""
Chunk docs -> embed with Workers AI -> upsert into Cloudflare Vectorize.

Sources:
  data/docs/**/*.md|.txt|.html   local files (your conventions, notes, saved doc pages)
  data/urls.txt                  one public URL per line (e.g. Sitecore doc pages)

Usage:
  pip install -r ingest/requirements.txt
  python ingest/ingest.py            # ingest everything
  python ingest/ingest.py --dry-run  # just show chunk counts
"""
import argparse, hashlib, json, os, pathlib, re, sys, time
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / "scripts.env")
ROOT = pathlib.Path(__file__).resolve().parent.parent
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
TOKEN = os.environ.get("CF_API_TOKEN", "")
INDEX = os.environ.get("VECTORIZE_INDEX", "siteshift-docs")
EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"  # 768 dims; must match lib/rag.ts
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

CHUNK_CHARS, OVERLAP = 1200, 200


def html_to_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    title = (soup.title.string or "").strip() if soup.title else ""
    main = soup.find("main") or soup.find("article") or soup.body or soup
    return title, re.sub(r"\n{3,}", "\n\n", main.get_text("\n")).strip()


def load_documents():
    docs = []
    for p in sorted((ROOT / "data" / "docs").rglob("*")):
        if p.suffix.lower() not in {".md", ".txt", ".html", ".htm"}:
            continue
        raw = p.read_text(encoding="utf-8", errors="ignore")
        if p.suffix.lower() in {".html", ".htm"}:
            title, text = html_to_text(raw)
        else:
            m = re.search(r"^#\s+(.+)$", raw, re.M)
            title, text = (m.group(1).strip() if m else p.stem), raw
        docs.append({"title": title or p.stem, "url": "", "text": text})

    urls_file = ROOT / "data" / "urls.txt"
    if urls_file.exists():
        for url in [u.strip() for u in urls_file.read_text().splitlines() if u.strip() and not u.startswith("#")]:
            try:
                r = requests.get(url, timeout=20, headers={"User-Agent": "siteshift-ingest/0.1"})
                r.raise_for_status()
                title, text = html_to_text(r.text)
                docs.append({"title": title or url, "url": url, "text": text})
                time.sleep(0.5)  # be polite
            except Exception as e:
                print(f"  ! skipped {url}: {e}", file=sys.stderr)
    return docs


def chunk(text: str):
    """Paragraph-aware chunks of ~CHUNK_CHARS with OVERLAP carried over."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if len(cur) + len(p) + 2 <= CHUNK_CHARS:
            cur = f"{cur}\n\n{p}" if cur else p
            continue
        if cur:
            chunks.append(cur)
        while len(p) > CHUNK_CHARS:  # split very long paragraphs
            chunks.append(p[:CHUNK_CHARS])
            p = p[CHUNK_CHARS - OVERLAP:]
        cur = (chunks[-1][-OVERLAP:] + "\n\n" + p) if chunks else p
    if cur:
        chunks.append(cur)
    return [c for c in chunks if len(c) > 80]


def embed(texts):
    r = requests.post(f"{API}/ai/run/{EMBED_MODEL}", headers=HEADERS, json={"text": texts}, timeout=60)
    r.raise_for_status()
    return r.json()["result"]["data"]


def upsert(vectors):
    body = "\n".join(json.dumps(v) for v in vectors)
    r = requests.post(f"{API}/vectorize/v2/indexes/{INDEX}/upsert",
                      headers={**HEADERS, "Content-Type": "application/x-ndjson"}, data=body, timeout=60)
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.dry_run and not (ACCOUNT and TOKEN):
        sys.exit("Set CF_ACCOUNT_ID and CF_API_TOKEN in .env")

    records = []
    for d in load_documents():
        pieces = chunk(d["text"])
        print(f"{len(pieces):>4} chunks  {d['title'][:70]}")
        for i, c in enumerate(pieces):
            vid = hashlib.sha1(f"{d['url'] or d['title']}#{i}".encode()).hexdigest()
            records.append({"id": vid, "text": c, "title": d["title"], "url": d["url"]})

    print(f"\nTotal chunks: {len(records)}")
    if args.dry_run or not records:
        return

    BATCH = 50
    for start in range(0, len(records), BATCH):
        batch = records[start:start + BATCH]
        vecs = embed([r["text"] for r in batch])
        upsert([{"id": r["id"], "values": v,
                 "metadata": {"title": r["title"], "url": r["url"], "text": r["text"][:2000]}}
                for r, v in zip(batch, vecs)])
        print(f"  upserted {start + len(batch)}/{len(records)}")
    print("Done. Vectorize indexes asynchronously; give it ~30s before querying.")


if __name__ == "__main__":
    main()
