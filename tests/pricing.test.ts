import { describe, expect, it } from "vitest";
import { callCostSgd, SGD_PER_USD, summariseBuildLog } from "@/lib/pricing";
import type { BuildLogEntry } from "@/lib/spec";

const entry = (over: Partial<BuildLogEntry>): BuildLogEntry => ({
  round: "First build", label: "step", model: "claude-sonnet-5-5", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, fetches: 0, billing: "api", ...over,
});

describe("callCostSgd", () => {
  it("prices Sonnet input, cache reads, output and searches", () => {
    // 120k in at $2, 400k cache reads at $0.20, 8k out at $10, 30 searches at $0.01
    const usd = 0.24 + 0.08 + 0.08 + 0.3;
    expect(callCostSgd(entry({ input: 120_000, cacheRead: 400_000, output: 8_000, searches: 30 }))).toBeCloseTo(usd * SGD_PER_USD, 6);
  });
  it("prices Opus at its own rate", () => {
    expect(callCostSgd(entry({ model: "claude-opus-5-5", input: 1_000_000 }))).toBeCloseTo(4 * SGD_PER_USD, 6);
    expect(callCostSgd(entry({ model: "claude-haiku-5-5", input: 1_000_000, output: 100_000 }))).toBeCloseTo(0.15 * SGD_PER_USD, 6);
  });
  it("never under-prices an unknown model", () => {
    const unknown = callCostSgd(entry({ model: "claude-future-9", input: 1_000_000, output: 1_000_000 }));
    expect(unknown).toBeGreaterThanOrEqual(callCostSgd(entry({ model: "claude-opus-5-5", input: 1_000_000, output: 1_000_000 })));
  });
});

describe("summariseBuildLog", () => {
  it("groups rounds with subtotals and a running total", () => {
    const log = [
      entry({ round: "First build", input: 1_000_000 }),
      entry({ round: "First build", input: 1_000_000 }),
      entry({ round: "Refinement 1: add a hybrid", input: 1_000_000 }),
    ];
    const { rounds, totalSgd } = summariseBuildLog(log);
    expect(rounds.map((r) => r.round)).toEqual(["First build", "Refinement 1: add a hybrid"]);
    expect(rounds[0].subtotalSgd).toBeCloseTo(4 * SGD_PER_USD);
    expect(rounds[1].runningTotalSgd).toBeCloseTo(6 * SGD_PER_USD);
    expect(totalSgd).toBeCloseTo(6 * SGD_PER_USD);
  });
});
