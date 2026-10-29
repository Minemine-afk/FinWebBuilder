"use client";

import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/github";

const KIND: Record<RunSummary["kind"], string> = { build: "Building", refine: "Refining", remove: "Removing", plan: "Scoping" };

function elapsed(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}s`;
}

/** The loading progress of any build running now. Nothing shows when the builder is idle. */
export function BuildProgress() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      let busy = false;
      try {
        const res = await fetch("/api/builds", { cache: "no-store" });
        const data = (await res.json()) as { runs: RunSummary[] };
        if (stop) return;
        setRuns(data.runs);
        busy = data.runs.length > 0;
      } catch {
        // Offline or the server is busy: try again on the next tick.
      }
      if (!stop) timer = setTimeout(load, busy ? 5000 : 15000);
    }
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  if (!runs.length) return null;
  return (
    <section className="mt-10" aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="text-xl font-semibold">Build in progress</h2>
      <ul className="mt-3 grid gap-3">
        {runs.map((r) => {
          const pct = Math.max(6, Math.round(r.progress * 100));
          return (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-4">
              <p className="font-medium">
                {KIND[r.kind]} <span className="break-words">{r.title}</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${r.title} progress`}>
                <div className="h-full rounded-full bg-accent-fill transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted" role="status">
                {r.step} · {elapsed(r.startedAt, now)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
