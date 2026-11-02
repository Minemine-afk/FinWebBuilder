"use client";

import { useState } from "react";

export type SidebarCalculator = { id: string; title: string };
export type View = "home" | "setup" | "check";

const RECENT_COUNT = 5;

/** Every search word must appear in the title or the slug, in any order. */
export function matchesSearch(c: SidebarCalculator, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${c.title} ${c.id.replace(/-/g, " ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let at = -1;
  let len = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = w.length;
    }
  }
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warn-bg px-0.5 text-warn-fg">{text.slice(at, at + len)}</mark>
      {text.slice(at + len)}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 4 6 6-6 6" />
    </svg>
  );
}

function Dropdown({ label, open, onToggle, children, id }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode; id: string }) {
  return (
    <div>
      <button type="button" className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-left font-semibold hover:bg-chip" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span>{label}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={id} className="mb-1 ml-2 mt-0.5 border-l-2 border-border pl-2">
          {children}
        </div>
      )}
    </div>
  );
}

function CalcLink({ c, query }: { c: SidebarCalculator; query: string }) {
  return (
    <a href={`/c/${c.id}`} title={c.title} className="block truncate rounded-lg px-2 py-1.5 text-sm hover:bg-chip">
      <Highlight text={c.title} query={query} />
    </a>
  );
}

/** The left sidebar: search, a Claude options dropdown, recent builds, and every calculator in one collapsible section. */
export function Sidebar({ calculators, view, onView }: { calculators: SidebarCalculator[]; view: View; onView: (v: View) => void }) {
  const [query, setQuery] = useState("");
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [existingOpen, setExistingOpen] = useState(false);
  const searching = query.trim().length > 0;
  const hits = calculators.filter((c) => matchesSearch(c, query));
  const recent = searching ? hits : calculators.slice(0, RECENT_COUNT);
  const existing = searching ? hits : calculators;

  return (
    <nav aria-label="Calculators" className="flex flex-col gap-2 p-3 text-[15px]">
      <button type="button" className="px-1 py-1 text-left text-base font-semibold" onClick={() => onView("home")}>
        Finexis calculators
      </button>
      <button type="button" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-accent" onClick={() => onView("home")}>
        <span aria-hidden="true">＋</span> New calculator
      </button>

      <div className="relative">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 4 4" />
        </svg>
        <input type="search" aria-label="Search calculators" placeholder="Search calculators" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-2" />
      </div>

      <Dropdown id="claude-options" label="Claude options" open={claudeOpen} onToggle={() => setClaudeOpen(!claudeOpen)}>
        {([
          ["setup", "Setup: connect Claude", "Paste a token or API key"],
          ["check", "Check Claude link", "Run one tiny test call"],
        ] as const).map(([v, name, hint]) => (
          <button key={v} type="button" className={`block w-full rounded-lg px-2 py-1.5 text-left hover:bg-chip ${view === v ? "bg-chip font-semibold" : ""}`} onClick={() => onView(v)}>
            {name}
            <span className="block text-xs font-normal text-muted">{hint}</span>
          </button>
        ))}
      </Dropdown>

      <div role="status" aria-live="polite">
        <p className="px-1 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">Recent builds</p>
        {recent.map((c) => (
          <CalcLink key={c.id} c={c} query={query} />
        ))}
        {searching && !hits.length && <p className="px-2 py-1.5 text-sm text-muted">No calculators match &ldquo;{query.trim()}&rdquo;.</p>}
        {!searching && !calculators.length && <p className="px-2 py-1.5 text-sm text-muted">Nothing built yet.</p>}
      </div>

      <Dropdown id="existing-calculators" label={`Existing calculators (${searching ? `${hits.length} of ` : ""}${calculators.length})`} open={existingOpen || searching} onToggle={() => setExistingOpen(!existingOpen)}>
        {existing.map((c) => (
          <CalcLink key={c.id} c={c} query={query} />
        ))}
      </Dropdown>
    </nav>
  );
}
