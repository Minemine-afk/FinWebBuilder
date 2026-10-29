/**
 * Runs the builder on a Claude subscription through the Claude Code GitHub Action
 * (anthropics/claude-code-action with CLAUDE_CODE_OAUTH_TOKEN) instead of the API agent.
 *
 *   prepare   writes the run's prompt and remembers the current version (before the action)
 *   validate  checks data/calculators/<slug>.json against the schema (Claude Code runs this)
 *   record    adds the run's token use to the build log and bumps the version (after the action)
 *
 * The scoping step before a build is agent/plan.ts. The quality check (lib/quality.ts) runs inside validate and again in record.
 * The lead session runs on Opus and hands price research to the price-researcher
 * sub-agent (.claude/agents/price-researcher.md), which runs on Sonnet.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { calculatorPath, listCalculators, readCalculator, writeCalculator } from "@/lib/data";
import { choiceText, PlanChoiceSchema, type PlanChoice } from "@/lib/plan";
import { callCostSgd, formatSgd } from "@/lib/pricing";
import { cachePrompt, readCache, updateCache } from "@/lib/price-cache";
import { checkQuality, DEFAULT_MIN_ITEMS, formatIssues, type QualityIssue } from "@/lib/quality";
import { renderCalculatorHtml } from "@/lib/render";
import { KINDS, SpecSchema, slugify, type BuildLogEntry, type Kind, type Spec } from "@/lib/spec";
import { findPlaybook, getPlaybook, playbookPrompt, type Playbook } from "./playbooks";

const STATE_FILE = ".agent-run.json";

interface RunState {
  slug: string;
  round: string;
  previous: Spec | null;
  /** Fewest options, lines or items the quality check accepts for this build. */
  minItems?: number;
}

/** What the scoping step, the topic's playbook and past builds add to a build's prompt. */
export interface PromptExtras {
  /** The kind the reader chose on the preview; the agent doesn't pick one. */
  kind?: Kind;
  playbook?: Playbook | null;
  /** Prices from earlier builds (lib/price-cache.ts), already formatted. */
  cache?: string;
  /** Refinement only: rebuild as this kind, keeping prices. */
  switchTo?: Kind;
  /** Refinement only: no web access, edit with what the file holds. */
  noResearch?: boolean;
}

