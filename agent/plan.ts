/**
 * The cheap scoping step that runs before a build, on Haiku through the Claude Code GitHub Action
 * (.github/workflows/plan-calculator.yml), or directly on the API when the site has a key.
 *
 *   prepare   writes the prompt for the scoping run
 *   validate  checks plan.json (Claude Code runs this on what it wrote)
 *   publish   saves plan.json to the plans branch, where the site picks it up
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { planId, writePlanFile } from "@/lib/github";
import { clarifyPrompt, fallbackPlan, parsePlan, PlanSchema, type Plan } from "@/lib/plan";
import { playbookHint } from "@/lib/plan-server";
import { route } from "./models";

const PLAN_FILE = "plan.json";

function output(values: Record<string, string>) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [key, value] of Object.entries(values)) {
    const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
    fs.appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

function prepare() {
  const topic = process.env.TOPIC?.trim();
  if (!topic) throw new Error("No topic to scope.");
  output({
    model: route("clarify").model,
    prompt: `${clarifyPrompt(topic, playbookHint(topic))}\n\nWrite the JSON object to ${PLAN_FILE} (just the object), then run \`npx tsx agent/plan.ts validate\` and fix anything it reports. Do not use the web. Change no other file.`,
  });
}

/** Reads plan.json; if Haiku's JSON is unusable, the fallback plan is saved instead so the reader is never stuck. */
function loadPlan(topic: string): Plan {
  const text = fs.existsSync(PLAN_FILE) ? fs.readFileSync(PLAN_FILE, "utf8") : "";
  return parsePlan(text, topic) ?? fallbackPlan(topic);
}

function validate() {
  const topic = process.env.TOPIC?.trim() || "topic";
  const text = fs.existsSync(PLAN_FILE) ? fs.readFileSync(PLAN_FILE, "utf8") : "";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`${PLAN_FILE} is missing or isn't valid JSON.`);
    process.exit(1);
  }
  const r = PlanSchema.safeParse({ ...(raw as object), topic });
  if (!r.success) {
    console.error(r.error.issues.map((i) => `- ${i.path.join(".") || "(file)"}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  console.log("Plan is valid.");
}

async function publish() {
  const topic = process.env.TOPIC?.trim() ?? "";
  const id = process.env.PLAN_ID ?? "";
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  if (!planId(id) || !repo || !token) throw new Error("Publishing a plan needs PLAN_ID, GITHUB_REPOSITORY and GITHUB_TOKEN.");
  await writePlanFile({ repo, token }, id, JSON.stringify(loadPlan(topic)));
  console.log(`Saved plan ${id}.`);
}

const [command] = process.argv.slice(2);
if (command) {
  const run = command === "prepare" ? async () => prepare() : command === "validate" ? async () => validate() : command === "publish" ? publish : null;
  if (!run) {
    console.error(`Unknown command "${command}".`);
    process.exit(1);
  }
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
