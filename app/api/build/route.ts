import { z } from "zod";
import { dispatchWorkflow, githubConfig, passcodeOk } from "@/lib/github";
import { PlanChoiceSchema } from "@/lib/plan";
import { KINDS } from "@/lib/spec";

/**
 * Starts the research agent: dispatches the build-calculator GitHub Actions workflow.
 * Needs BUILDER_PASSCODE, GITHUB_TOKEN (fine-grained, Actions: write on this repo) and
 * GITHUB_REPOSITORY (owner/repo) in the hosting environment.
 */
const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    passcode: z.string(),
    topic: z.string().trim().min(3).max(200),
    /** The scope the reader confirmed on the plan preview (app/api/plan). Leave out to let the agent decide. */
    plan: PlanChoiceSchema.optional(),
    research: z.enum(["sonnet", "opus"]).optional(),
  }),
  z.object({
    mode: z.literal("refine"),
    passcode: z.string(),
    slug: z.string().regex(/^[a-z0-9-]{1,48}$/),
    prompt: z.string().trim().min(3).max(500),
    /** Rebuild the calculator as another kind, keeping its prices. */
    kind: z.enum(KINDS).optional(),
    /** Edit with what the file already holds: no web access, so the run is cheaper. */
    noResearch: z.boolean().optional(),
  }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the form and try again." }, { status: 400 });
  const body = parsed.data;
  if (!passcodeOk(body.passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });

  const cfg = githubConfig();
  if (!cfg) return Response.json({ error: "The builder isn't connected to GitHub yet." }, { status: 503 });

  const inputs: Record<string, string> =
    body.mode === "new"
      ? { topic: body.topic, ...(body.plan ? { plan: JSON.stringify(body.plan) } : {}), ...(body.research ? { research_model: body.research } : {}) }
      : { slug: body.slug, prompt: body.prompt, ...(body.kind ? { kind: body.kind } : {}), ...(body.noResearch ? { no_research: "true" } : {}) };
  const status = await dispatchWorkflow(cfg, "build-calculator.yml", inputs);
  if (status !== 204) return Response.json({ error: `GitHub refused the request (${status}).` }, { status: 502 });
  return Response.json({ ok: true, runsUrl: `https://github.com/${cfg.repo}/actions/workflows/build-calculator.yml` });
}