function output(values: Record<string, string>) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [key, value] of Object.entries(values)) {
    const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
    fs.appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

/** Where a calculator kind's format notes and worked example live. */
// Kept outside data/calculators so removing a calculator from the site never removes the builder's examples.
export const FORMAT_EXAMPLES = {
  compare: "agent/examples/compare.json",
  estimate: "agent/examples/estimate.json",
  projection: "agent/examples/projection.json",
} as const;

/** Which model the price-researcher sub-agents run on; a build can ask for Opus when the research is hard. */
export function researchModel(): "sonnet" | "opus" {
  return process.env.RESEARCH_MODEL === "sonnet" ? "sonnet" : "opus";
}

const RESEARCH_BY_KIND = {
  compare: "one or two options per call: the current prices of each cost component",
  estimate: "one or two groups of lines per call: a realistic low and high price for one unit of each line at every quality level, with the size or quantity the price assumes",
  projection: "one or two items per call: today's value or price, plus its yearly growth or return over recent years and any published current rate, so low, base and high rates can be chosen",
} as const;

export function buildPrompt(state: RunState, request: string, research: "sonnet" | "opus" = "opus", extras: PromptExtras = {}): string {
  const agentModel = research === "opus" ? ` Start every price-researcher call with model "opus" (this build asked for the strongest research model).` : "";
  const file = `data/calculators/${state.slug}.json`;
  const switching = state.previous && extras.switchTo && extras.switchTo !== state.previous.kind ? extras.switchTo : null;
  const task = state.previous
    ? switching
      ? `Rebuild the existing ${state.previous.kind} calculator in ${file} as a "${switching}" calculator, in the same file with the same "id". Keep every price, source, date and rationale already in the file; reshape them into the new kind.`
      : `Update the existing calculator in ${file} to satisfy this follow-up request. Keep every option, id and price that the request doesn't affect.`
    : `Create a new calculator for this topic and save it as ${file}, with "id": "${state.slug}".`;
  const validateStep = (n: number) => `${n}. Run \`npx tsx agent/subscription.ts validate ${state.slug}\`. It checks the schema and then the quality check: enough options, a source URL and verified date on every price, a hover rationale on every figure, and maths that adds up. Fix every ERROR it reports (research only what an error needs) and run it again until it passes; fix warnings too when that is cheap.`;
  const how = state.previous
    ? switching
      ? `How to work:
1. Read ${file} and agent/formats/${switching}.md with ${FORMAT_EXAMPLES[switching]}. Do not read other calculators or lib/spec.ts. Set "kind" to "${switching}".
2. Rewrite ${file} in the new kind with one Write call, reusing the figures already there.
3. Research only a gap the new kind needs. If a new price is needed, call the price-researcher sub-agent for it only (foreground, never run_in_background), and wait for its notes.${agentModel}
${validateStep(4)}`
      : `How to work:
1. Read ${file} (the current spec, a "${state.previous.kind}" calculator) and agent/formats/${state.previous.kind}.md. Do not read other calculators or lib/spec.ts. Keep its "kind".
2. Edit ${file} in place with small Edit calls; never rewrite the whole file.
3. ${extras.noResearch ? "Do not use the web or any sub-agent: this refinement is edited from what the file already holds, so it stays cheap. If the request needs a price the file lacks, leave that part out and say so in your reply." : `Research only what the request needs. A request about wording, structure, years, durations or the figures already in the file needs no web access at all: just edit. If a new option or price is needed, call the price-researcher sub-agent for that option only (foreground, never run_in_background), and wait for its notes.${agentModel}`}
${validateStep(4)}`
    : `How to work:
1. ${extras.kind
      ? `The reader already chose the "${extras.kind}" kind: set "kind" to it and read only agent/formats/${extras.kind}.md with ${FORMAT_EXAMPLES[extras.kind]}. Do not read lib/spec.ts or other calculators.`
      : `Pick the calculator kind that fits the topic, then read only that kind's notes in agent/formats/ and its worked example. Do not read lib/spec.ts or other calculators.
   - compare: the topic is a choice between options ("A vs B", "which X", owning or using one thing versus another) and the answer is the total cost of each over a period.
   - estimate: the topic is the cost of one project or purchase whose price depends on size, scope or quality ("how much does X cost", "wedding", "renovation").
   - projection: the topic is about the future: a price or value growing over time ("future price of X", "how much will Y be worth"), or saving or investing toward a goal.
   If a topic could fit two, choose the one the reader most likely wants an answer from. Set "kind" to your choice. Notes: ${Object.entries(FORMAT_EXAMPLES).map(([k, f]) => `agent/formats/${k}.md with ${f}`).join("; ")}.`}
2. Plan the calculator yourself, as the kind's notes describe, with real options, lines or items people would recognise.${extras.cache ? " Items listed under \"Prices already researched\" below need no research; plan around them." : ""}
3. Hand the price research to the price-researcher sub-agent, one or two options, lines or items per call, several calls in parallel. For this kind, ask for: compare = ${RESEARCH_BY_KIND.compare}; estimate = ${RESEARCH_BY_KIND.estimate}; projection = ${RESEARCH_BY_KIND.projection}. ${research === "opus" ? agentModel.trim() : "It runs on a cheaper model."} Start every sub-agent in the foreground and wait for all of them to report: this is a single non-interactive run, so if you end your turn before the notes are back, nothing is saved. Never end your turn saying you will wait; the run is over when you stop.
   Past prices: whenever the calculator needs a provider's or option's own price history (a provider with a "history", or a projection item's past prices), do not settle for today's figure. For each provider's own pricing page or profile (including its Hometrust, Qanvast or similar listing) run \`npx tsx agent/datasets.ts archive-prices "<url>" --from <three years ago> --to <this year>\` yourself, which prints dated Internet Archive snapshots and the price lines in them, and have the price-researcher find dated reviews, quotes and articles for years the archive lacks. Use these real dated figures as the history, quote the snapshot URL, and mark a year ESTIMATE only after both searches found nothing, saying so in its rationale.
   For property prices in Singapore, use the official data tools in agent/formats/projection.md (HDB resale and URA indices) instead of researching those figures.
4. Read its notes. Only a price marked UNCONFIRMED, or where sources clash, may be researched again, and only with a WebSearch; do not open pages yourself.
5. Write the file. Give each source its best URL, today's date as "verified", and "official", "secondary" or "estimate" as its type, and say in the notes how each figure was found, with dates. Write "scope" and "limits" so a reader knows exactly what is and isn't included.
${validateStep(6)}`;
  const background = [
    !state.previous && extras.playbook ? `${playbookPrompt(extras.playbook)}${extras.kind ? "\nThe reader's confirmed scope in the request overrides this checklist and its minimum: cover what they ticked, skip what they left out." : ""}` : "",
    !state.previous && extras.cache ? extras.cache : "",
  ].filter(Boolean);
  return `You build calculators for a Singapore audience. Prices are in Singapore dollars unless the topic is clearly about another market.

${task}

<request>
${request}
</request>
${background.length ? `\n${background.join("\n\n")}\n` : ""}
${how}

Rules: follow the request exactly, including any minimum number of options, providers, locations or categories it asks for; every assumption gets a "rationale" (hover text). You must finish by writing ${file} and passing validate (schema and quality check) in this same run; never end your turn with research still pending. Change no file except ${file}. Leave "version", "updated" and "buildLog" alone; the workflow sets them. Do not invent URLs or prices. The page HTML is rendered from the JSON by the site, so never write HTML, and never print the whole file back in your reply.`;
}

/** "at least 12 providers" in the request raises the quality check's minimum. */
export function requestedMinimum(request: string): number | undefined {
  const m = /\b(?:at least|minimum(?: of)?|no fewer than)\s+(\d{1,3})\b/i.exec(request);
  return m ? Number(m[1]) : undefined;
}

/** The scope the reader confirmed on the plan preview, from the PLAN input. A bad value is ignored, not fatal. */
function readChoice(raw: string | undefined): PlanChoice | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = PlanChoiceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function prepare() {
  const topic = process.env.TOPIC?.trim();
  const prompt = process.env.PROMPT?.trim();
  let state: RunState;
  let request: string;
  const extras: PromptExtras = {};
  if (topic) {
    const slug = slugify(process.env.SLUG || topic);
    if (readCalculator(slug)) throw new Error(`"${slug}" already exists. Refine it instead.`);
    const choice = readChoice(process.env.PLAN);
    const playbook = getPlaybook(choice?.playbook) ?? findPlaybook(topic);
    request = choice ? `${topic}\n${choiceText(choice)}` : topic;
    extras.playbook = playbook;
    extras.cache = cachePrompt([topic, ...(choice?.include ?? [])].join(" "), readCache());
    if (choice) extras.kind = choice.kind;
    const kind: Kind = choice?.kind ?? playbook?.kind ?? "compare";
    // Fewer ticked items than the playbook's usual count means the reader asked for a smaller calculator.
    const usual = playbook?.minItems ?? DEFAULT_MIN_ITEMS[kind];
    const minItems = requestedMinimum(topic) ?? (choice?.include.length ? Math.min(usual, choice.include.length) : usual);
    state = { slug, round: "First build", previous: null, minItems };
  } else {
    const slug = process.env.SLUG ?? "";
    const previous = readCalculator(slug);
    if (!previous || !prompt) throw new Error(`Refining needs an existing calculator and a prompt (got "${slug}").`);
    const n = new Set(previous.buildLog.map((e) => e.round).filter((r) => r.startsWith("Refinement"))).size + 1;
    const switchTo = KINDS.find((k) => k === process.env.KIND);
    extras.switchTo = switchTo;
    extras.noResearch = process.env.NO_RESEARCH === "true";
    state = { slug, round: `Refinement ${n}: ${prompt.slice(0, 60)}`, previous };
    request = prompt;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  // Refinements patch an existing spec, so the cheaper model leads; a new build keeps Opus for planning.
  // Converting a calculator to another kind rebuilds the file, so it keeps the strong model too.
  const rebuild = !!extras.switchTo && extras.switchTo !== state.previous?.kind;
  output({ slug: state.slug, prompt: buildPrompt(state, request, researchModel(), extras), model: state.previous && !rebuild ? "claude-sonnet-5-5" : "claude-opus-5-5" });
}

function readState(): RunState | null {
  return fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RunState) : null;
}

const issueKey = (i: QualityIssue) => `${i.where}|${i.message}`;

/**
 * The quality check for a finished spec. On a refinement, problems the earlier version already had are only
 * warnings, so a small edit isn't blocked by old gaps; anything new is an error.
 */
export function qualityReport(spec: Spec, state: RunState | null): { errors: QualityIssue[]; warnings: QualityIssue[] } {
  const opts = { minItems: state?.minItems };
  const before = new Set(state?.previous ? checkQuality(state.previous, opts).map(issueKey) : []);
  const errors: QualityIssue[] = [];
  const warnings: QualityIssue[] = [];
  for (const issue of checkQuality(spec, opts)) {
    if (issue.level === "error" && !before.has(issueKey(issue))) errors.push(issue);
    else warnings.push(issue.level === "error" ? { ...issue, level: "warning", message: `${issue.message} (already in the earlier version)` } : issue);
  }
  return { errors, warnings };
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
  const { errors, warnings } = qualityReport(result.data, readState());
  if (warnings.length) console.log(`Quality warnings (fix when cheap):\n${formatIssues(warnings)}`);
  if (errors.length) {
    console.error(`Quality check failed. Fix these and run validate again:\n${formatIssues(errors)}`);
    process.exit(1);
  }
  console.log(`${file} is valid and passes the quality check.`);
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  webSearchRequests?: number;
  costUSD?: number;
}

/** Turns the Claude Code execution log into build-log entries, one per model used. */
export function usageFromExecution(messages: unknown[], round: string): BuildLogEntry[] {
  const at = new Date().toISOString();
  const result = [...messages].reverse().find((m): m is Record<string, unknown> => !!m && (m as { type?: string }).type === "result");
  if (!result) return [];
  const byModel = (result.modelUsage ?? {}) as Record<string, ModelUsage>;
  return Object.entries(byModel).map(([model, u]) => ({
    round,
    label: /sonnet/.test(model) ? "Price research (sub-agents)" : /haiku/.test(model) ? "Reading fetched pages" : "Planning, checking and writing",
    model,
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cacheRead: u.cacheReadInputTokens ?? 0,
    cacheWrite: u.cacheCreationInputTokens ?? 0,
    searches: u.webSearchRequests ?? 0,
    fetches: 0,
    billing: "subscription" as const,
    ...(typeof u.costUSD === "number" ? { reportedUsd: u.costUSD } : {}),
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
  // The same quality check the agent was told to pass; if it still fails, nothing is saved or published.
  const { errors, warnings } = qualityReport(next, state);
  if (errors.length) throw new Error(`The calculator failed the quality check, so it was not published:\n${formatIssues(errors)}`);
  writeCalculator(next, state.previous);
  updateCache(next);
  const equivalent = entries.reduce((sum, e) => sum + callCostSgd(e), 0);
  const checked = `Quality check passed${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`;
  const summary = entries.length
    ? `${state.round}: ran on the Claude subscription (about ${formatSgd(equivalent)} at API prices). ${checked}`
    : `${state.round}: ran on the Claude subscription (usage not reported). ${checked}`;
  console.log(summary);
  output({ slug: state.slug, summary });
}

/** Rebuilds data/price-cache.json from every calculator on the site (run once to seed the cache). */
function rebuildCache() {
  let total = 0;
  for (const spec of listCalculators()) total = updateCache(spec).length;
  console.log(`Price cache has ${total} entries.`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "prepare") prepare();
  else if (command === "validate") validate(arg ?? "");
  else if (command === "record") record();
  else if (command === "rebuild-cache") rebuildCache();
  else if (command) throw new Error(`Unknown command "${command}".`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
