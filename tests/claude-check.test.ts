import { describe, expect, it } from "vitest";
import { checkApiKey, describeApiStatus } from "@/lib/claude-check";
import { checkResultFromSteps } from "@/lib/github";

describe("Claude link check", () => {
  it("explains each answer in plain words", () => {
    expect(describeApiStatus(200)).toEqual({ ok: true, message: "Linked using API key" });
    expect(describeApiStatus(401).message).toMatch(/not accepted/);
    expect(describeApiStatus(402).message).toMatch(/credit/);
    expect(describeApiStatus(429).message).toMatch(/limit/);
    expect(describeApiStatus(500).ok).toBe(false);
  });
  it("tests the key with one small call", async () => {
    let seen: { url: string; key: string; body: string } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, key: (init.headers as Record<string, string>)["x-api-key"], body: String(init.body) };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await checkApiKey("sk-test", fake)).toMatchObject({ ok: true });
    expect(seen!.key).toBe("sk-test");
    expect(JSON.parse(seen!.body).max_tokens).toBeLessThanOrEqual(16);
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await checkApiKey("k", down)).message).toMatch(/network/);
  });
  it("reads the answer from the workflow's result step", () => {
    expect(checkResultFromSteps([{ name: "Set up job" }, { name: "Result: Linked using subscription token" }])).toBe("Linked using subscription token");
    expect(checkResultFromSteps([{ name: "Set up job" }])).toBeNull();
    expect(checkResultFromSteps(undefined)).toBeNull();
  });
});
