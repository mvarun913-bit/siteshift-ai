"""SiteShift MCP server.

Exposes the SiteShift Vectorize index to any MCP client (Claude Desktop, Claude Code, Cursor...).

  Tool:      search_sitecore_docs(query, top_k)  -> numbered passages with title, url, score, text
  Resource:  siteshift://conventions             -> the team's headless component conventions doc

Runs over stdio: the client starts this script as a subprocess and talks to it over stdin/stdout.
That means NOTHING may be printed to stdout except protocol messages, so logs go to stderr.

Run locally for testing:
  npx @modelcontextprotocol/inspector .venv/bin/python mcp_server/server.py
"""
import logging
import os
import pathlib
import sys

import requests
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

ROOT = pathlib.Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "scripts.env")  # same Cloudflare credentials ingest.py uses

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
TOKEN = os.environ.get("CF_API_TOKEN", "")
INDEX = os.environ.get("VECTORIZE_INDEX", "siteshift-docs")
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Keep these in sync with lib/rag.ts so the app and the MCP server retrieve the same way.
EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"
MIN_SCORE = 0.55
MAX_PER_DOC = 3
CANDIDATES = 20

CONVENTIONS = ROOT / "data" / "docs" / "team-conventions.md"

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("siteshift-mcp")

mcp = FastMCP("siteshift")


def _embed(text: str) -> list:
    r = requests.post(f"{API}/ai/run/{EMBED_MODEL}", headers=HEADERS, json={"text": [text]}, timeout=30)
    r.raise_for_status()
    return r.json()["result"]["data"][0]


def _query(vector: list, top_k: int) -> list:
    r = requests.post(
        f"{API}/vectorize/v2/indexes/{INDEX}/query",
        headers=HEADERS,
        json={"vector": vector, "topK": top_k, "returnMetadata": "all"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["result"]["matches"]


@mcp.tool()
def search_sitecore_docs(query: str, top_k: int = 8) -> list:
    """Search Sitecore developer docs (Content SDK, JSS for Next.js) and the team's headless
    component conventions (accessibility, links, tracking, styling).

    Use this for questions about rendering Sitecore fields, building headless components,
    or the team's coding rules. Returns numbered passages with title, url, similarity score
    and text. Answer only from the passages and cite them by number, e.g. [1]. An empty list
    means the indexed docs don't cover the question.
    """
    if not (ACCOUNT and TOKEN):
        raise ValueError("CF_ACCOUNT_ID and CF_API_TOKEN must be set in scripts.env")

    top_k = max(1, min(top_k, 10))
    matches = _query(_embed(query), CANDIDATES)  # sorted by score, highest first

    per_doc: dict = {}
    passages = []
    for m in matches:
        if m["score"] < MIN_SCORE:
            continue
        md = m.get("metadata") or {}
        title = str(md.get("title", "Untitled"))
        url = str(md.get("url", ""))
        key = url or title  # the conventions doc has no URL
        if per_doc.get(key, 0) >= MAX_PER_DOC:
            continue
        per_doc[key] = per_doc.get(key, 0) + 1
        passages.append({
            "n": len(passages) + 1,
            "title": title,
            "url": url,
            "score": round(m["score"], 3),
            "text": str(md.get("text", "")),
        })
        if len(passages) >= top_k:
            break

    log.info("search_sitecore_docs %r -> %d passages", query, len(passages))
    return passages


@mcp.resource("siteshift://conventions")
def team_conventions() -> str:
    """The team's headless component conventions: accessibility, links, tracking and styling rules."""
    return CONVENTIONS.read_text()


if __name__ == "__main__":
    mcp.run()  # stdio transport by default
