import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { listCalculators, readExample } from "@/lib/data";
import { renderCalculatorHtml } from "@/lib/render";
import { EstimateSpecSchema, ProbabilitySpecSchema, ProjectionSpecSchema, SpecSchema, describeSpec } from "@/lib/spec";

// The page scripts are plain JS that also export for Node, so the tests run the same maths the pages do.
const require = createRequire(import.meta.url);
const common = require("../templates/common.js");
const { estimate } = require("../templates/estimate-engine.js");
const { project, requiredDeposit } = require("../templates/projection-engine.js");
const { simulate, sustainableWithdrawal, lognormalParams, mulberry32, normals } = require("../templates/probability-engine.js");

describe("clampInput", () => {
  const lim = { min: 1, max: 30, fallback: 10, label: "Years", unit: "years" };
  it("passes good numbers and clamps the rest with a message", () => {
    expect(common.clampInput("12", lim)).toEqual({ value: 12, error: null });
    expect(common.clampInput("0", lim)).toMatchObject({ value: 1 });
    expect(common.clampInput("0", lim).error).toContain("at least 1");
    expect(common.clampInput("99", lim)).toMatchObject({ value: 30 });
    expect(common.clampInput("abc", lim)).toMatchObject({ value: 10 });
    expect(common.clampInput("", lim).error).toContain("Enter a number");
  });
});

describe("breakEven", () => {
  it("finds the year the dearer-upfront option overtakes", () => {
    // A costs 100 then 10 a year; B costs 40 then 30 a year: running totals are level at the end of year 4.
    const a = [100, 10, 10, 10, 10, 10], b = [40, 30, 30, 30, 30, 30];
    const r = common.breakEven(a, b);
    expect(r.cheaperAfter).toBe("a");
    expect(r.years).toBeCloseTo(4, 5); // level at the end of year 4
    expect(common.breakEven([100, 10, 10, 10], [40, 45, 45, 45]).years).toBeCloseTo(2 + 25 / 35, 5);
  });
  it("reports no break-even when one option stays cheaper", () => {
    expect(common.breakEven([10, 10, 10], [20, 20, 20])).toMatchObject({ years: null, cheaper: "a" });
  });
  it("only compares the years both options cover", () => {
    expect(common.breakEven([10, 10, 10, 10], [20, 20]).over).toBe(2);
  });
});

describe("estimate engine", () => {
  const spec = EstimateSpecSchema.parse(readExample("estimate"));
  const state = (over = {}) => ({ tier: "standard", inputs: { area: 90 }, qty: {}, on: {}, contingency: 0, ...over });
  it("scales per-area lines by the input and fixed lines by quantity", () => {
    const e = estimate(spec, state());
    const hacking = e.lines.find((l: { id: string }) => l.id === "hacking");
    expect(hacking.low).toBe(40 * 90);
    expect(hacking.high).toBe(70 * 90);
    const plumbing = e.lines.find((l: { id: string }) => l.id === "plumbing");
    expect(plumbing.low).toBe(1500 * 2);
    expect(estimate(spec, state({ qty: { plumbing: 3 } })).lines.find((l: { id: string }) => l.id === "plumbing").low).toBe(4500);
  });
  it("leaves optional lines out until switched on, and adds contingency", () => {
    const base = estimate(spec, state());
    expect(base.lines.find((l: { id: string }) => l.id === "aircon").on).toBe(false);
    const withAc = estimate(spec, state({ on: { aircon: true } }));
    expect(withAc.low).toBeCloseTo(base.low + 1800 * 3);
    const buffered = estimate(spec, state({ contingency: 0.1 }));
    expect(buffered.high).toBeCloseTo(base.high * 1.1);
    expect(buffered.low).toBeLessThanOrEqual(buffered.mid);
    expect(buffered.mid).toBeLessThanOrEqual(buffered.high);
  });
  it("prices higher at higher finish levels", () => {
    const t = (tier: string) => estimate(spec, state({ tier })).mid;
    expect(t("basic")).toBeLessThan(t("standard"));
    expect(t("standard")).toBeLessThan(t("premium"));
  });
});

describe("probability engine", () => {
  const base = { savings: 300_000, contribution: 12_000, withdrawal: 40_000, yearsToStart: 20, yearsInRetirement: 30, inflation: 0.025, mean: 0.06, sd: 0.12, runs: 1000, seed: 1 };
  it("gives the same answer for the same seed", () => {
    expect(simulate(base).successRate).toBe(simulate(base).successRate);
    expect(simulate(base).bands.p50).toEqual(simulate(base).bands.p50);
  });
  it("always lasts with no spending and never lasts with huge spending", () => {
    expect(simulate({ ...base, withdrawal: 0 }).successRate).toBe(1);
    expect(simulate({ ...base, withdrawal: 1_000_000 }).successRate).toBe(0);
  });
  it("with no volatility, follows the plain maths", () => {
    const r = simulate({ ...base, sd: 0, contribution: 0, withdrawal: 0, yearsToStart: 10, yearsInRetirement: 0 + 1, mean: 0.05, inflation: 0 });
    expect(r.medianFinal).toBeCloseTo(300_000 * 1.05 ** 11, 0);
  });
  it("lowers the chance when spending rises and raises it with more savings", () => {
    expect(simulate({ ...base, withdrawal: 60_000 }).successRate).toBeLessThan(simulate(base).successRate);
    expect(simulate({ ...base, savings: 600_000 }).successRate).toBeGreaterThan(simulate(base).successRate);
  });
  it("orders the percentile bands", () => {
    const r = simulate(base);
    for (let y = 0; y <= r.years; y++) {
      expect(r.bands.p10[y]).toBeLessThanOrEqual(r.bands.p50[y]);
      expect(r.bands.p50[y]).toBeLessThanOrEqual(r.bands.p90[y]);
    }
  });
  it("keeps the simulated average return at the stated mean", () => {
    const { mu, sigma } = lognormalParams(0.06, 0.12);
    const z = normals(mulberry32(3), 200_000);
    let sum = 0;
    for (const x of z) sum += Math.exp(mu + sigma * x);
    expect(sum / z.length).toBeCloseTo(1.06, 2);
  });
  it("finds a withdrawal that meets the target and is not too generous", () => {
    const w = sustainableWithdrawal(base, 0.9);
    expect(simulate({ ...base, withdrawal: w }).successRate).toBeGreaterThanOrEqual(0.9);
    expect(simulate({ ...base, withdrawal: w * 1.2 }).successRate).toBeLessThan(0.9);
  });
});

