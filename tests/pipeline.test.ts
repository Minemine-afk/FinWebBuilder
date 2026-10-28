import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { Agent, BudgetExceededError } from "@/agent/llm";
import { OPUS, SONNET } from "@/agent/models";
import { buildNew, refine } from "@/agent/pipeline";
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, PATCH_SYSTEM, PLAN_SYSTEM, RESEARCH_SYSTEM, VERIFY_SYSTEM } from "@/agent/prompts";
import { planFromSpec } from "@/agent/schema";
import { readExample } from "@/lib/data";
import { SpecSchema } from "@/lib/spec";

const plan = {
  title: "E-bike ownership", subject: "bike", periodLabel: "Year", scope: "s", limits: "l", defaultGrowth: 0.03,
  components: [{ id: "purchase", label: "Price", kind: "oneoff" }, { id: "running", label: "Charging", kind: "recurring" }],
  variants: null, extras: null, groups: [{ id: "all", label: "All" }],
  items: [
    { id: "a", group: "all", name: "Bike A", option: "", duration: 5, researchQuestion: "q", hard: false },
    { id: "b", group: "all", name: "Bike B", option: "", duration: 5, researchQuestion: "q", hard: true },
  ],
};
const extracted = (id: string, confidence: string) => ({
  id, currency: "SGD", priceYear: 2026, costs: [{ variant: "default", amounts: [{ component: "purchase", amount: 1500 }, { component: "running", amount: 60 }] }],
  extrasMonthly: [], sourceUrl: "https://example.com", sourceType: "secondary", notes: "n", confidence,
});

/** A stand-in for the SDK client that answers by step and records which model each call used. */
function fakeClient(answers: (system: string, user: string, model: string) => unknown) {
  const calls: { model: string; system: string; tools: boolean }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: { model: string; system: string; messages: { content: string }[]; tools?: unknown[] }) {
          calls.push({ model: params.model, system: params.system, tools: !!params.tools });
          const answer = answers(params.system, String(params.messages[0].content), params.model);
          const text = typeof answer === "string" ? answer : JSON.stringify(answer);
          return {
            finalMessage: async () => ({
              model: params.model, stop_reason: "end_turn", content: [{ type: "text", text }],
              usage: { input_tokens: 10_000, output_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: params.tools ? { web_search_requests: 4, web_fetch_requests: 2 } : null },
            }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

describe("buildNew", () => {
  it("plans on Opus, researches on Sonnet (Opus for the hard item), escalates unconfirmed prices and verifies on Opus", async () => {
    let extractCalls = 0;
    const { client, calls } = fakeClient((system, user) => {
      if (system === PLAN_SYSTEM) return plan;
      if (system === RESEARCH_SYSTEM) return "notes";
      if (system === EXTRACT_SYSTEM) {
        extractCalls++;
        const ids = ["a", "b"].filter((id) => user.includes(`"id":"${id}"`));
        // The first pass can't confirm Bike B; the escalated pass can.
        return { items: ids.map((id) => extracted(id, id === "b" && extractCalls === 1 ? "unconfirmed" : "confirmed")), fx: [] };
      }
      if (system === VERIFY_SYSTEM) return { corrections: [{ itemId: "a", variant: "default", component: "running", amount: 80, reason: "tariff rose" }], recheckItemIds: [], scope: "Checked scope", limits: "Checked limits" };
      throw new Error("unexpected step");
    });
    const agent = new Agent("First build", 25, client);
    const spec = await buildNew(agent, "E-bikes in Singapore");

    expect(SpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.id).toBe("e-bikes-in-singapore");
    expect(spec.scope).toBe("Checked scope");
    expect(spec.items.find((i) => i.id === "a")!.costs.default.running).toBe(80);
    expect(spec.items.find((i) => i.id === "b")!.notes).not.toContain("treat as an estimate");

    const byStep = (s: string) => calls.filter((c) => c.system === s).map((c) => c.model);
    expect(byStep(PLAN_SYSTEM)).toEqual([OPUS]);
    expect(byStep(VERIFY_SYSTEM)).toEqual([OPUS]);
    // One batch with a hard item (Opus), then the escalated re-research of Bike B (Opus).
    expect(byStep(RESEARCH_SYSTEM)).toEqual([OPUS, OPUS]);
    expect(byStep(EXTRACT_SYSTEM)).toEqual([SONNET, OPUS]);
    expect(agent.log).toHaveLength(calls.length);
    expect(agent.log.every((e) => e.round === "First build")).toBe(true);
    expect(agent.log.filter((e) => e.searches === 4)).toHaveLength(2);
  });

  it("stops when the round's budget is spent", async () => {
    const { client } = fakeClient((system) => (system === PLAN_SYSTEM ? plan : "notes"));
    const agent = new Agent("First build", 0.01, client);
    await expect(buildNew(agent, "E-bikes")).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe("refine", () => {
  it("keeps a simple change on Sonnet and skips the Opus check", async () => {
    const current = readExample("compare");
    const updated = planFromSpec(current);
    updated.items.push({ id: "hybrid", group: "ice", name: "Hybrid car", option: "Cat A", duration: 10, researchQuestion: "q", hard: false });
    const { client, calls } = fakeClient((system) => {
      if (system === CLASSIFY_SYSTEM) return { kind: "simple", summary: "add a hybrid" };
      if (system === PATCH_SYSTEM) return { plan: updated, itemsToResearch: ["hybrid"] };
      if (system === RESEARCH_SYSTEM) return "notes";
      if (system === EXTRACT_SYSTEM)
        return { items: [{ ...extracted("hybrid", "confirmed"), costs: [{ variant: "default", amounts: [{ component: "purchase", amount: 190000 }, { component: "running", amount: 2000 }, { component: "upkeep", amount: 3700 }, { component: "upfront", amount: 0 }] }] }], fx: [] };
      throw new Error("unexpected step");
    });
    const next = await refine(new Agent("Refinement 1: add a hybrid", 25, client), current, "Add a hybrid car");
    expect(calls.every((c) => c.model === SONNET)).toBe(true);
    expect(calls.some((c) => c.system === VERIFY_SYSTEM)).toBe(false);
    expect(next.items.map((i) => i.id)).toContain("hybrid");
    expect(next.items.find((i) => i.id === "byd-atto-1")!.costs).toEqual(current.items.find((i) => i.id === "byd-atto-1")!.costs);
    expect(next.version).toBe(2);
    expect(SpecSchema.safeParse(next).success).toBe(true);
  });
});
