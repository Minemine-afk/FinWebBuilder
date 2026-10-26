/**
 * Runs the builder on a Claude subscription through the Claude Code GitHub Action
 * (anthropics/claude-code-action with CLAUDE_CODE_OAUTH_TOKEN) instead of the API agent.
 *
 *   prepare   writes the run's prompt and remembers the current version (before the action)
 *   validate  checks data/calculators/<slug>.json against the schema (Claude Code runs this)
 *   record    adds the run's token use to the build log and bumps the version (after the action)
 *
 * The lead session runs on Opus and hands price research to the price-researcher
 * sub-agent (.claude/agents/price-researcher.md), which runs on Sonnet.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { calculatorPath, readCalculator, writeCalculator } from "@/lib/data";
import { callCostSgd, formatSgd } from "@/lib/pricing";
import { renderCalculatorHtml } from "@/lib/render";
import { SpecSchema, slugify, type BuildLogEntry, type Spec } from "@/lib/spec";

const STATE_FILE = ".agent-run.json";

interface RunState {
  slug: string;
  round: string;
  previous: Spec | null;
}

function output(values: Record<string, string>) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [key, value] of Object.entries(values)) {
    const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
    fs.appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

export function buildPrompt(state: RunState, request: string): string {
  const file = `data/calculators/${state.slug}.json`;
  const task = state.previous
    ? `Update the existing calculator in ${file} to satisfy this follow-up request. Keep every option, id and price that the request doesn't affect.`
    : `Create a new calculator for this topic and save it as ${file}, with "id": "${state.slug}".`;
  return `You build cost-comparison calculators for a Singapore audience. Prices are in Singapore dollars unless the topic is clearly about another market.

${task}

<request>
${request}
</request>

How to work:
1. Read lib/spec.ts for the file format and data/calculators/ev-vs-petrol-car.json as a worked example.
2. Plan the calculator yourself: 3 to 6 real options people choose between, and 3 to 5 cost components (at least one recurring; one-off components are paid once at the start). Use buyer variants or monthly extras only when they genuinely apply.
3. Hand the price research to the price-researcher sub-agent, one or two options per call, several calls in parallel. It runs on a cheaper model. Start every sub-agent in the foreground (never with run_in_background) and wait for all of them to report: this is a single non-interactive run, so if you end your turn before the notes are back, nothing is saved.
4. Read its notes. Any price it marks UNCONFIRMED, or where sources clash, research again yourself before you use it.
5. Write the file. In each option's "notes", say how each figure was found, with dates; in "source", give the best URL, today's date as "verified", and "official", "secondary" or "estimate". Write "scope" and "limits" so a reader knows exactly what is and isn't included.
6. Check the numbers against each other and the notes, then run \`npx tsx agent/subscription.ts validate ${state.slug}\` and fix every error it reports until it passes.

Rules: you must finish by writing ${file} and passing validate in this same run; never end your turn with research still pending. Change no file except ${file}. Leave "version", "updated" and "buildLog" alone; the workflow sets them. Do not invent URLs or prices.`;
}

function prepare() {
  const topic = process.env.TOPIC?.trim();
  const prompt = process.env.PROMPT?.trim();
  let state: RunState;
  let request: string;
  if (topic) {
    const slug = slugify(process.env.SLUG || topic);
    if (readCalculator(slug)) throw new Error(`"${slug}" already exists. Refine it instead.`);
    state = { slug, round: "First build", previous: null };
    request = topic;
  } else {
    const slug = process.env.SLUG ?? "";
    const previous = readCalculator(slug);
    if (!previous || !prompt) throw new Error(`Refining needs an existing calculator and a prompt (got "${slug}").`);
    const n = new Set(previous.buildLog.map((e) => e.round).filter((r) => r.startsWith("Refinement"))).size + 1;
    state = { slug, round: `Refinement ${n}: ${prompt.slice(0, 60)}`, previous };
    request = prompt;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  output({ slug: state.slug, prompt: buildPrompt(state, request) });
}

function validate(slug: string) {
  const file = calculatorPath(slug);
  if (!fs.existsSync(file)) throw new Error(`${file} doesn't exist yet.`);
  const result = SpecSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!result.success) {
    console.error(result.error.issues.map((i) => `- ${i.path.join(".") || "(file)"}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  renderCalculatorHtml(result.data);
  console.log(`${file} is valid.`);
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  webSearchRequests?: number;
}

/** Turns the Claude Code execution log into build-log entries, one per model used. */
export function usageFromExecution(messages: unknown[], round: string): BuildLogEntry[] {
  const at = new Date().toISOString();
  const result = [...messages].reverse().find((m): m is Record<string, unknown> => !!m && (m as { type?: string }).type === "result");
  if (!result) return [];
  const byModel = (result.modelUsage ?? {}) as Record<string, ModelUsage>;
  return Object.entries(byModel).map(([model, u]) => ({
    round,
    label: /sonnet/.test(model) ? "Price research (sub-agents)" : /haiku/.test(model) ? "Background tasks" : "Planning, checking and writing",
    model,
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cacheRead: u.cacheReadInputTokens ?? 0,
    cacheWrite: u.cacheCreationInputTokens ?? 0,
    searches: u.webSearchRequests ?? 0,
    fetches: 0,
    billing: "subscription" as const,
    at,
  }));
}

/** What Claude Code said and was refused, so a run that wrote nothing explains itself in the log. */
export function describeRun(messages: unknown[]): string {
  const result = [...messages].reverse().find((m): m is Record<string, unknown> => !!m && (m as { type?: string }).type === "result");
  if (!result) return "The execution log has no result message.";
  const denials = Array.isArray(result.permission_denials) ? result.permission_denials : [];
  return [
    `Result: ${String(result.subtype)}${result.is_error ? " (error)" : ""}, ${String(result.num_turns)} turns.`,
    `Final message: ${String(result.result ?? "(none)").slice(0, 2000)}`,
    denials.length ? `Refused tool calls: ${JSON.stringify(denials).slice(0, 1000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function record() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RunState;
  const executionFile = process.env.EXECUTION_FILE;
  const messages = executionFile && fs.existsSync(executionFile) ? (JSON.parse(fs.readFileSync(executionFile, "utf8")) as unknown[]) : [];
  const written = readCalculator(state.slug);
  if (!written) throw new Error(`Claude Code didn't write data/calculators/${state.slug}.json.\n${describeRun(messages)}`);
  const entries = usageFromExecution(messages, state.round);
  const next: Spec = {
    ...written,
    id: state.slug,
    version: (state.previous?.version ?? 0) + 1,
    updated: new Date().toISOString().slice(0, 10),
    builtBy: state.previous?.builtBy,
    buildLog: [...(state.previous?.buildLog ?? []), ...entries],
  };
  writeCalculator(next, state.previous);
  const equivalent = entries.reduce((sum, e) => sum + callCostSgd(e), 0);
  const summary = entries.length
    ? `${state.round}: ran on the Claude subscription (about ${formatSgd(equivalent)} at API prices).`
    : `${state.round}: ran on the Claude subscription (usage not reported).`;
  console.log(summary);
  output({ slug: state.slug, summary });
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "prepare") prepare();
  else if (command === "validate") validate(arg ?? "");
  else if (command === "record") record();
  else if (command) throw new Error(`Unknown command "${command}".`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
