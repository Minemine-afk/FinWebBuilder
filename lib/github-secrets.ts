import sodium from "libsodium-wrappers";
import { githubHeaders } from "@/lib/github";

/** The only repository secrets the Setup page may touch. */
export const CLAUDE_SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
export type ClaudeSecret = (typeof CLAUDE_SECRETS)[number];

type Cfg = { repo: string; token: string };

/** Catches pastes of the wrong kind of value before they are saved. */
export function checkSecretShape(name: ClaudeSecret, value: string): string | null {
  const v = value.trim();
  if (/\s/.test(v)) return "The value has spaces or line breaks in it. Copy it again, whole and on one line.";
  if (name === "CLAUDE_CODE_OAUTH_TOKEN" && !v.startsWith("sk-ant-oat")) return "A subscription token starts with sk-ant-oat. Run `claude setup-token` and copy what it prints.";
  if (name === "ANTHROPIC_API_KEY" && (!v.startsWith("sk-ant-") || v.startsWith("sk-ant-oat"))) return "An API key starts with sk-ant- (from the Claude Console). A subscription token goes in the other box.";
  if (v.length < 40) return "That looks too short to be complete. Copy it again.";
  return null;
}

/** Encrypts a value for GitHub with the repository's public key (a libsodium sealed box), as the secrets API requires. */
export async function encryptForGitHub(publicKeyBase64: string, value: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

export interface SetupStatus {
  /** What the site's GitHub token can do, in plain words; null means fine. */
  github: { ok: boolean; message: string };
  /** Which secrets exist (names only; GitHub never returns values). */
  secrets: Record<ClaudeSecret, boolean>;
}

export async function setupStatus(cfg: Cfg): Promise<SetupStatus> {
  const headers = githubHeaders(cfg.token);
  const api = `https://api.github.com/repos/${cfg.repo}`;
  const secrets: Record<ClaudeSecret, boolean> = { CLAUDE_CODE_OAUTH_TOKEN: false, ANTHROPIC_API_KEY: false };
  const repo = await fetch(api, { headers, cache: "no-store" });
  if (repo.status === 401) return { github: { ok: false, message: "GitHub does not accept the site's token. It is wrong or expired; create a new one." }, secrets };
  if (repo.status === 404) return { github: { ok: false, message: "The token can't see this repository. Check GITHUB_REPOSITORY and that the token was created for this repository." }, secrets };
  if (!repo.ok) return { github: { ok: false, message: `GitHub answered ${repo.status}. Try again.` }, secrets };
  const list = await fetch(`${api}/actions/secrets?per_page=100`, { headers, cache: "no-store" });
  if (list.status === 403 || list.status === 404) {
    return { github: { ok: false, message: "Connected, but the token lacks the Secrets permission. Edit the token and set Secrets to Read and write." }, secrets };
  }
  if (list.ok) {
    const names = ((await list.json()) as { secrets: { name: string }[] }).secrets.map((s) => s.name);
    for (const n of CLAUDE_SECRETS) secrets[n] = names.includes(n);
  }
  return { github: { ok: true, message: "Connected to GitHub." }, secrets };
}

export async function saveSecret(cfg: Cfg, name: ClaudeSecret, value: string): Promise<{ ok: boolean; message: string }> {
  const headers = githubHeaders(cfg.token);
  const api = `https://api.github.com/repos/${cfg.repo}/actions/secrets`;
  const pk = await fetch(`${api}/public-key`, { headers, cache: "no-store" });
  if (pk.status === 403 || pk.status === 404) return { ok: false, message: "The site's GitHub token can't write secrets. Edit it and set Secrets to Read and write." };
  if (!pk.ok) return { ok: false, message: `GitHub answered ${pk.status}. Try again.` };
  const { key_id, key } = (await pk.json()) as { key_id: string; key: string };
  const put = await fetch(`${api}/${name}`, { method: "PUT", headers, body: JSON.stringify({ encrypted_value: await encryptForGitHub(key, value.trim()), key_id }) });
  if (put.status !== 201 && put.status !== 204) return { ok: false, message: `GitHub refused to save it (${put.status}).` };
  return { ok: true, message: "Saved to GitHub." };
}

export async function removeSecret(cfg: Cfg, name: ClaudeSecret): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/secrets/${name}`, { method: "DELETE", headers: githubHeaders(cfg.token) });
  return res.status === 204 || res.status === 404 ? { ok: true, message: "Removed." } : { ok: false, message: `GitHub refused (${res.status}).` };
}
