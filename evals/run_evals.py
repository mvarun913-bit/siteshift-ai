"""
Tiny eval harness. Hits the running app and scores:
  ask:     required keywords present, citations present/absent as expected, draft tool called when expected
  convert: output has no inline styles, no 'Click here', has alt handling and a default/named export
Writes evals/results.md for your README.

Usage: BASE_URL=http://localhost:3000 python evals/run_evals.py
"""
import json, os, pathlib, re, time
import requests
from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / "scripts.env")
BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
HERE = pathlib.Path(__file__).parent

LEGACY = """<div class="promo" style="padding:20px"><asp:Image ID="img" runat="server" ImageUrl="~/a.jpg" />
<font size="5"><b><asp:Literal ID="t" runat="server" /></b></font><a href="/x" onclick="track()">Click here</a></div>"""


def run_ask(case):
    t = time.time()
    r = requests.post(f"{BASE}/api/ask", json={"question": case["question"]}, timeout=120).json()
    ans = (r.get("answer") or "").lower()
    checks = {}
    for kw in case.get("must_include", []):
        checks[f"has '{kw}'"] = kw.lower() in ans
    if "expect_citation" in case:
        checks["citation as expected"] = bool(re.search(r"\[\d+\]", ans)) == case["expect_citation"]
    if case.get("expect_draft"):
        checks["draft tool called"] = bool(r.get("draft"))
    return checks, time.time() - t


def run_convert():
    t = time.time()
    r = requests.post(f"{BASE}/api/convert", json={"markup": LEGACY, "target": "sitecore"}, timeout=180).json()
    tsx = r.get("tsx", "")
    checks = {
        "no inline style": "style=" not in tsx,
        "no 'Click here'": "click here" not in tsx.lower(),
        "no runat": "runat" not in tsx,
        "has export": "export" in tsx,
        "template has fields": len(r.get("sitecoreTemplate", {}).get("fields", [])) >= 2,
        "lists a11y fixes": len(r.get("accessibilityFixes", [])) >= 1,
    }
    return checks, time.time() - t


def main():
    rows, passed, total = [], 0, 0
    for line in (HERE / "ask_cases.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        checks, secs = run_ask(case)
        ok = all(checks.values())
        passed += ok; total += 1
        rows.append(("ask", case["question"][:60], ok, checks, secs))
    checks, secs = run_convert()
    ok = all(checks.values()); passed += ok; total += 1
    rows.append(("convert", "promo .ascx sample", ok, checks, secs))

    lines = [f"# Eval results\n\n**{passed}/{total} passed** against `{BASE}`\n",
             "| Mode | Case | Result | Failed checks | Seconds |", "|---|---|---|---|---|"]
    for mode, name, ok, checks, secs in rows:
        failed = ", ".join(k for k, v in checks.items() if not v) or "-"
        lines.append(f"| {mode} | {name} | {'pass' if ok else 'fail'} | {failed} | {secs:.1f} |")
        print(f"{'PASS' if ok else 'FAIL'}  [{mode}] {name}  {'' if ok else '-> ' + failed}")
    (HERE / "results.md").write_text("\n".join(lines) + "\n")
    print(f"\n{passed}/{total} passed. Wrote evals/results.md")


if __name__ == "__main__":
    main()
