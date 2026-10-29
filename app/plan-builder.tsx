"use client";

import { useEffect, useRef, useState } from "react";
import { estimateCost, KIND_HELP, KIND_LABELS, type Plan, type PlanChoice } from "@/lib/plan";
import { KINDS, type Kind } from "@/lib/spec";

type Scoped = { plan: Plan; cached: string[] };
/** "preview" shows a scope at once; `refining` is the quick draft while the GitHub run improves it, `upgrade` is the better scope once it arrives. */
type Phase = { kind: "idle" } | { kind: "scoping" } | { kind: "preview"; scoped: Scoped; refining: boolean; upgrade: Scoped | null } | { kind: "error"; message: string };

/** A topic specific enough to need little refinement: what, where, size or quality, and who or what to compare. Must stay within the 200 characters the topic allows. */
const EXAMPLE_TOPIC = "Renovation cost for a resale 4-room HDB flat in Singapore, about 90 sqm, mid-range finish, comparing interior design firms and contractors";

const input = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2";
const button = "rounded-lg bg-accent-fill px-4 py-2 font-medium text-on-accent disabled:opacity-60";
const ghost = "rounded-lg border border-border px-4 py-2 font-medium disabled:opacity-60";

/**
 * New-calculator flow: scope the topic with the cheap model first, then let the reader pick the kind, answer
 * up to two questions, tick the items to research and see the estimated cost before the full run starts.
 */
