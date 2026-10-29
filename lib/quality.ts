import { historyCagr, type Spec } from "./spec";

/**
 * The automatic quality check every build must pass before it is published: enough options, a source and a
 * hover rationale on every price, and maths that adds up. The build runs it (and Claude fixes what it reports)
 * before the page is saved, so a gap never reaches the site. Errors stop the build; warnings are shown only.
 */
export interface QualityIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}

export interface QualityOptions {
  /** Fewest options, lines or items. Defaults by kind; a topic's playbook or the request can raise it. */
  minItems?: number;
  /** Today, for the age of the sources. */
  today?: Date;
}

export const DEFAULT_MIN_ITEMS = { compare: 3, estimate: 6, projection: 3 } as const;
/** Sources older than this were last checked too long ago to call current. */
const STALE_DAYS = 400;

type Source = { url: string; verified: string; type: "official" | "secondary" | "estimate" };

function sourceIssues(where: string, source: Source | undefined, today: Date, out: QualityIssue[]) {
  if (!source) return out.push({ level: "error", where, message: "has no source." });
  if (source.type !== "estimate" && !/^https?:\/\//.test(source.url)) out.push({ level: "error", where, message: `is marked "${source.type}" but has no source URL.` });
  if (source.type === "estimate" && !source.url) return; // An estimate is allowed to have no URL, but it must say how it was worked out (checked with the rationale).
  if (!source.verified) return out.push({ level: "error", where, message: "has no verified date." });
  const when = Date.parse(source.verified);
  if (Number.isNaN(when)) out.push({ level: "error", where, message: `verified date "${source.verified}" isn't a date (use YYYY-MM-DD).` });
  else if (when > today.getTime() + 86_400_000) out.push({ level: "error", where, message: `verified date ${source.verified} is in the future.` });
  else if (today.getTime() - when > STALE_DAYS * 86_400_000) out.push({ level: "warning", where, message: `was last verified ${source.verified}, over a year ago.` });
}

function rationaleIssue(where: string, text: string | undefined, source: Source | undefined, out: QualityIssue[]) {
  if (!text || text.trim().length < 15) out.push({ level: "error", where, message: "needs a hover rationale: say how the figure was found and what it covers." });
  else if (source?.type === "estimate" && !/estimat|assum|based on|worked|derived|average|median|scal/i.test(text)) out.push({ level: "warning", where, message: "is an estimate; its rationale should say how it was worked out." });
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
}

/** Flags a figure far above or below the others in its group: usually a missed zero or a wrong unit. */
function outliers(label: string, entries: [string, number][], out: QualityIssue[]) {
  const m = median(entries.map(([, v]) => v).filter((v) => v > 0));
  if (entries.length < 4 || m <= 0) return;
  for (const [name, v] of entries) if (v > m * 25 || (v > 0 && v < m / 25)) out.push({ level: "warning", where: name, message: `${label} (${v.toLocaleString("en-SG")}) is far from the others (median ${m.toLocaleString("en-SG")}); check the unit.` });
}

export function checkQuality(spec: Spec, opts: QualityOptions = {}): QualityIssue[] {
  const today = opts.today ?? new Date();
  const min = opts.minItems ?? DEFAULT_MIN_ITEMS[spec.kind];
  const out: QualityIssue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const finite = (where: string, n: number, what: string) => {
    if (!Number.isFinite(n)) err(where, `${what} isn't a number.`);
  };

  if (!spec.scope.trim()) err("scope", "is empty. Say what is and isn't included.");
  if (!spec.limits?.trim()) out.push({ level: "warning", where: "limits", message: "is empty. Say what the calculator can't tell you." });

  if (spec.kind === "compare") {
    if (spec.items.length < min) err("items", `has ${spec.items.length} options; this topic needs at least ${min}.`);
    const fallback = spec.variants?.fallback ?? spec.defaults.variant ?? "default";
    const recurring = new Set(spec.components.filter((c) => c.kind === "recurring").map((c) => c.id));
    for (const it of spec.items) {
      const where = `Option "${it.name}"`;
      sourceIssues(`${where} source`, it.source, today, out);
      rationaleIssue(`${where} notes`, it.notes, it.source, out);
      const row = it.costs[fallback] ?? it.costs.default ?? Object.values(it.costs)[0];
      if (!row) err(where, "has no costs.");
      else {
        if (!Object.keys(row).some((k) => recurring.has(k) && row[k] > 0)) err(where, "has no recurring cost above zero.");
        for (const [k, v] of Object.entries(row)) finite(`${where} ${k}`, v, "a cost");
      }
      if (it.duration < 1) err(where, "has a duration under one year.");
    }
    outliers("Yearly cost", spec.items.map((it) => [it.name, Object.entries(it.costs[fallback] ?? it.costs.default ?? {}).reduce((s, [k, v]) => s + (recurring.has(k) ? v : 0), 0)]), out);
  } else if (spec.kind === "estimate") {
    if (spec.lines.length < min) err("lines", `has ${spec.lines.length} lines; this topic needs at least ${min}.`);
    const tierIds = spec.tiers ? spec.tiers.options.map((o) => o.id) : ["default"];
    for (const l of spec.lines) {
      const where = `Line "${l.label}"`;
      sourceIssues(`${where} source`, l.source, today, out);
      rationaleIssue(`${where} rationale`, l.rationale ?? l.notes, l.source, out);
      tierIds.forEach((t, i) => {
        const r = l.prices[t];
        if (!r) return;
        if (!l.optional && r.high <= 0) err(`${where} ${t}`, "has a zero price.");
        const prev = i > 0 ? l.prices[tierIds[i - 1]] : undefined;
        if (prev && (r.low < prev.low || r.high < prev.high)) out.push({ level: "warning", where: `${where} ${t}`, message: `is cheaper than ${tierIds[i - 1]}; tiers should rise with quality.` });
      });
      if (l.per !== "fixed" && l.qty > 0 && l.qtyMax < l.qty) err(where, "has a maximum quantity below its quantity.");
    }
    for (const p of spec.providers?.options ?? []) {
      const where = `Provider "${p.name}"`;
      sourceIssues(`${where} source`, p.source, today, out);
      const g = historyCagr(p.history);
      if (g !== null && (g < -0.2 || g > 0.5)) out.push({ level: "warning", where, message: `price history implies ${(g * 100).toFixed(1)}% a year; check the figures.` });
    }
    if (spec.providers && spec.providers.options.length < 3) out.push({ level: "warning", where: "providers", message: "has fewer than 3 providers to compare." });
  } else {
    // A projection of one typed-in amount (savings toward a goal) has one item by design.
    if (spec.startMode === "item" && spec.items.length < min) err("items", `has ${spec.items.length} items; this topic needs at least ${min}.`);
    for (const it of spec.items) {
      const where = `Item "${it.name}"`;
      sourceIssues(`${where} source`, it.source, today, out);
      rationaleIssue(`${where} rationale`, it.rationale ?? it.notes, it.source, out);
      for (const [k, v] of Object.entries(it.rates)) {
        // Rates taken from a real history can run past the limits on what a viewer may type, so this only warns.
        if (v < spec.rateLimits.min || v > spec.rateLimits.max) out.push({ level: "warning", where: `${where} ${k} rate`, message: `${(v * 100).toFixed(1)}% sits outside the ${(spec.rateLimits.min * 100).toFixed(0)}% to ${(spec.rateLimits.max * 100).toFixed(0)}% a viewer can type.` });
      }
      if (it.rates.high - it.rates.low < 0.002) out.push({ level: "warning", where, message: "has no spread between its low and high rate." });
      const g = historyCagr(it.history ?? []);
      if (g !== null && (it.history?.length ?? 0) >= 3 && Math.abs(g - it.rates.base) > 0.02) out.push({ level: "warning", where, message: `base rate ${(it.rates.base * 100).toFixed(1)}% differs from its own history's ${(g * 100).toFixed(1)}% a year; explain why.` });
    }
    if (spec.startMode === "item") outliers("Starting value", spec.items.map((it) => [`Item "${it.name}"`, it.value ?? 0]), out);
  }
  return out;
}

export function formatIssues(issues: QualityIssue[]): string {
  return issues.map((i) => `- ${i.level.toUpperCase()} ${i.where}: ${i.message}`).join("\n");
}
