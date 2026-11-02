import { z } from "zod";
import { checkApiKey } from "@/lib/claude-check";
import { dispatchWorkflow, githubConfig, latestCheckRun, passcodeOk } from "@/lib/github";

/**
 * Checks that the builder can reach Claude, for the "Check Claude link" panel.
 * - An ANTHROPIC_API_KEY saved on the site is tested directly: one tiny call, no GitHub involved.
 * - A Claude subscription token lives only in GitHub's secrets and cannot be read back, so the check runs the
 *   "Check Claude link" workflow there. The first request starts it; later requests (with `since`) read the answer.
 */
const Body = z.object({ passcode: z.string(), since: z.string().datetime().optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the passcode first." }, { status: 400 });
  if (!passcodeOk(parsed.data.passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && !parsed.data.since) {
    const r = await checkApiKey(apiKey);
    return Response.json({ mode: "direct", state: r.ok ? "done" : "failed", result: r.message });
  }

  const cfg = githubConfig();
  if (!cfg) return Response.json({ error: "The builder isn't connected to GitHub yet." }, { status: 503 });

  if (parsed.data.since) {
    const run = await latestCheckRun(cfg, parsed.data.since);
    return Response.json({ mode: "github", ...(run ?? { state: "waiting", result: null, url: `https://github.com/${cfg.repo}/actions` }) });
  }

  const since = new Date().toISOString();
  const status = await dispatchWorkflow(cfg, "check-claude-link.yml", {});
  if (status !== 204) return Response.json({ error: `GitHub refused the request (${status}). Check the site's GitHub token has Actions: Read and write.` }, { status: 502 });
  return Response.json({ mode: "github", state: "waiting", result: null, since, url: `https://github.com/${cfg.repo}/actions` });
}