export function PlanBuilder({ passcode, onBuild, busy }: { passcode: string; onBuild: (topic: string, choice: PlanChoice | null, research: "sonnet" | "opus") => void; busy: boolean }) {
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function scope() {
    clearTimeout(timer.current);
    setPhase({ kind: "scoping" });
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode, topic }) });
      const data = await res.json();
      if (!res.ok) return setPhase({ kind: "error", message: data.error ?? "Something went wrong." });
      if (data.status === "ready") return setPhase({ kind: "preview", scoped: { plan: data.plan, cached: data.cached ?? [] }, refining: false, upgrade: null });
      // The GitHub run is still working: show the quick draft now and offer the better scope when it lands.
      const draft: Scoped = { plan: data.draft, cached: data.cached ?? [] };
      setPhase({ kind: "preview", scoped: draft, refining: true, upgrade: null });
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const r = await fetch(`/api/plan?id=${data.planId}`, { cache: "no-store" });
          const d = await r.json();
          if (d.status === "ready") {
            const better: Scoped = { plan: d.plan, cached: d.cached ?? [] };
            return setPhase((cur) => (cur.kind === "preview" ? { ...cur, refining: false, upgrade: better.plan.source === "haiku" ? better : null } : cur));
          }
        } catch {
          // Try again on the next tick.
        }
        if (tries > 45) return setPhase((cur) => (cur.kind === "preview" ? { ...cur, refining: false } : cur));
        timer.current = setTimeout(poll, 4000);
      };
      timer.current = setTimeout(poll, 4000);
    } catch {
      setPhase({ kind: "error", message: "Couldn't reach the server." });
    }
  }

  return (
    <div>
      <h3 className="font-semibold">New calculator</h3>
      <div className="mt-2 rounded-lg border border-border bg-background p-3 text-sm">
        <p className="font-medium">A specific topic needs less fixing afterwards</p>
        <p className="mt-1 text-muted">Say what it is, where, the size or quality, and what to compare. For example:</p>
        <p className="mt-1 italic">&ldquo;{EXAMPLE_TOPIC}&rdquo;</p>
        <button type="button" className="mt-2 text-accent underline" onClick={() => setTopic(EXAMPLE_TOPIC)}>
          Use this example
        </button>
      </div>
      <label className="mt-3 block text-sm">
        Topic
        <input className={input} required minLength={3} maxLength={200} placeholder={EXAMPLE_TOPIC} value={topic} onChange={(e) => setTopic(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-muted">Short is fine too. A quick, low-cost step proposes what to cover and asks at most two questions before any research is paid for.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={topic.trim().length < 3 || !passcode || phase.kind === "scoping" || busy} onClick={scope}>
          Scope it first
        </button>
        <button type="button" className={ghost} disabled={topic.trim().length < 3 || busy} onClick={() => onBuild(topic, null, "opus")}>
          Build straight away
        </button>
      </div>
      {phase.kind === "scoping" && <p className="mt-3 text-sm text-muted" role="status">Starting…</p>}
      {phase.kind === "error" && <p className="mt-3 text-sm text-warn-fg" role="alert">{phase.message}</p>}
      {phase.kind === "preview" && (
        <>
          {phase.refining && (
            <p className="mt-3 text-sm text-muted" role="status">
              This is a quick draft. The low-cost model is refining the scope on GitHub (a minute or two); you can start ticking items now.
            </p>
          )}
          {phase.upgrade && (
            <p className="mt-3 text-sm" role="status">
              A better scope is ready.{" "}
              <button type="button" className="text-accent underline" onClick={() => setPhase({ kind: "preview", scoped: phase.upgrade!, refining: false, upgrade: null })}>
                Switch to it
              </button>{" "}
              (your ticks on the draft will reset).
            </p>
          )}
          <Preview key={phase.scoped.plan.topic + phase.scoped.plan.source} scoped={phase.scoped} busy={busy} onBuild={(choice, research) => onBuild(topic, choice, research)} onCancel={() => { clearTimeout(timer.current); setPhase({ kind: "idle" }); }} />
        </>
      )}
    </div>
  );
}

function Preview({ scoped, busy, onBuild, onCancel }: { scoped: Scoped; busy: boolean; onBuild: (choice: PlanChoice, research: "sonnet" | "opus") => void; onCancel: () => void }) {
  const { plan, cached } = scoped;
  const [kind, setKind] = useState<Kind>(plan.kind);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(plan.questions.map((q) => [q.id, q.default])));
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(plan.items.map((i) => [i.id, true])));
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [research, setResearch] = useState<"sonnet" | "opus">("opus");

  const chosen = plan.items.filter((i) => ticked[i.id]).map((i) => i.label).concat(extra);
  const cachedTicked = plan.items.filter((i) => ticked[i.id] && cached.includes(i.id)).length;
  const count = chosen.length || 6; // With nothing ticked or listed, the agent picks its usual handful.
  const cost = estimateCost(count, research, cachedTicked);

  function build() {
    onBuild(
      {
        kind,
        answers: plan.questions.map((q) => ({ question: q.question, answer: q.options.find((o) => o.id === answers[q.id])?.label ?? answers[q.id] })),
        include: chosen,
        exclude: plan.items.filter((i) => !ticked[i.id]).map((i) => i.label),
        playbook: plan.playbook,
        summary: plan.summary,
      },
      research,
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-background p-4 text-sm">
      <p className="font-medium">{plan.title || "Proposed scope"}</p>
      {plan.summary && <p className="mt-1 text-muted">{plan.summary}</p>}
      <p className="mt-1 text-xs text-muted">{plan.source === "haiku" ? "Scoped by the low-cost model." : "Quick draft from the topic's checklist (the low-cost scoping step wasn't used)."}</p>

      <label className="mt-3 block">
        Calculator type
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}{k === plan.kind ? " (suggested)" : ""}</option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted">{KIND_HELP[kind]}{kind === plan.kind && plan.kindReason ? ` ${plan.kindReason}` : ""}</p>

      {plan.questions.map((q) => (
        <fieldset key={q.id} className="mt-3">
          <legend className="font-medium">{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.id} className="mt-1 mr-4 inline-flex items-center gap-1">
              <input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} /> {o.label}
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="mt-3">
        <legend className="font-medium">What to research ({chosen.length} chosen)</legend>
        {plan.items.length === 0 && <p className="text-muted">No list proposed. The agent will choose the options; add some below to steer it.</p>}
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {plan.items.map((i) => (
            <li key={i.id}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={!!ticked[i.id]} onChange={(e) => setTicked({ ...ticked, [i.id]: e.target.checked })} />
                <span>{i.label}{cached.includes(i.id) && <span className="ml-1 text-xs text-accent">already priced</span>}</span>
              </label>
            </li>
          ))}
          {extra.map((label, n) => (
            <li key={label + n} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked readOnly aria-label={label} /> <span>{label}</span>
              <button type="button" className="text-xs text-accent underline" onClick={() => setExtra(extra.filter((_, j) => j !== n))}>remove</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input className={input + " mt-0"} placeholder="Add your own" maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className={ghost} disabled={!draft.trim()} onClick={() => { setExtra([...extra, draft.trim()]); setDraft(""); }}>Add</button>
        </div>
      </fieldset>

      <label className="mt-3 block">
        Research depth
        <select className={input} value={research} onChange={(e) => setResearch(e.target.value as "sonnet" | "opus")}>
          <option value="opus">Careful (Opus researches; the default)</option>
          <option value="sonnet">Quick (Sonnet researches; about half the cost)</option>
        </select>
      </label>

      <p className="mt-3 font-medium" role="status">
        Estimated cost: S${cost.lowSgd.toFixed(2)} to S${cost.highSgd.toFixed(2)}
        <span className="font-normal text-muted"> at API prices, covered by the subscription. {cachedTicked ? `${cachedTicked} item${cachedTicked === 1 ? " is" : "s are"} reused from earlier builds. ` : ""}About 5 to 10 minutes.</span>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={button} disabled={busy} onClick={build}>Build the chosen items</button>
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
