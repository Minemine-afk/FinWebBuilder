import { z } from "zod";
import { dispatchWorkflow, githubConfig, passcodeOk, planId, readPlanFile } from "@/lib/github";
import { fallbackPlan, PlanSchema } from "@/lib/plan";
import { cachedItemIds, newPlanId, planWithApi } from "@/lib/plan-server";

/**
 * Scopes a topic before any research is paid for: picks the calculator kind, proposes the options to cover and
 * at most two questions. With an ANTHROPIC_API_KEY on the site, one Haiku call answers straight away. Otherwise
 * the cheap `Plan calculator` workflow runs Haiku on the subscription, and the page polls GET until its plan arrives.
 * The built-in fallback plan comes back with the request, so the reader is never stuck waiting.
 */
const Body = z.object({ passcode: z.string(), topic: z.string().trim().min(3).max(200) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the topic and try again." }, { status: 400 });
  const { passcode, topic } = parsed.data;
  if (!passcodeOk(passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });

  if (process.env.ANTHROPIC_API_KEY) {
    const plan = await planWithApi(topic);
    return Response.json({ status: "ready", plan, cached: cachedItemIds(plan) });
  }

  const cfg = githubConfig();
  const draft = fallbackPlan(topic);
  if (!cfg) return Response.json({ status: "ready", plan: draft, cached: cachedItemIds(draft) });
  const id = newPlanId();
  const status = await dispatchWorkflow(cfg, "plan-calculator.yml", { topic, plan_id: id });
  // If the scoping step can't start, the fallback plan still lets the reader build.
  if (status !== 204) return Response.json({ status: "ready", plan: draft, cached: cachedItemIds(draft) });
  return Response.json({ status: "pending", planId: id, draft, cached: cachedItemIds(draft) });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const cfg = githubConfig();
  if (!planId(id) || !cfg) return Response.json({ error: "Unknown plan." }, { status: 400 });
  const text = await readPlanFile(cfg, id);
  if (text === "pending" || text === null) return Response.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return Response.json({ status: "pending" });
  }
  const plan = PlanSchema.safeParse(saved);
  if (!plan.success) return Response.json({ status: "pending" });
  return Response.json({ status: "ready", plan: plan.data, cached: cachedItemIds(plan.data) }, { headers: { "cache-control": "no-store" } });
}
