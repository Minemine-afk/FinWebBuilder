import { describe, expect, it } from "vitest";
import { planFromSpec, toSpec, type Plan } from "@/agent/schema";
import { readCalculator } from "@/lib/data";
import { SpecSchema } from "@/lib/spec";

const plan: Plan = {
  title: "E-bike ownership", subject: "bike", periodLabel: "Year", scope: "s", limits: "l", defaultGrowth: 0.4,
  components: [{ id: "purchase", label: "Price", kind: "oneoff" }, { id: "running", label: "Charging", kind: "recurring" }],
  variants: null, extras: null, groups: [{ id: "all", label: "All" }],
  items: [{ id: "a", group: "all", name: "Bike A", option: "", duration: 5, researchQuestion: "q", hard: false }],
};

describe("toSpec", () => {
  it("converts agent output into a valid spec and clamps growth", () => {
    const spec = toSpec({
      slug: "e-bike", currency: "SGD", plan, fx: {}, today: "2026-10-25",
      extracted: [{ id: "a", currency: "SGD", priceYear: 2026, costs: [{ variant: "default", amounts: [{ component: "purchase", amount: 1500 }, { component: "running", amount: 60 }] }], extrasMonthly: [], sourceUrl: "https://example.com", sourceType: "secondary", notes: "n", confidence: "unconfirmed" }],
    });
    expect(SpecSchema.parse(spec).defaultGrowth).toBe(0.15);
    expect(spec.items[0].costs.default).toEqual({ purchase: 1500, running: 60 });
    expect(spec.items[0].notes).toContain("treat as an estimate");
    expect(spec.version).toBe(1);
  });
  it("keeps unchanged items and bumps the version on a refinement", () => {
    const current = readCalculator("ev-vs-petrol-car")!;
    const next = toSpec({ slug: current.id, currency: "SGD", plan: planFromSpec(current), extracted: [], fx: {}, today: "2026-10-26", previous: current });
    expect(next.items.map((i) => i.costs)).toEqual(current.items.map((i) => i.costs));
    expect(next.version).toBe(current.version + 1);
    expect(SpecSchema.safeParse(next).success).toBe(true);
  });
});
