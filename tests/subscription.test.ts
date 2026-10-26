import { describe, expect, it } from "vitest";
import { buildPrompt, usageFromExecution } from "@/agent/subscription";
import { readCalculator } from "@/lib/data";
import { callCostSgd } from "@/lib/pricing";

describe("usageFromExecution", () => {
  it("makes one subscription entry per model from the run's result message", () => {
    const messages = [
      { type: "system", subtype: "init", model: "claude-opus-5-5" },
      { type: "assistant" },
      {
        type: "result",
        subtype: "success",
        modelUsage: {
          "claude-opus-5-5": { inputTokens: 50_000, outputTokens: 20_000, cacheReadInputTokens: 900_000, cacheCreationInputTokens: 60_000, webSearchRequests: 3 },
          "claude-sonnet-5-5": { inputTokens: 200_000, outputTokens: 30_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 25 },
        },
      },
    ];
    const entries = usageFromExecution(messages, "First build");
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.billing === "subscription" && e.round === "First build")).toBe(true);
    const sonnet = entries.find((e) => e.model === "claude-sonnet-5-5")!;
    expect(sonnet.label).toBe("Price research (sub-agents)");
    expect(sonnet.searches).toBe(25);
    expect(callCostSgd(sonnet)).toBeGreaterThan(0);
  });
  it("returns nothing when the log has no result", () => {
    expect(usageFromExecution([{ type: "assistant" }], "First build")).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("names the file, the request and the validate command", () => {
    const p = buildPrompt({ slug: "e-bikes", round: "First build", previous: null }, "E-bikes in Singapore");
    expect(p).toContain("data/calculators/e-bikes.json");
    expect(p).toContain("<request>\nE-bikes in Singapore\n</request>");
    expect(p).toContain("npx tsx agent/subscription.ts validate e-bikes");
    expect(p).toContain("price-researcher");
  });
  it("asks a refinement to keep what the request doesn't touch", () => {
    const previous = readCalculator("ev-vs-petrol-car")!;
    const p = buildPrompt({ slug: previous.id, round: "Refinement 1: x", previous }, "Add a hybrid car");
    expect(p).toContain("Keep every option");
    expect(p).toContain("never rewrite the whole file");
    expect(p).not.toContain("worked example");
  });
});
