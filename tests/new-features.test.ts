import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeItems, privateItem, summariseResale, type ResaleRow } from "@/agent/datasets";
import { renderCalculatorHtml } from "@/lib/render";
import { EstimateSpecSchema, SpecSchema, historyCagr } from "@/lib/spec";

const require = createRequire(import.meta.url);
const { estimate, compareProviders, historyRate } = require("../templates/estimate-engine.js");
const fixture = () => JSON.parse(fs.readFileSync("tests/fixtures/estimate-providers.json", "utf8"));

describe("estimate providers and presets", () => {
  const spec = EstimateSpecSchema.parse(fixture());
  const state = (over = {}) => ({ tier: "standard", inputs: { area: 90 }, qty: {}, on: {}, contingency: 0, preset: "full", provider: "market", year: 2026, ...over });
  it("switches lines on by preset, and the viewer can override", () => {
    expect(estimate(spec, state()).lines.every((l: { on: boolean }) => l.on)).toBe(true);
    const k = estimate(spec, state({ preset: "kitchen" }));
    expect(k.lines.filter((l: { on: boolean }) => l.on).map((l: { id: string }) => l.id)).toEqual(["kitchen"]);
    expect(estimate(spec, state({ preset: "kitchen", on: { paint: true } })).lines.find((l: { id: string }) => l.id === "paint").on).toBe(true);
  });
  it("scales by the provider's price level and grows at its own history's yearly rate", () => {
    const market = estimate(spec, state());
    expect(estimate(spec, state({ provider: "pricey" })).low).toBeCloseTo(market.low * 1.2);
    expect(historyRate(spec.providers!.options[1].history)).toBeCloseTo(0.1);
    expect(estimate(spec, state({ provider: "pricey", year: 2028 })).low).toBeCloseTo(market.low * 1.2 * 1.1 ** 2);
    expect(compareProviders(spec, state()).map((r: { id: string }) => r.id)).toEqual(["market", "pricey"]);
  });
  it("rejects providers without three years of history or presets naming unknown lines", () => {
    const bad = fixture();
    bad.providers.options[0].history = bad.providers.options[0].history.slice(0, 2);
    bad.presets.options[0].lines.push("nope");
    const msgs = JSON.stringify(SpecSchema.safeParse(bad).error!.issues);
    expect(msgs).toContain("history");
    expect(msgs).toContain("unknown line");
  });
  it("renders hover text for rationale", () => {
    const html = renderCalculatorHtml(spec);
    expect(html).toContain("function initTips");
    expect(html).toContain("Vinyl to tiles.");
  });
});

describe("official data tools", () => {
  const rows: ResaleRow[] = [];
  // Four yearly windows ending Oct 2026; prices rise 10% a year.
  [2023, 2024, 2025, 2026].forEach((y, k) => {
    for (let m = 0; m < 12; m++) {
      const mi = (y - 1) * 12 + 10 + m; // Nov of the year before to Oct
      const month = `${Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, "0")}`;
      for (let i = 0; i < 2; i++) rows.push({ month, town: "BUKIT BATOK", flat_type: "4 ROOM", resale_price: 500000 * 1.1 ** k });
    }
  });
  rows.push({ month: "2026-10", town: "CLEMENTI", flat_type: "4 ROOM", resale_price: 700000 });
  it("summarises 12-month windows into items whose base rate is the 3-year compound rate", () => {
    const { items, skipped, latest } = summariseResale(rows);
    expect(latest).toBe("Oct 2026");
    expect(items).toHaveLength(1);
    expect(skipped[0]).toContain("CLEMENTI");
    const it = items[0];
    expect(it.id).toBe("hdb-bukit-batok-4-room");
    expect(it.history.map((h) => h.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(it.rates.base).toBeCloseTo(0.1, 3);
    expect(it.source.type).toBe("official");
  });
  it("gives private items the index's history and merges filters", () => {
    const hist = (a: number[]) => ({ id: "M", row: "r", history: a.map((v, i) => ({ year: 2023 + i, quarter: `${2023 + i} 3Q`, value: v })) });
    const ind = { landed: hist([100, 105, 110, 121]), "non-landed": hist([100, 101, 102, 103]), CCR: hist([100, 101, 102, 103]), RCR: hist([100, 101, 102, 103]), OCR: hist([100, 110, 121, 133.1]) };
    const condo = privateItem({ location: "bukit-batok", label: "Bukit Batok", type: "condo", region: "OCR", value: 1331000, url: "https://x", basis: "b" }, ind);
    expect(condo.history[0].value).toBe(1000000);
    expect(condo.rates.base).toBeCloseTo(0.1, 3);
    const { items } = summariseResale(rows);
    const spec = mergeItems({ kind: "projection", id: "p", title: "P", currency: "SGD", startMode: "item", items: [] }, [...items, condo], { "bukit-batok": "Bukit Batok" });
    const parsed = SpecSchema.parse(spec);
    expect(parsed.kind === "projection" && parsed.filters.map((f) => f.options.length)).toEqual([1, 2]);
    const bad = JSON.parse(JSON.stringify(spec));
    bad.items[0].rates.base = 0.2;
    bad.items[0].rates.high = 0.3;
    expect(JSON.stringify(SpecSchema.safeParse(bad).error!.issues)).toContain("history's yearly growth");
    expect(historyCagr([{ year: 2023, value: 100 }, { year: 2025, value: 121 }])).toBeCloseTo(0.1);
  });
});
