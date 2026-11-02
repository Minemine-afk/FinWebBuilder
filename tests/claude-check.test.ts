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

import { checkSecretShape, encryptForGitHub } from "@/lib/github-secrets";
import sodium from "libsodium-wrappers";

describe("Setup secrets", () => {
  const oat = "sk-ant-oat01-" + "a".repeat(60);
  const key = "sk-ant-api03-" + "b".repeat(60);
  it("rejects values pasted into the wrong box or cut short", () => {
    expect(checkSecretShape("CLAUDE_CODE_OAUTH_TOKEN", oat)).toBeNull();
    expect(checkSecretShape("ANTHROPIC_API_KEY", key)).toBeNull();
    expect(checkSecretShape("ANTHROPIC_API_KEY", oat)).toMatch(/other box/);
    expect(checkSecretShape("CLAUDE_CODE_OAUTH_TOKEN", key)).toMatch(/sk-ant-oat/);
    expect(checkSecretShape("ANTHROPIC_API_KEY", "sk-ant-short")).toMatch(/short/);
    expect(checkSecretShape("ANTHROPIC_API_KEY", key + "\nmore")).toMatch(/spaces/);
  });
  it("seals the value so only the repository's private key can open it", async () => {
    await sodium.ready;
    const pair = sodium.crypto_box_keypair();
    const sealed = await encryptForGitHub(sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL), "secret-value");
    const opened = sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey);
    expect(sodium.to_string(opened)).toBe("secret-value");
    expect(sealed).not.toContain("secret-value");
  });
});
