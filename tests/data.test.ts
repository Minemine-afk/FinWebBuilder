import { describe, expect, it } from "vitest";
import { listCalculators } from "@/lib/data";
import { renderCalculatorHtml } from "@/lib/render";

describe("seed calculators", () => {
  const all = listCalculators();
  it("all parse against the spec schema", () => {
    // Calculators the agent publishes join the hand-built seeds, so check the seeds are present, not the whole list.
    expect(all.map((s) => s.id)).toEqual(expect.arrayContaining(["dog-vs-cat", "ev-vs-petrol-car"]));
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
