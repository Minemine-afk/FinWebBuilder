"use client";

import { useState } from "react";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "done"; runsUrl: string; message: string } | { kind: "error"; message: string };

async function send(body: Record<string, string>): Promise<Status> {
  try {
    const res = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { kind: "error", message: data.error ?? "Something went wrong." };
    return { kind: "done", runsUrl: data.runsUrl, message: "" };
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "sending") return <p className="mt-3 text-sm text-muted">Starting…</p>;
  if (status.kind === "error") return <p className="mt-3 text-sm text-warn-fg" role="alert">{status.message}</p>;
  if (status.kind === "done")
    return (
      <p className="mt-3 text-sm" role="status">
        {status.message}{" "}
        <a className="text-accent underline" href={status.runsUrl} target="_blank" rel="noreferrer">
          Follow the run
        </a>
      </p>
    );
  return null;
}

const input = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2";
const button = "mt-4 rounded-lg bg-accent-fill px-4 py-2 font-medium text-on-accent disabled:opacity-60";

export function BuilderForms({ calculators }: { calculators: { id: string; title: string }[] }) {
  const [passcode, setPasscode] = useState("");
  const [topic, setTopic] = useState("");
  const [slug, setSlug] = useState(calculators[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [buildStatus, setBuildStatus] = useState<Status>({ kind: "idle" });
  const [refineStatus, setRefineStatus] = useState<Status>({ kind: "idle" });

  return (
    <section className="mt-12 rounded-xl border border-border bg-sidebar p-6" aria-labelledby="builder-heading">
      <h2 id="builder-heading" className="text-xl font-semibold">Build or refine a calculator</h2>
      <p className="mt-1 text-sm text-muted">
        The research agent searches the web for current prices. A new calculator goes live in about 5 to 10 minutes. A refinement is sent for review and goes live when it is accepted.
      </p>
      <label className="mt-4 block max-w-xs text-sm font-medium">
        Passcode
        <input className={input} type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
      </label>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBuildStatus({ kind: "sending" });
            const s = await send({ mode: "new", passcode, topic });
            setBuildStatus(s.kind === "done" ? { ...s, message: `Researching "${topic}".` } : s);
          }}
        >
          <h3 className="font-semibold">New calculator</h3>
          <label className="mt-2 block text-sm">
            Topic
            <input className={input} required minLength={3} maxLength={200} placeholder="e.g. Owning an e-bike in Singapore" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <button className={button} disabled={buildStatus.kind === "sending"}>Build it</button>
          <StatusLine status={buildStatus} />
        </form>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setRefineStatus({ kind: "sending" });
            const s = await send({ mode: "refine", passcode, slug, prompt });
            setRefineStatus(s.kind === "done" ? { ...s, message: "Working on it. The change will appear for review." } : s);
          }}
        >
          <h3 className="font-semibold">Refine a calculator</h3>
          <label className="mt-2 block text-sm">
            Calculator
            <select className={input} value={slug} onChange={(e) => setSlug(e.target.value)}>
              {calculators.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-sm">
            What should change?
            <textarea className={input} required minLength={3} maxLength={500} rows={3} placeholder="e.g. Add a hybrid car, or recheck the BYD Atto 1 price" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <button className={button} disabled={refineStatus.kind === "sending" || !calculators.length}>Refine it</button>
          <StatusLine status={refineStatus} />
        </form>
      </div>
    </section>
  );
}
