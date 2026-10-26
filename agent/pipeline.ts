import type { Spec } from "@/lib/spec";
import { slugify } from "@/lib/spec";
import type { Agent } from "./llm";
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, PATCH_SYSTEM, PLAN_SYSTEM, RESEARCH_SYSTEM, VERIFY_SYSTEM } from "./prompts";
import {
  ClassifySchema,
  ExtractionSchema,
  PatchSchema,
  PlanSchema,
  VerifySchema,
  planFromSpec,
  toSpec,
  type ExtractedItem,
  type Plan,
} from "./schema";

const CURRENCY = "SGD";
const today = () => new Date().toISOString().slice(0, 10);

function structureBrief(plan: Plan) {
  return JSON.stringify({
    components: plan.components,
    variants: plan.variants,
    extras: plan.extras,
    periodLabel: plan.periodLabel,
  });
}

/** Researches the given items (Sonnet, or Opus for hard items) and extracts their prices. */
async function researchItems(agent: Agent, plan: Plan, ids: string[], escalated = false): Promise<{ items: ExtractedItem[]; fx: Record<string, number>; notes: string }> {
  const items = plan.items.filter((i) => ids.includes(i.id));
  const items_: ExtractedItem[] = [];
  const fx: Record<string, number> = {};
  let allNotes = "";
  // Two items per research call keeps each call's context small.
  for (let i = 0; i < items.length; i += 2) {
    const batch = items.slice(i, i + 2);
    const hardItem = batch.some((b) => b.hard);
    const names = batch.map((b) => b.name).join(", ");
    const notes = await agent.research(
      { escalated, hardItem },
      `Research ${names}`,
      RESEARCH_SYSTEM,
      `Calculator: ${plan.title}. Market: Singapore unless stated.\nCost structure: ${structureBrief(plan)}\n\n` +
        batch.map((b) => `- ${b.id} (${b.name}, ${b.option}): ${b.researchQuestion}`).join("\n"),
    );
    allNotes += `\n\n## ${names}\n${notes}`;
    const extraction = await agent.structured(
      "extract",
      { escalated },
      `Extract prices for ${names}`,
      EXTRACT_SYSTEM,
      `Spec currency: ${CURRENCY}. Today: ${today()}.\nCost structure: ${structureBrief(plan)}\nItems: ${JSON.stringify(batch.map((b) => ({ id: b.id, name: b.name, option: b.option })))}\n\nResearch notes:\n${notes}`,
      ExtractionSchema,
    );
    items_.push(...extraction.items.filter((x) => batch.some((b) => b.id === x.id)));
    for (const r of extraction.fx) if (r.perUnitOfSpecCurrency > 0) fx[r.currency] = r.perUnitOfSpecCurrency;
  }
  return { items: items_, fx, notes: allNotes };
}

/** Re-researches unconfirmed items on Opus and returns the merged results. */
async function escalateUnconfirmed(agent: Agent, plan: Plan, items: ExtractedItem[], fx: Record<string, number>) {
  const weak = items.filter((i) => i.confidence === "unconfirmed").map((i) => i.id);
  if (!weak.length) return { items, fx };
  const again = await researchItems(agent, plan, weak, true);
  const better = new Map(again.items.filter((i) => i.confidence !== "unconfirmed").map((i) => [i.id, i]));
  return { items: items.map((i) => better.get(i.id) ?? i), fx: { ...fx, ...again.fx } };
}

/** Opus checks the draft; corrections are applied and flagged items researched again once. */
async function verify(agent: Agent, plan: Plan, spec: Spec, notes: string): Promise<Spec> {
  const check = await agent.structured(
    "verify",
    {},
    "Check the finished numbers",
    VERIFY_SYSTEM,
    `Draft calculator:\n${JSON.stringify({ ...spec, buildLog: undefined })}\n\nResearch notes:\n${notes}`,
    VerifySchema,
  );
  let result: Spec = { ...spec, scope: check.scope, limits: check.limits };
  if (check.recheckItemIds.length) {
    const again = await researchItems(agent, plan, check.recheckItemIds, true);
    const merged = toSpec({ slug: spec.id, currency: CURRENCY, plan, extracted: again.items, fx: again.fx, today: today(), previous: result });
    result = { ...merged, version: spec.version };
  }
  for (const c of check.corrections) {
    const item = result.items.find((i) => i.id === c.itemId);
    const row = item?.costs[c.variant];
    if (item && row && c.component in row && c.amount >= 0) {
      row[c.component] = c.amount;
      item.notes += ` Corrected on review: ${c.reason}`;
    }
  }
  return result;
}

/** First build: plan (Opus), research (Sonnet, Opus for hard items), escalate unconfirmed prices (Opus), verify (Opus). */
export async function buildNew(agent: Agent, topic: string, slug = slugify(topic)): Promise<Spec> {
  const plan = await agent.structured("plan", {}, "Plan the calculator", PLAN_SYSTEM, `Topic: ${topic}`, PlanSchema);
  const researched = await researchItems(agent, plan, plan.items.map((i) => i.id));
  const { items, fx } = await escalateUnconfirmed(agent, plan, researched.items, researched.fx);
  const draft = toSpec({ slug, currency: CURRENCY, plan, extracted: items, fx, today: today() });
  return verify(agent, plan, draft, researched.notes);
}

/** A follow-up prompt. Simple edits stay on Sonnet; open-ended ones are planned and checked by Opus. */
export async function refine(agent: Agent, current: Spec, prompt: string): Promise<Spec> {
  const triage = await agent.structured(
    "classify",
    {},
    "Read the request",
    CLASSIFY_SYSTEM,
    `Calculator: ${current.title}\nOptions: ${current.items.map((i) => `${i.id} (${i.name}, ${i.option})`).join("; ")}\nComponents: ${current.components.map((c) => c.label).join(", ")}\n\nRequest: ${prompt}`,
    ClassifySchema,
  );
  const openEnded = triage.kind === "open";
  const patch = await agent.structured(
    "patch",
    { openEnded },
    openEnded ? "Restructure the calculator" : "Plan the change",
    PATCH_SYSTEM,
    `Current structure:\n${JSON.stringify(planFromSpec(current))}\n\nRequest: ${prompt}`,
    PatchSchema,
  );
  const researched = await researchItems(agent, patch.plan, patch.itemsToResearch);
  const { items, fx } = await escalateUnconfirmed(agent, patch.plan, researched.items, researched.fx);
  const next = toSpec({ slug: current.id, currency: CURRENCY, plan: patch.plan, extracted: items, fx, today: today(), previous: current });
  return openEnded ? verify(agent, patch.plan, next, researched.notes) : next;
}
