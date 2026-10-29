import { timingSafeEqual } from "node:crypto";

/** Shared by the API routes that start, remove and follow calculator builds through GitHub Actions. */

export function passcodeOk(given: string) {
  const expected = process.env.BUILDER_PASSCODE;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function githubConfig() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return null;
  return { repo, token };
}

export function githubHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export type WorkflowFile = "build-calculator.yml" | "remove-calculator.yml" | "plan-calculator.yml";

/** Starts a workflow on the site's branch. Returns the HTTP status GitHub answered with. */
export async function dispatchWorkflow(cfg: { repo: string; token: string }, workflow: WorkflowFile, inputs: Record<string, string>) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: githubHeaders(cfg.token),
    body: JSON.stringify({ ref: process.env.GITHUB_BRANCH ?? "main", inputs }),
  });
  return res.status;
}

export type RunKind = "build" | "refine" | "remove" | "plan";

export interface RunSummary {
  id: number;
  kind: RunKind;
  /** The topic, or the calculator being changed or removed. */
  title: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  /** What the run is doing now, in plain words. */
  step: string;
  /** 0 to 1, from the workflow's finished steps. */
  progress: number;
  startedAt: string;
  url: string;
}

interface ApiRun {
  id: number;
  /** Workflow file, e.g. .github/workflows/build-calculator.yml. The `name` field is the run-name once a workflow sets one, so match on this. */
  path: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}
interface ApiJob {
  steps?: { name: string; status: string; conclusion: string | null }[];
}

/** Workflow steps worth showing, in order, with the wording a visitor sees. */
const STEP_LABELS: [match: RegExp, label: string][] = [
  [/^Run npm ci/, "Setting up"],
  [/^Prepare the subscription run|^Run the research agent/, "Planning the calculator"],
  [/^Research with Claude Code/, "Researching prices on the web"],
  [/^Record the subscription run/, "Checking and saving the numbers"],
  [/^Check the site still builds/, "Checking the site still builds"],
  [/^Publish/, "Publishing"],
  [/^Remove/, "Removing"],
  [/^Scope the topic/, "Scoping the topic"],
];

export function describeRun(run: ApiRun, job: ApiJob | undefined): RunSummary {
  const title = run.display_title.replace(/^(Build|Refine|Remove|Plan): /, "");
  const kind: RunKind = run.display_title.startsWith("Remove") ? "remove" : run.display_title.startsWith("Refine") ? "refine" : run.display_title.startsWith("Plan") ? "plan" : "build";
  const state: RunSummary["state"] =
    run.status !== "completed"
      ? run.status === "in_progress"
        ? "running"
        : "queued"
      : run.conclusion === "success"
        ? "done"
        : run.conclusion === "cancelled"
          ? "cancelled"
          : "failed";

  const steps = (job?.steps ?? []).filter((s) => STEP_LABELS.some(([re]) => re.test(s.name)));
  const active = steps.find((s) => s.status === "in_progress");
  const label = (name?: string) => STEP_LABELS.find(([re]) => name && re.test(name))?.[1];
  let step = "Waiting to start";
  if (state === "done") step = kind === "remove" ? "Removed. The site updates in about a minute." : kind === "plan" ? "Scope ready." : "Published. The site updates in about a minute.";
  else if (state === "failed") step = "The build failed. Nothing was published.";
  else if (state === "cancelled") step = "Stopped.";
  else if (state === "running") step = label(active?.name) ?? "Starting";

  // Research is most of the wait, so give it more of the bar than the quick steps around it.
  const weight = (name: string) => (/^Research with Claude Code/.test(name) ? 6 : 1);
  const total = steps.reduce((sum, s) => sum + weight(s.name), 0);
  const doneWeight = steps.filter((s) => s.status === "completed").reduce((sum, s) => sum + weight(s.name), 0);
  const progress = state === "done" ? 1 : total ? Math.min(0.95, doneWeight / total) : 0;

  return { id: run.id, kind, title, state, step, progress, startedAt: run.created_at, url: run.html_url };
}

const WORKFLOW_PATHS = new Set([".github/workflows/build-calculator.yml", ".github/workflows/remove-calculator.yml", ".github/workflows/plan-calculator.yml"]);

/** The build and removal runs still going, with the current step of each. */
export async function activeRuns(cfg: { repo: string; token: string }): Promise<RunSummary[]> {
  const headers = githubHeaders(cfg.token);
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/runs?event=workflow_dispatch&per_page=12`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { workflow_runs: ApiRun[] };
  const runs = data.workflow_runs.filter((r) => WORKFLOW_PATHS.has(r.path) && r.status !== "completed");
  return Promise.all(
    runs.map(async (run) => {
      const jobs = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/runs/${run.id}/jobs`, { headers, cache: "no-store" });
      const job = jobs.ok ? ((await jobs.json()) as { jobs: ApiJob[] }).jobs[0] : undefined;
      return describeRun(run, job);
    }),
  );
}

/**
 * Plans from the scoping step live on their own branch, one small file each, so they never trigger a site deploy
 * or crowd main's history. The site reads them back through the GitHub contents API.
 */
export const PLANS_BRANCH = "builder-plans";
const PLAN_ID = /^[a-f0-9]{12}$/;
export const planId = (value: string) => PLAN_ID.test(value);
export const planFile = (id: string) => `plans/${id}.json`;

/** The saved plan JSON as text, "pending" while the scoping step hasn't written it, or null if GitHub can't be read. */
export async function readPlanFile(cfg: { repo: string; token: string }, id: string): Promise<string | "pending" | null> {
  if (!planId(id)) return null;
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${planFile(id)}?ref=${PLANS_BRANCH}`, {
    headers: { ...githubHeaders(cfg.token), accept: "application/vnd.github.raw+json" },
    cache: "no-store",
  });
  if (res.status === 404) return "pending";
  return res.ok ? res.text() : null;
}

/** Saves a plan to the plans branch, creating the branch from the default branch the first time. */
export async function writePlanFile(cfg: { repo: string; token: string }, id: string, json: string): Promise<void> {
  if (!planId(id)) throw new Error(`"${id}" is not a plan id.`);
  const api = `https://api.github.com/repos/${cfg.repo}`;
  const headers = githubHeaders(cfg.token);
  const branch = await fetch(`${api}/git/ref/heads/${PLANS_BRANCH}`, { headers });
  if (branch.status === 404) {
    const repo = (await (await fetch(api, { headers })).json()) as { default_branch: string };
    const base = (await (await fetch(`${api}/git/ref/heads/${repo.default_branch}`, { headers })).json()) as { object: { sha: string } };
    const created = await fetch(`${api}/git/refs`, { method: "POST", headers, body: JSON.stringify({ ref: `refs/heads/${PLANS_BRANCH}`, sha: base.object.sha }) });
    if (!created.ok && created.status !== 422) throw new Error(`Couldn't create the ${PLANS_BRANCH} branch (${created.status}).`);
  }
  const put = await fetch(`${api}/contents/${planFile(id)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `Plan ${id}`, content: Buffer.from(json).toString("base64"), branch: PLANS_BRANCH }),
  });
  if (!put.ok) throw new Error(`Couldn't save the plan (${put.status}).`);
}
