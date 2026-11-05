#!/usr/bin/env python3
"""SiteShift AI eval harness for Ask mode.

Usage (app must be running with `npm run dev`):
  python evals/run_evals.py --tag baseline
  python evals/run_evals.py --tag topk8 --base-url http://localhost:3002

Each run saves a JSON file in evals/results/ so you can compare runs.
Uses only the Python standard library (no pip install needed).
"""
import argparse
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent

# Used only if the API doesn't return refused: true.
REFUSAL_PHRASES = [
    "not covered", "isn't covered", "is not covered", "aren't covered",
    "don't have", "do not have", "doesn't cover", "don't cover", "do not cover",
    "no information", "not in the provided", "not mentioned in the",
    "can't answer", "cannot answer", "not enough information",
]


def load_cases(path):
    cases = []
    for i, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            cases.append(json.loads(line))
        except json.JSONDecodeError as e:
            raise SystemExit(f"Bad JSON on line {i} of {path}: {e}")
    return cases


def ask(base_url, question, timeout=120):
    body = json.dumps({"question": question}).encode()
    req = urllib.request.Request(
        f"{base_url}/api/ask",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data, time.time() - start


def detect_refusal(data):
    if data.get("refused") is True:
        return True, "flag"
    answer = (data.get("answer") or "").lower()
    if any(p in answer for p in REFUSAL_PHRASES):
        return True, "phrase"
    return False, "none"


def first_hit_rank(sources, expected):
    """1-based rank of the first source whose title or URL contains `expected`."""
    expected = expected.lower()
    for rank, s in enumerate(sources, 1):
        haystack = f"{s.get('title', '')} {s.get('url', '')}".lower()
        if expected in haystack:
            return rank
    return None


def check_citations(answer, n_sources):
    cited = [int(n) for n in re.findall(r"\[(\d+)\]", answer)]
    invalid = sorted({n for n in cited if n < 1 or n > n_sources})
    return cited, invalid


def score_case(case, data, k):
    sources = data.get("sources") or []
    answer = data.get("answer") or ""
    refused, how = detect_refusal(data)
    cited, invalid = check_citations(answer, len(sources))

    result = {
        "id": case["id"],
        "question": case["question"],
        "expect_refusal": case.get("expect_refusal", False),
        "refused": refused,
        "refusal_detected_by": how,
        "n_sources": len(sources),
        "n_citations": len(cited),
        "invalid_citations": invalid,
        "answer_preview": answer[:300],
    }

    if case.get("expect_refusal"):
        checks = {"refusal_correct": refused}
    else:
        rank = first_hit_rank(sources[:k], case.get("expected_source", ""))
        missing = [t for t in case.get("must_mention", []) if t.lower() not in answer.lower()]
        result["rank"] = rank
        result["missing_terms"] = missing
        checks = {
            "not_refused": not refused,
            "hit": rank is not None,
            "mentions_ok": not missing,
            "has_citations": len(cited) > 0,
            "citations_valid": not invalid,
        }

    result["checks"] = checks
    result["pass"] = all(checks.values())
    return result


def summarize(results):
    answerable = [r for r in results if not r["expect_refusal"] and "error" not in r]
    refusals = [r for r in results if r["expect_refusal"] and "error" not in r]

    def pct(n, d):
        return round(100 * n / d, 1) if d else None

    hits = sum(1 for r in answerable if r.get("rank"))
    mrr = sum(1 / r["rank"] for r in answerable if r.get("rank")) / len(answerable) if answerable else None

    return {
        "cases": len(results),
        "errors": sum(1 for r in results if "error" in r),
        "pass_rate_pct": pct(sum(1 for r in results if r.get("pass")), len(results)),
        "hit_at_k_pct": pct(hits, len(answerable)),
        "mrr": round(mrr, 3) if mrr is not None else None,
        "refusal_accuracy_pct": pct(sum(1 for r in refusals if r["refused"]), len(refusals)),
        "false_refusals": sum(1 for r in answerable if r["refused"]),
        "mentions_ok_pct": pct(sum(1 for r in answerable if not r.get("missing_terms")), len(answerable)),
        "invalid_citation_cases": sum(1 for r in results if r.get("invalid_citations")),
        "avg_latency_s": round(sum(r.get("latency_s", 0) for r in results) / len(results), 2) if results else None,
        "input_tokens": sum(r.get("input_tokens", 0) for r in results),
        "output_tokens": sum(r.get("output_tokens", 0) for r in results),
    }


def main():
    p = argparse.ArgumentParser(description="Run SiteShift Ask-mode evals")
    p.add_argument("--base-url", default="http://localhost:3002")
    p.add_argument("--cases", default=str(HERE / "ask_cases.jsonl"))
    p.add_argument("--k", type=int, default=8, help="top-k sources to check for a hit")
    p.add_argument("--tag", default="run", help="label for this run, e.g. baseline or topk8")
    args = p.parse_args()

    cases = load_cases(Path(args.cases))
    print(f"Running {len(cases)} cases against {args.base_url} (tag: {args.tag})\n")

    results = []
    for case in cases:
        try:
            data, latency = ask(args.base_url, case["question"])
            r = score_case(case, data, args.k)
            r["latency_s"] = round(latency, 2)
            usage = data.get("usage") or {}
            r["input_tokens"] = usage.get("input_tokens", 0)
            r["output_tokens"] = usage.get("output_tokens", 0)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            r = {"id": case["id"], "question": case["question"],
                 "expect_refusal": case.get("expect_refusal", False),
                 "error": str(e), "pass": False, "checks": {}}
        results.append(r)

        status = "PASS" if r["pass"] else "FAIL"
        failed = [name for name, ok in r["checks"].items() if not ok]
        detail = f"  error: {r['error']}" if "error" in r else (f"  failed: {', '.join(failed)}" if failed else "")
        print(f"{status}  {r['id']:<22}{detail}")

    summary = summarize(results)
    print("\nSummary")
    for key, value in summary.items():
        print(f"  {key:<24}{value}")

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_file = out_dir / f"{stamp}_{args.tag}.json"
    out_file.write_text(json.dumps({
        "tag": args.tag,
        "timestamp": stamp,
        "config": {"base_url": args.base_url, "k": args.k, "cases_file": args.cases},
        "summary": summary,
        "results": results,
    }, indent=2))
    print(f"\nSaved {out_file}")


if __name__ == "__main__":
    main()
