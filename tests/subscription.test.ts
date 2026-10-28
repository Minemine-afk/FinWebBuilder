import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { buildPrompt, FORMAT_EXAMPLES, usageFromExecution } from "@/agent/subscription";
import { readExample } from "@/lib/data";
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
          "claude-sonnet-5-5": { inputTokens: 200_000, outputTokens: 30_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 25, costUSD: 0.5 },
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
    expect(sonnet.reportedUsd).toBeCloseTo(0.5, 6);
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
  it("makes the agent pick one of the three kinds and read only that kind's notes", () => {
    const p = buildPrompt({ slug: "x", round: "First build", previous: null }, "Wedding in Singapore");
    for (const kind of ["compare", "estimate", "projection"]) {
      expect(p).toContain(`agent/formats/${kind}.md`);
      expect(fs.existsSync(`agent/formats/${kind}.md`)).toBe(true);
      expect(fs.existsSync(FORMAT_EXAMPLES[kind as keyof typeof FORMAT_EXAMPLES])).toBe(true);
    }
    expect(p).toContain("Do not read lib/spec.ts");
  });
  it("asks a refinement to keep what the request doesn't touch", () => {
    const previous = readExample("compare");
    const p = buildPrompt({ slug: previous.id, round: "Refinement 1: x", previous }, "Add a hybrid car");
    expect(p).toContain("Keep every option");
    expect(p).toContain("never rewrite the whole file");
    expect(p).not.toContain("worked example");
    expect(p).toContain("agent/formats/compare.md");
    expect(p).not.toContain("lib/spec.ts and");
  });
});
