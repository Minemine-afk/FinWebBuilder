import { z } from "zod";
import { findPlaybook, getPlaybook } from "@/agent/playbooks";
import { KINDS, type Kind } from "./spec";

/**
 * The plan for a calculator, made before the expensive research run: which kind fits, what it will cover,
 * and at most two questions when the topic is too vague. The reader ticks what they want, and only that is researched.
 * Plain data and maths with no Node imports, so both the site and the build scripts use it.
 */

export const KIND_LABELS: Record<Kind, string> = { compare: "Comparison", estimate: "Cost estimate", projection: "Projection over time" };
export const KIND_HELP: Record<Kind, string> = {
  compare: "Options side by side: the total cost of each over a period.",
  estimate: "What one project or purchase costs, line by line, with a low to high range.",
  projection: "How a price or value grows over time.",
};

const KindSchema = z.enum(KINDS);

export const PlanSchema = z.object({
  topic: z.string().min(1).max(200),
  kind: KindSchema,
  /** One sentence on why this kind fits. */
  kindReason: z.string().max(300).default(""),
  title: z.string().max(120).default(""),
  /** The proposed scope in plain words: what is compared or estimated, where, and the main assumptions. */
  summary: z.string().max(600).default(""),
  /** Asked only when the answer changes what gets built. At most two. */
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(30),
        question: z.string().min(3).max(200),
        options: z.array(z.object({ id: z.string().min(1).max(30), label: z.string().min(1).max(80) })).min(2).max(4),
        default: z.string(),
      }),
    )
    .max(2)
    .default([]),
  /** The options, lines or items the build will research, each a tick box. */
  items: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(100), group: z.string().max(60).optional() })).max(40).default([]),
  /** Id of the matching topic playbook (agent/playbooks.ts), if any. */
  playbook: z.string().nullable().default(null),
  /** Where the plan came from: the Haiku step, or the built-in fallback. */
  source: z.enum(["haiku", "fallback"]).default("fallback"),
});
export type Plan = z.infer<typeof PlanSchema>;

/** What the reader confirmed, sent with the build request. */
export const PlanChoiceSchema = z.object({
  kind: KindSchema,
  /** Question and chosen answer, in words. */
  answers: z.array(z.object({ question: z.string().max(200), answer: z.string().max(100) })).max(2).default([]),
  include: z.array(z.string().max(100)).max(40).default([]),
  exclude: z.array(z.string().max(100)).max(40).default([]),
  playbook: z.string().nullable().default(null),
  summary: z.string().max(600).default(""),
});
export type PlanChoice = z.infer<typeof PlanChoiceSchema>;

/** Picks a kind from the wording alone, or null when the words don't say. */
export function guessKind(topic: string): Kind | null {
  const t = topic.toLowerCase();
  if (/\b(vs|versus|compare|comparison|which|better|or)\b/.test(t)) return "compare";
  if (/\b(future|forecast|predict|grow|growth|worth|appreciat|trend|over time)\b|in \d+ years/.test(t)) return "projection";
  if (/\b(how much|cost of|costs?|price of|budget|wedding|renovation|baby|fees?)\b/.test(t)) return "estimate";
  return null;
}

/** A plan made without any model: the topic's playbook checklist and a kind guessed from the wording. */
export function fallbackPlan(topic: string): Plan {
  const playbook = findPlaybook(topic);
  const kind = guessKind(topic) ?? playbook?.kind ?? "compare";
  return PlanSchema.parse({
    topic,
    kind,
    kindReason: playbook ? `The topic looks like "${playbook.title}", and ${KIND_LABELS[kind].toLowerCase()} is the usual fit.` : `Chosen from the wording of the topic.`,
    summary: playbook ? `Covers the usual parts of ${playbook.title.toLowerCase()}. Untick anything you don't need.` : "The research agent will choose the options. Add detail to the topic to steer it.",
    items: (playbook?.checklist ?? []).map((label, i) => ({ id: `item-${i + 1}`, label })),
    playbook: playbook?.id ?? null,
    source: "fallback",
  });
}

/**
 * Reads the first JSON object out of a model's reply and checks it against the plan schema.
 * Returns null when there is none, so the caller falls back.
 */
export function parsePlan(text: string, topic: string): Plan | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1));
    const parsed = PlanSchema.safeParse({ ...raw, topic, source: "haiku" });
    if (!parsed.success) return null;
    const plan = parsed.data;
    // A default that isn't one of the options would leave the question unanswered.
    for (const q of plan.questions) if (!q.options.some((o) => o.id === q.default)) q.default = q.options[0].id;
    if (plan.playbook && !getPlaybook(plan.playbook)) plan.playbook = null;
    return plan;
  } catch {
    return null;
  }
}

/** Build cost per research model, in SGD, worked out from the cost of earlier builds (S$1.30 to S$3.00 for 5 to 12 items). */
const COST = { base: 0.6, perItem: { sonnet: 0.2, opus: 0.4 }, cachedItem: 0.08 } as const;

export interface CostEstimate {
  lowSgd: number;
  highSgd: number;
}

/** A rough range for the full research run. Items found in the price cache cost far less than new ones. */
export function estimateCost(items: number, research: "sonnet" | "opus", cachedItems = 0): CostEstimate {
  const cached = Math.min(cachedItems, items);
  const mid = COST.base + (items - cached) * COST.perItem[research] + cached * COST.cachedItem;
  return { lowSgd: Math.round(mid * 70) / 100, highSgd: Math.round(mid * 150) / 100 };
}

/** The plan, as the words the build prompt carries. */
export function choiceText(choice: PlanChoice): string {
  const lines = [`The reader confirmed this scope (follow it over your own judgement): calculator kind "${choice.kind}".`];
  if (choice.summary) lines.push(`Scope: ${choice.summary}`);
  for (const a of choice.answers) lines.push(`Answer to "${a.question}": ${a.answer}.`);
  if (choice.include.length) lines.push(`Cover these: ${choice.include.join("; ")}.`);
  if (choice.exclude.length) lines.push(`Leave these out: ${choice.exclude.join("; ")}.`);
  return lines.join("\n");
}

/** The prompt for the cheap clarify step. The model answers with one JSON object. */
export function clarifyPrompt(topic: string, hint: string): string {
  return `You scope calculators for a Singapore audience (prices in SGD). Read the topic and answer with ONE JSON object and nothing else.

Topic: ${topic}

Choose the calculator kind:
- compare: a choice between options; the answer is each one's total cost over a period.
- estimate: the cost of one project or purchase whose price depends on size, scope or quality.
- projection: a price or value over future years.

Then propose the scope. If the topic is clear enough, set "questions" to []. Only if something that really changes what gets built is unclear (for example which flat type, which country, new or used), ask at most 2 multiple-choice questions, each with 2 to 4 options and a sensible default.
${hint}
Return: {"kind": "compare"|"estimate"|"projection", "kindReason": "one sentence", "title": "short page title", "summary": "two sentences: what is covered, where, key assumptions", "questions": [{"id": "...", "question": "...", "options": [{"id": "...", "label": "..."}], "default": "<option id>"}], "items": [{"id": "kebab-id", "label": "option, line or item to research", "group": "optional group"}], "playbook": "property"|"renovation"|"travel"|"cars"|"education"|null}
"items" lists 5 to 15 things the research will cover, specific enough to price (real names, not categories of categories).`;
}
