"use client";
import { useState } from "react";

type Mode = "ask" | "convert";
type SourceRef = { title: string; url: string; score?: number };
type AskResult = { answer: string; draft: Record<string, unknown> | null; sources: SourceRef[] };
type ConvertResult = {
  componentName: string;
  tsx: string;
  sitecoreTemplate: { name: string; fields: { name: string; type: string }[] };
  accessibilityFixes: string[];
  notes: string[];
  sources: SourceRef[];
};

const SAMPLE_MARKUP = `<div class="promo-box" style="background:#eee;padding:20px">
  <asp:Image ID="imgPromo" runat="server" ImageUrl="~/images/promo.jpg" />
  <font size="5"><b><asp:Literal ID="litTitle" runat="server" /></b></font>
  <div class="promo-text"><asp:Literal ID="litBody" runat="server" /></div>
  <a href="/locations" onclick="trackClick()">Click here</a>
</div>`;

export default function Home() {
  const [mode, setMode] = useState<Mode>("ask");
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">SiteShift AI</h1>
          <p className="mt-1 max-w-xl text-muted">
            Get cited answers about Sitecore, and turn legacy renderings into accessible Next.js components.
          </p>
        </div>
        <div role="tablist" aria-label="Mode" className="inline-flex rounded-md border border-line bg-panel p-1">
          {(["ask", "convert"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${mode === m ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              {m === "ask" ? "Ask" : "Convert markup"}
            </button>
          ))}
        </div>
      </header>
      {mode === "ask" ? <AskPanel /> : <ConvertPanel />}
    </main>
  );
}

function AskPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<AskResult | null>(null);

  async function ask() {
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRes(j);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <div className="flex flex-col gap-3">
        <label htmlFor="q" className="text-sm font-medium">Question</label>
        <textarea id="q" value={q} onChange={(e) => setQ(e.target.value)} rows={6}
          placeholder="How do I make a component editable in Pages? Or: Draft an event page for a spring open house."
          className="rounded-md border border-line bg-panel p-3 text-sm" />
        <button onClick={ask} disabled={busy || !q.trim()}
          className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Searching docs…" : "Ask"}
        </button>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      </div>

      <div aria-live="polite" className="flex flex-col gap-4">
        {!res && !busy && <p className="text-sm text-muted">Answers cite the docs they came from. Ask it to draft a page to see a content item draft.</p>}
        {res && (
          <>
            <article className="whitespace-pre-wrap rounded-md border border-line bg-panel p-4 text-[15px] leading-relaxed">{res.answer}</article>
            {res.draft && (
              <div>
                <h2 className="mb-2 text-sm font-medium">Draft content item (not saved)</h2>
                <pre className="overflow-x-auto rounded-md bg-code p-4 font-mono text-xs">{JSON.stringify(res.draft, null, 2)}</pre>
              </div>
            )}
            <SourceList sources={res.sources} />
          </>
        )}
      </div>
    </section>
  );
}

function ConvertPanel() {
  const [markup, setMarkup] = useState("");
  const [target, setTarget] = useState<"sitecore" | "plain">("sitecore");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<ConvertResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function convert() {
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch("/api/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ markup, target }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRes(j);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="markup" className="text-sm font-medium">Legacy markup</label>
          <button onClick={() => setMarkup(SAMPLE_MARKUP)} className="text-sm text-accent underline-offset-2 hover:underline">Load sample</button>
        </div>
        <textarea id="markup" value={markup} onChange={(e) => setMarkup(e.target.value)} rows={14} spellCheck={false}
          placeholder="Paste an .ascx, .cshtml, or HTML rendering"
          className="rounded-md border border-line bg-panel p-3 font-mono text-xs" />
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Output style</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={target === "sitecore"} onChange={() => setTarget("sitecore")} /> Sitecore field components</label>
          <label className="flex items-center gap-2"><input type="radio" checked={target === "plain"} onChange={() => setTarget("plain")} /> Plain props</label>
        </fieldset>
        <button onClick={convert} disabled={busy || !markup.trim()}
          className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Converting…" : "Convert"}
        </button>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      </div>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-4">
        {!res && !busy && <p className="text-sm text-muted">You'll get a .tsx component, the Sitecore template fields it needs, and the accessibility fixes it made.</p>}
        {res && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">{res.componentName}.tsx</h2>
                <button onClick={() => { navigator.clipboard.writeText(res.tsx); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="text-sm text-accent">{copied ? "Copied" : "Copy code"}</button>
              </div>
              <pre className="max-h-[28rem] overflow-auto rounded-md bg-code p-4 font-mono text-xs leading-relaxed">{res.tsx}</pre>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Template: {res.sitecoreTemplate.name}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {res.sitecoreTemplate.fields.map((f) => (
                    <tr key={f.name} className="border-b border-line"><td className="py-1.5">{f.name}</td><td className="py-1.5 text-muted">{f.type}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Bullets title="Accessibility fixes" items={res.accessibilityFixes} />
            <Bullets title="Notes for review" items={res.notes} />
            <SourceList sources={res.sources} />
          </>
        )}
      </div>
    </section>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  if (!sources?.length) return <p className="text-sm text-muted">No matching docs in the index for this one.</p>;
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium">Sources</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {sources.map((s, i) => (
          <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title}</a> : s.title}
            {s.score !== undefined && <span className="text-muted"> ({s.score})</span>}</li>
        ))}
      </ol>
    </div>
  );
}
