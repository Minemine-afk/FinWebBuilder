import type { BuildLogEntry } from "./spec";

/**
 * Published Claude API prices in US dollars (per million tokens, and per web search).
 * Source: platform.claude.com pricing, checked 2026-10-27. Update here when prices change.
 */
export const MODEL_PRICES_USD: Record<string, { name: string; input: number; output: number }> = {
  "claude-opus-5-5": { name: "Opus 5.5", input: 4, output: 20 },
  "claude-sonnet-5-5": { name: "Sonnet 5.5", input: 2, output: 10 },
  // Claude Code reads each fetched web page with Haiku. Rate for prompts up to 100K tokens ($0.50/$2.50 above that).
  "claude-haiku-5-5": { name: "Haiku 5.5", input: 0.1, output: 0.5 },
  // Models a refusal fallback may hand a request to.
  "claude-opus-5": { name: "Opus 5", input: 5, output: 25 },
  "claude-opus-4-8": { name: "Opus 4.8", input: 5, output: 25 },
  "claude-sonnet-5": { name: "Sonnet 5", input: 2, output: 10 },
};
/** Unknown model ids are priced like the most expensive one above, so estimates never come out low. */
const UNKNOWN_MODEL = { name: "Other model", input: 5, output: 25 };
export const WEB_SEARCH_USD = 10 / 1000;
/** Cache reads cost 10% of the input price, cache writes (5-minute) 125%. */
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;

/** SGD per 1 USD: ECB reference rate 29 Sep 2026 (1 SGD = 0.78289 USD). */
export const SGD_PER_USD = 1 / 0.78289;

export function modelPrice(model: string) {
  return MODEL_PRICES_USD[model] ?? UNKNOWN_MODEL;
}

export function modelName(model: string) {
  return MODEL_PRICES_USD[model]?.name ?? model;
}

/** Estimated cost of one API call in SGD. Web fetch has no fee beyond the tokens it adds. */
export function callCostSgd(e: Pick<BuildLogEntry, "model" | "input" | "output" | "cacheRead" | "cacheWrite" | "searches">): number {
  const p = modelPrice(e.model);
  const usd =
    (e.input * p.input +
      (e.cacheRead ?? 0) * p.input * CACHE_READ_FACTOR +
      (e.cacheWrite ?? 0) * p.input * CACHE_WRITE_FACTOR +
      e.output * p.output) /
      1e6 +
    (e.searches ?? 0) * WEB_SEARCH_USD;
  return usd * SGD_PER_USD;
}

export interface RoundSummary {
  round: string;
  entries: (BuildLogEntry & { costSgd: number })[];
  subtotalSgd: number;
  runningTotalSgd: number;
}

/** Groups a build log into rounds (first build, each refinement) with subtotals and a running total. */
export function summariseBuildLog(log: BuildLogEntry[]): { rounds: RoundSummary[]; totalSgd: number } {
  const rounds: RoundSummary[] = [];
  let running = 0;
  for (const e of log) {
    let r = rounds.at(-1);
    if (!r || r.round !== e.round) {
      r = { round: e.round, entries: [], subtotalSgd: 0, runningTotalSgd: running };
      rounds.push(r);
    }
    const costSgd = callCostSgd(e);
    r.entries.push({ ...e, costSgd });
    r.subtotalSgd += costSgd;
    running += costSgd;
    r.runningTotalSgd = running;
  }
  return { rounds, totalSgd: running };
}

export function formatSgd(n: number): string {
  return "S$" + n.toFixed(2);
}
