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

export type WorkflowFile = "build-calculator.yml" | "remove-calculator.yml";

/** Starts a workflow on the site's branch. Returns the HTTP status GitHub answered with. */
export async function dispatchWorkflow(cfg: { repo: string; token: string }, workflow: WorkflowFile, inputs: Record<string, string>) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: githubHeaders(cfg.token),
    body: JSON.stringify({ ref: process.env.GITHUB_BRANCH ?? "main", inputs }),
  });
  return res.status;
}

export type RunKind = "build" | "refine" | "remove";

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
  name: string | null;
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
];

export function describeRun(run: ApiRun, job: ApiJob | undefined): RunSummary {
  const title = run.display_title.replace(/^(Build|Refine|Remove): /, "");
  const kind: RunKind = run.display_title.startsWith("Remove") ? "remove" : run.display_title.startsWith("Refine") ? "refine" : "build";
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
  if (state === "done") step = kind === "remove" ? "Removed. The site updates in about a minute." : "Published. The site updates in about a minute.";
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

const WORKFLOW_NAMES = new Set(["Build calculator", "Remove calculator"]);

/** The most recent build and removal runs, with the current step of any still going. */
export async function recentRuns(cfg: { repo: string; token: string }, sinceMs = 6 * 60 * 60 * 1000): Promise<RunSummary[]> {
  const headers = githubHeaders(cfg.token);
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/runs?event=workflow_dispatch&per_page=12`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { workflow_runs: ApiRun[] };
  const cutoff = Date.now() - sinceMs;
  const runs = data.workflow_runs.filter((r) => WORKFLOW_NAMES.has(r.name ?? "") && Date.parse(r.created_at) >= cutoff).slice(0, 6);
  return Promise.all(
    runs.map(async (run) => {
      let job: ApiJob | undefined;
      if (run.status !== "completed") {
        const jobs = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/runs/${run.id}/jobs`, { headers, cache: "no-store" });
        if (jobs.ok) job = ((await jobs.json()) as { jobs: ApiJob[] }).jobs[0];
      }
      return describeRun(run, job);
    }),
  );
}
