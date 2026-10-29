import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { route } from "@/agent/models";
import { findPlaybook } from "@/agent/playbooks";
import { countCached, readCache } from "./price-cache";
import { clarifyPrompt, fallbackPlan, parsePlan, type Plan } from "./plan";

/** Server-side parts of scoping, kept apart from agent/plan.ts so importing them never runs that script. */

/** Hint lines from the topic's playbook, so even Haiku proposes the usual categories. */
export function playbookHint(topic: string): string {
  const p = findPlaybook(topic);
  return p ? `This looks like the "${p.title}" topic (playbook id "${p.id}"). Usual coverage: ${p.checklist.join("; ")}. Usual kind: ${p.kind}. Use these as a starting point for "items", adapted to the topic.` : "";
}

export const newPlanId = () => randomBytes(6).toString("hex");

/**
 * Scopes a topic with one Haiku call on the API. Used by the site when it has an API key; never throws,
 * and returns the built-in fallback plan if the call or its answer fails.
 */
export async function planWithApi(topic: string, client: Pick<Anthropic, "messages"> = new Anthropic()): Promise<Plan> {
  try {
    const { model } = route("clarify");
    const msg = await client.messages.create({ model, max_tokens: 1800, messages: [{ role: "user", content: clarifyPrompt(topic, playbookHint(topic)) }] });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return parsePlan(text, topic) ?? fallbackPlan(topic);
  } catch {
    return fallbackPlan(topic);
  }
}


/** The ids of plan items that earlier builds already priced (data/price-cache.json), which makes them cheap to build. */
export function cachedItemIds(plan: Plan): string[] {
  const cache = readCache();
  if (!cache.length) return [];
  return plan.items.filter((item) => countCached([`${plan.topic} ${item.label}`], cache) > 0).map((i) => i.id);
}
