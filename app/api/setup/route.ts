import { z } from "zod";
import { githubConfig, passcodeOk } from "@/lib/github";
import { CLAUDE_SECRETS, checkSecretShape, removeSecret, saveSecret, setupStatus } from "@/lib/github-secrets";

/**
 * Setup page backend: shows what is connected, and saves or removes the Claude credential as a GitHub repository secret.
 * The value is encrypted with the repository's public key and sent straight on. It is never logged, stored on the
 * site or returned, and GitHub never returns it either. Needs BUILDER_PASSCODE and a GITHUB_TOKEN with Secrets: Read and write.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), passcode: z.string() }),
  z.object({ action: z.literal("save"), passcode: z.string(), name: z.enum(CLAUDE_SECRETS), value: z.string().max(500) }),
  z.object({ action: z.literal("remove"), passcode: z.string(), name: z.enum(CLAUDE_SECRETS) }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the passcode first." }, { status: 400 });
  const body = parsed.data;
  if (!passcodeOk(body.passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });
  const cfg = githubConfig();
  if (!cfg) return Response.json({ error: "The site has no GitHub connection yet. Add GITHUB_TOKEN and GITHUB_REPOSITORY in Vercel first." }, { status: 503 });

  if (body.action === "save") {
    const problem = checkSecretShape(body.name, body.value);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    const r = await saveSecret(cfg, body.name, body.value);
    if (!r.ok) return Response.json({ error: r.message }, { status: 502 });
  } else if (body.action === "remove") {
    const r = await removeSecret(cfg, body.name);
    if (!r.ok) return Response.json({ error: r.message }, { status: 502 });
  }
  return Response.json(await setupStatus(cfg), { headers: { "cache-control": "no-store" } });
}
