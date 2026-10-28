import { describe, expect, it } from "vitest";
import { listCalculators, readExample } from "@/lib/data";
import { renderCalculatorHtml } from "@/lib/render";

describe("published calculators", () => {
  // Any calculator can be removed from the site, so the builder's worked examples stand in when none are left.
  const all = [...listCalculators(), readExample("compare")];
  it("all parse against the spec schema", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.title.length).toBeGreaterThan(0);
  });
  it("render into a page with the spec built in and a build-cost section", () => {
    for (const spec of all) {
      const html = renderCalculatorHtml(spec);
      expect(html).not.toContain("__SPEC_JSON__");
      expect(html).toContain(`<title>${spec.title}</title>`);
      expect(html).toContain('id="build-cost"');
      expect(html).toContain(spec.buildLog.length ? "Total AI cost so far" : "The AI cost was not metered");
    }
  });
  it("shows the cost table when a build log exists", () => {
    const spec = { ...all[0], buildLog: [{ round: "First build", label: "Plan the calculator", model: "claude-opus-5-5", input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0, searches: 0, fetches: 0, billing: "api" as const }] };
    const html = renderCalculatorHtml(spec);
    expect(html).toContain("Plan the calculator");
    expect(html).toContain("Opus 5.5");
    expect(html).toContain("Total AI cost so far");
  });
});
