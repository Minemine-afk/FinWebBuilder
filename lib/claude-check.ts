/** Plain-words answer for a test call to Claude, so nobody has to read an HTTP status. */
export function describeApiStatus(status: number): { ok: boolean; message: string } {
  if (status === 200) return { ok: true, message: "Linked using API key" };
  if (status === 401 || status === 403) return { ok: false, message: "Failed: the API key is not accepted. Create a new key in the Claude Console and replace it." };
  if (status === 402) return { ok: false, message: "Failed: the Claude Console account has no credit. Add credit under Billing." };
  if (status === 429) return { ok: false, message: "Failed: rate or spending limit reached. Wait a few minutes and try again." };
  return { ok: false, message: `Failed: unexpected answer from Claude (HTTP ${status}). Try again; if it repeats, see the user guide.` };
}

/** One tiny call (a few tokens on the cheapest model) with the API key saved on the site. */
export async function checkApiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }),
    });
    return describeApiStatus(res.status);
  } catch {
    return { ok: false, message: "Failed: could not reach Claude (network problem). Try again." };
  }
}