describe("projection engine", () => {
  const p = { start: 1000, deposit: 0, rate: 0.05, years: 10, compounding: "annual", inflation: 0, goal: 0 };
  it("compounds a price yearly", () => {
    expect(project(p).final).toBeCloseTo(1000 * 1.05 ** 10, 6);
    expect(project(p).rows).toHaveLength(10);
  });
  it("compounds monthly when asked, and tracks deposits and growth", () => {
    const r = project({ ...p, start: 10000, compounding: "monthly" });
    expect(r.final).toBeCloseTo(10000 * (1 + 0.05 / 12) ** 120, 4);
    const d = project({ ...p, start: 0, deposit: 100, rate: 0 });
    expect(d.final).toBeCloseTo(12000);
    expect(d.deposited).toBe(12000);
    expect(d.growth).toBeCloseTo(0);
  });
  it("finds when a goal is reached and the deposit needed for it", () => {
    const r = project({ ...p, start: 0, deposit: 1000, rate: 0, goal: 5500 });
    expect(r.goalMonths).toBe(6);
    const need = requiredDeposit({ ...p, start: 0, rate: 0.04, years: 10, goal: 50000 });
    expect(project({ ...p, start: 0, rate: 0.04, deposit: need, goal: 50000 }).final).toBeCloseTo(50000, 3);
    expect(requiredDeposit({ ...p, start: 60000, goal: 50000 })).toBe(0);
  });
  it("shows today's money when inflation is set", () => {
    const last = project({ ...p, rate: 0, inflation: 0.02 }).rows[9];
    expect(last.real).toBeCloseTo(1000 / 1.02 ** 10, 6);
  });
});

describe("spec kinds", () => {
  it("treats files without a kind as comparisons", () => {
    const { kind: _k, ...noKind } = JSON.parse(JSON.stringify(readExample("compare")));
    void _k;
    expect(SpecSchema.parse(noKind).kind).toBe("compare");
  });
  it("ships one seed for each new kind that passes its schema", () => {
    expect(EstimateSpecSchema.safeParse(readExample("estimate")).success).toBe(true);
    expect(ProjectionSpecSchema.safeParse(readExample("projection")).success).toBe(true);
    expect(ProbabilitySpecSchema.safeParse(readExample("probability")).success).toBe(true);
    expect(describeSpec(readExample("estimate"))).toContain("Cost estimate");
    expect(describeSpec(readExample("probability"))).toContain("Probability");
  });
  it("rejects mistakes the agent could make", () => {
    const est = JSON.parse(JSON.stringify(readExample("estimate")));
    est.lines[0].per = "no-such-input";
    est.lines[1].prices.standard = { low: 10, high: 5 };
    delete est.lines[2].prices.basic;
    const r = SpecSchema.safeParse(est);
    expect(r.success).toBe(false);
    const msgs = JSON.stringify(r.error!.issues);
    expect(msgs).toContain("unknown input");
    expect(msgs).toContain("no price for");
    expect(msgs).toContain("low must not exceed high");
    const proj = JSON.parse(JSON.stringify(readExample("projection")));
    proj.items[0].rates = { low: 0.05, base: 0.02, high: 0.01 };
    delete proj.items[0].value;
    expect(JSON.stringify(SpecSchema.safeParse(proj).error!.issues)).toContain("low <= base <= high");
  });
  it("rejects a driver that is unknown or on a one-off component", () => {
    const car = JSON.parse(JSON.stringify(readExample("compare")));
    car.components[0].driver = "km";
    car.components[2].driver = "nope";
    const msgs = JSON.stringify(SpecSchema.safeParse(car).error!.issues);
    expect(msgs).toContain("one-off");
    expect(msgs).toContain("unknown driver");
  });
});

describe("rendering each kind", () => {
  it("fills every placeholder and uses the kind's own page", () => {
    for (const s of [...listCalculators(), readExample("compare"), readExample("estimate"), readExample("projection"), readExample("probability")]) {
      const html = renderCalculatorHtml(s);
      for (const ph of ["__SPEC_JSON__", "__BASE_CSS__", "__COMMON_JS__", "__ENGINE_JS__", "__TITLE__"]) expect(html, `${s.id} ${ph}`).not.toContain(ph);
      expect(html).toContain(s.kind === "compare" ? "calcPicker" : s.kind === "estimate" ? "Cost estimate" : s.kind === "probability" ? "Probability" : "Projection");
      expect(html).toContain("function clampInput");
      expect(html).toContain('id="build-cost"');
    }
  });
});
