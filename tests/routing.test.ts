import { describe, expect, it } from "vitest";
import { OPUS, route, SONNET } from "@/agent/models";

describe("route", () => {
  it("plans and verifies on Opus", () => {
    expect(route("plan").model).toBe(OPUS);
    expect(route("verify").model).toBe(OPUS);
  });
  it("researches and extracts on Sonnet by default", () => {
    expect(route("research").model).toBe(SONNET);
    expect(route("extract").model).toBe(SONNET);
    expect(route("classify").model).toBe(SONNET);
  });
  it("moves to Opus for hard items, escalations and open-ended refinements", () => {
    expect(route("research", { hardItem: true }).model).toBe(OPUS);
    expect(route("research", { escalated: true }).model).toBe(OPUS);
    expect(route("extract", { escalated: true }).model).toBe(OPUS);
    expect(route("patch", { openEnded: true }).model).toBe(OPUS);
    expect(route("patch").model).toBe(SONNET);
  });
});
