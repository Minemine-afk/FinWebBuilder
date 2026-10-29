import fs from "node:fs";
import path from "node:path";
import type { Spec } from "./spec";

/**
 * Prices and sources from past builds, kept in data/price-cache.json. A new build on a similar topic gets the
 * matching entries in its prompt and reuses the recent ones instead of researching them again, which is most of
 * a build's cost. Entries are replaced when their calculator is rebuilt, and kept if the calculator is removed
 * (the research is still good).
 */
export interface CacheEntry {
  /** Calculator the entry came from, and the option, line or item in it. */
  calc: string;
  id: string;
  name: string;
  /** Words from the calculator's title and group, for finding similar topics. */
  tags: string[];
  figure: string;
  currency: string;
  priceYear?: number;
  source: { url: string; verified: string; type: "official" | "secondary" | "estimate" };
  rationale: string;
}

export const CACHE_FILE = path.join(process.cwd(), "data", "price-cache.json");
/** Entries verified more recently than this are reused as they are. */
export const FRESH_DAYS = 180;
const MAX_ENTRIES = 1500;

const STOP = new Set(["the", "and", "for", "with", "vs", "versus", "of", "in", "to", "a", "an", "or", "cost", "costs", "price", "prices", "singapore", "sg", "how", "much", "does", "compare", "calculator", "future"]);

/** Lower-case words of at least three letters, without common filler and a trailing "s". */
export function tokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
    ),
  ];
}

const money = (n: number) => Math.round(n).toLocaleString("en-SG");
const short = (s: string | undefined, n = 220) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** One cache entry per option, line or item of a calculator. */
export function harvest(spec: Spec): CacheEntry[] {
  const tags = tokens(spec.title);
  const base = { calc: spec.id, currency: spec.currency };
  if (spec.kind === "compare") {
    const fallback = spec.variants?.fallback ?? spec.defaults.variant ?? "default";
    const label = new Map(spec.components.map((c) => [c.id, c.label]));
    return spec.items.map((it) => {
      const row = it.costs[fallback] ?? it.costs.default ?? Object.values(it.costs)[0] ?? {};
      return {
        ...base,
        id: it.id,
        name: [it.name, it.option].filter(Boolean).join(", "),
        tags: [...new Set([...tags, ...tokens(it.group)])],
        figure: Object.entries(row).map(([k, v]) => `${label.get(k) ?? k} ${money(v)}`).join("; "),
        currency: it.currency,
        priceYear: it.priceYear,
        source: it.source,
        rationale: short(it.notes),
      };
    });
  }
  if (spec.kind === "estimate") {
    const tier = spec.tiers?.default ?? "default";
    const groups = new Map(spec.groups.map((g) => [g.id, g.label]));
    return spec.lines.map((l) => {
      const r = l.prices[tier] ?? Object.values(l.prices)[0];
      return {
        ...base,
        id: l.id,
        name: l.label,
        tags: [...new Set([...tags, ...tokens(groups.get(l.group) ?? l.group)])],
        figure: r ? `${money(r.low)} to ${money(r.high)} ${l.unit} (${tier})` : "",
        priceYear: spec.priceYear,
        source: l.source,
        rationale: short(l.rationale ?? l.notes),
      };
    });
  }
  return spec.items.map((it) => ({
    ...base,
    id: it.id,
    name: [it.name, it.option].filter(Boolean).join(", "),
    tags,
    figure: `${typeof it.value === "number" ? `${money(it.value)} today; ` : ""}yearly rate low ${(it.rates.low * 100).toFixed(1)}%, base ${(it.rates.base * 100).toFixed(1)}%, high ${(it.rates.high * 100).toFixed(1)}%`,
    priceYear: it.priceYear,
    source: it.source,
    rationale: short(it.rationale ?? it.notes),
  }));
}

export function readCache(file = CACHE_FILE): CacheEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: CacheEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

/** Figures the official data tools (agent/datasets.ts) regenerate for free are never worth caching. */
const FREE_DATA = /data\.gov\.sg|singstat\.gov\.sg/;

/** Replaces the calculator's entries with the ones from its latest version. Entries without a figure or a dated source aren't kept. */
export function updateCache(spec: Spec, file = CACHE_FILE): CacheEntry[] {
  const fresh = harvest(spec).filter((e) => e.figure && e.source.verified && !FREE_DATA.test(e.source.url));
  const entries = [...readCache(file).filter((e) => e.calc !== spec.id), ...fresh].slice(-MAX_ENTRIES);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // One entry per line keeps diffs readable.
  fs.writeFileSync(file, `{"note":"Prices and sources from past builds; see lib/price-cache.ts.","entries":[\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`);
  return entries;
}

export interface Match {
  entry: CacheEntry;
  score: number;
  fresh: boolean;
}

/** How similar an entry is to a request: shared words in its name and tags, with name matches counting double. */
function score(query: Set<string>, e: CacheEntry): number {
  const name = new Set(tokens(e.name));
  let s = 0;
  for (const w of query) {
    if (name.has(w)) s += 2;
    else if (e.tags.includes(w)) s += 1;
  }
  return s;
}

/** The entries most like the request, best first. Pass the topic and any item names the reader ticked. */
export function findSimilar(request: string, entries: CacheEntry[], opts: { limit?: number; today?: Date; minScore?: number } = {}): Match[] {
  const query = new Set(tokens(request));
  const today = (opts.today ?? new Date()).getTime();
  const minScore = opts.minScore ?? 2;
  return entries
    .map((entry) => ({ entry, score: score(query, entry) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 25)
    .map((m) => ({ ...m, fresh: today - Date.parse(m.entry.source.verified) <= FRESH_DAYS * 86_400_000 }));
}

/** How many of the given item names have a cached match (used to lower the cost estimate). */
export function countCached(names: string[], entries: CacheEntry[], today = new Date()): number {
  return names.filter((n) => findSimilar(n, entries, { limit: 1, today, minScore: 4 }).some((m) => m.fresh)).length;
}

/** The cache entries as prompt text, or "" when nothing is similar. */
export function cachePrompt(request: string, entries: CacheEntry[], today = new Date()): string {
  const matches = findSimilar(request, entries, { today });
  if (!matches.length) return "";
  const lines = matches.map(({ entry: e, fresh }) => `- ${e.name} [${e.calc}]: ${e.figure} ${e.currency}${e.priceYear ? `, ${e.priceYear}` : ""}; ${e.source.type}, verified ${e.source.verified}${e.source.url ? `, ${e.source.url}` : ""}${fresh ? "" : " (OLD: recheck)"}${e.rationale ? `. ${e.rationale}` : ""}`);
  return `Prices already researched in earlier builds. Where an entry is the same thing you need and is not marked OLD, reuse its figure, source and verified date as they are and do not research it again (you may mention in its rationale that it was reused). Only research what is missing, marked OLD, or different in scope.
${lines.join("\n")}`;
}
