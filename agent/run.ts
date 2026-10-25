/**
 * Builds or refines one calculator and saves it to data/calculators/<slug>.json.
 *
 *   npm run agent -- --topic "Owning an e-bike in Singapore"
 *   npm run agent -- --slug ev-vs-petrol-car --prompt "Add a hybrid car"
 *
 * Needs ANTHROPIC_API_KEY. MAX_SPEND_SGD caps one run (default 25).
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readCalculator, writeCalculator } from "@/lib/data";
import { formatSgd } from "@/lib/pricing";
import { slugify, SpecSchema } from "@/lib/spec";
import { Agent } from "./llm";
import { buildNew, refine } from "./pipeline";

async function main() {
  const { values } = parseArgs({
    options: { topic: { type: "string" }, slug: { type: "string" }, prompt: { type: "string" } },
  });
  const budget = Number(process.env.MAX_SPEND_SGD ?? 25);

  let label: string;
  let save: (agent: Agent) => Promise<string>;
  if (values.prompt) {
    if (!values.slug) throw new Error("--prompt needs --slug");
    const current = readCalculator(values.slug);
    if (!current) throw new Error(`No calculator "${values.slug}".`);
    const n = new Set(current.buildLog.map((e) => e.round).filter((r) => r.startsWith("Refinement"))).size + 1;
    label = `Refinement ${n}: ${values.prompt.slice(0, 60)}`;
    save = async (agent) => {
      const next = await refine(agent, current, values.prompt!);
      return finish(next, agent).id;
    };
  } else if (values.topic) {
    const slug = values.slug ? slugify(values.slug) : slugify(values.topic);
    if (readCalculator(slug)) throw new Error(`"${slug}" already exists. Refine it with --slug ${slug} --prompt "...".`);
    label = "First build";
    save = async (agent) => finish(await buildNew(agent, values.topic!, slug), agent).id;
  } else {
    throw new Error('Pass --topic "..." for a new calculator, or --slug and --prompt to refine one.');
  }

  const agent = new Agent(label, budget);
  const slug = await save(agent);
  const summary = `${label}: ${agent.log.length} API calls, about ${formatSgd(agent.spentSgd)}.`;
  console.log(summary);
  // Read by the GitHub Actions job for the commit message and PR body.
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `slug=${slug}\nsummary=${summary}\n`);
}

function finish(spec: ReturnType<typeof SpecSchema.parse>, agent: Agent) {
  return writeCalculator({ ...spec, buildLog: [...spec.buildLog, ...agent.log] });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
