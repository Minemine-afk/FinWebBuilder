"use client";

import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/github";

const KIND: Record<RunSummary["kind"], string> = { build: "Building", refine: "Refining", remove: "Removing" };

function minutes(from: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(from)) / 60000));
  return m < 1 ? "just started" : `${m} min`;
}

/** What the builder is doing right now and has done lately, refreshed while a run is going. */
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
        setNow(Date.now());
        busy = data.runs.some((r) => r.state === "queued" || r.state === "running");
      } catch {
        // Offline or the server is busy: try again on the slow schedule.
      }
      if (!stop) timer = setTimeout(load, busy ? 8000 : 30000);
    }
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  if (!runs.length) return null;
  return (
    <section className="mt-10" aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="text-xl font-semibold">Builder activity</h2>
      <ul className="mt-3 grid gap-3">
        {runs.map((r) => {
          const active = r.state === "queued" || r.state === "running";
          return (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {active ? KIND[r.kind] : r.kind === "remove" ? "Removal of" : r.kind === "refine" ? "Refinement of" : "Build of"} <span className="break-words">{r.title}</span>
                </p>
                <a className="text-xs text-accent underline" href={r.url} target="_blank" rel="noreferrer">Details</a>
              </div>
              {active ? (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)} aria-label={`${r.title} progress`}>
                    <div className="h-full rounded-full bg-accent-fill transition-all" style={{ width: `${Math.max(6, Math.round(r.progress * 100))}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-muted" role="status">
                    {r.step} · {minutes(r.startedAt, now)}
                  </p>
                </>
              ) : (
                <p className={`mt-1 text-sm ${r.state === "failed" ? "text-warn-fg" : "text-muted"}`}>{r.step}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
