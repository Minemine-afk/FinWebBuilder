import { z } from "zod";
import type { Item, Spec } from "@/lib/spec";

/**
 * Schemas the agent asks Claude to fill in (structured outputs). They use arrays of
 * {key, value} pairs instead of free-form objects, then convert to the page spec.
 */

const Kind = z.enum(["recurring", "oneoff"]);

export const PlanSchema = z.object({
  title: z.string().describe("Short page title, e.g. 'Electric vs petrol car'"),
  subject: z.string().describe("What one option is, singular, e.g. 'car', 'trip', 'pet'"),
  periodLabel: z.string().describe("Label for one period, e.g. 'Year of ownership', 'Trip'"),
  scope: z.string().describe("Two or three sentences: what is included, for whom, in which currency"),
  limits: z.string().describe("What is left out and what readers should double-check"),
  defaultGrowth: z.number().describe("Typical yearly price rise as a fraction, e.g. 0.03"),
  components: z
    .array(z.object({ id: z.string(), label: z.string(), kind: Kind }))
    .describe("3 to 5 cost parts; at least one recurring. One-off parts are paid once at the start."),
  variants: z
    .object({
      label: z.string(),
      fallback: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string() })),
    })
    .nullable()
    .describe("Only when prices differ by buyer type (e.g. citizen vs international); otherwise null"),
  extras: z
    .object({ label: z.string(), categories: z.array(z.object({ id: z.string(), label: z.string() })) })
    .nullable()
    .describe("Optional monthly add-ons the reader can switch on, or null"),
  groups: z.array(z.object({ id: z.string(), label: z.string() })),
  items: z
    .array(
      z.object({
        id: z.string().describe("kebab-case"),
        group: z.string(),
        name: z.string(),
        option: z.string().describe("The specific variant, e.g. 'Dynamic, 65 kW'"),
        duration: z.number().describe("How many periods the comparison runs"),
        researchQuestion: z.string().describe("Exactly which prices to find for this item"),
        hard: z.boolean().describe("True if pricing is niche, not yet launched, or likely to conflict between sources"),
      }),
    )
    .describe("3 to 6 options to compare"),
});
export type Plan = z.infer<typeof PlanSchema>;

const Amount = z.object({ component: z.string(), amount: z.number() });

export const ExtractedItemSchema = z.object({
  id: z.string(),
  currency: z.string().describe("ISO code the prices are quoted in"),
  priceYear: z.number(),
  costs: z
    .array(z.object({ variant: z.string().describe("'default' if there are no variants"), amounts: z.array(Amount) }))
    .describe("Recurring parts: amount per period. One-off parts: the total amount."),
  extrasMonthly: z.array(z.object({ category: z.string(), amount: z.number() })).describe("Empty if no extras"),
  sourceUrl: z.string(),
  sourceType: z.enum(["official", "secondary", "estimate"]),
  notes: z.string().describe("How each figure was found or worked out, with dates"),
  confidence: z
    .enum(["confirmed", "single-source", "unconfirmed"])
    .describe("confirmed: two sources agree or one official source; unconfirmed: guessed or no source found"),
});
export const ExtractionSchema = z.object({
  items: z.array(ExtractedItemSchema),
  fx: z.array(z.object({ currency: z.string(), perUnitOfSpecCurrency: z.number() })).describe("Rates for any non-spec currency used"),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const VerifySchema = z.object({
  corrections: z.array(
    z.object({ itemId: z.string(), variant: z.string(), component: z.string(), amount: z.number(), reason: z.string() }),
  ),
  recheckItemIds: z.array(z.string()).describe("Items whose prices look wrong and need researching again"),
  scope: z.string(),
  limits: z.string(),
});

export const ClassifySchema = z.object({
  kind: z.enum(["simple", "open"]).describe("simple: change or recheck specific figures or items; open: restructure, new components, or unclear"),
  summary: z.string().describe("The change in under ten words, for the build log"),
});

export const PatchSchema = z.object({
  plan: PlanSchema.describe("The full updated structure. Keep existing ids for anything unchanged."),
  itemsToResearch: z.array(z.string()).describe("Ids of new items or items whose prices must be found again"),
});

/** Converts the agent's array-based answers into a page spec. */
export function toSpec(args: {
  slug: string;
  currency: string;
  plan: Plan;
  extracted: ExtractedItem[];
  fx: Record<string, number>;
  today: string;
  previous?: Spec;
}): Spec {
  const { plan, extracted, today, previous } = args;
  const byId = new Map(extracted.map((e) => [e.id, e]));
  const prevItems = new Map((previous?.items ?? []).map((i) => [i.id, i]));
  const items: Item[] = [];
  for (const p of plan.items) {
    const e = byId.get(p.id);
    const prev = prevItems.get(p.id);
    if (!e && !prev) continue;
    const costs: Item["costs"] = {};
    if (e) {
      for (const row of e.costs) costs[row.variant] = Object.fromEntries(row.amounts.map((a) => [a.component, Math.max(0, a.amount)]));
    }
    items.push({
      id: p.id,
      group: p.group,
      name: p.name,
      option: p.option,
      currency: e?.currency ?? prev!.currency,
      duration: p.duration,
      priceYear: e?.priceYear ?? prev!.priceYear,
      locked: false,
      costs: e ? costs : prev!.costs,
      history: prev?.history ?? [],
      extras:
        plan.extras && e && e.extrasMonthly.length
          ? { year: e.priceYear, months: 12, monthly: Object.fromEntries(e.extrasMonthly.map((x) => [x.category, Math.max(0, x.amount)])) }
          : prev?.extras,
      source: e ? { url: e.sourceUrl, verified: today, type: e.sourceType } : prev!.source,
      notes: e ? e.notes + (e.confidence === "unconfirmed" ? " Could not be confirmed: treat as an estimate." : "") : prev!.notes,
    });
  }
  return {
    id: args.slug,
    title: plan.title,
    subject: plan.subject,
    currency: args.currency,
    periodLabel: plan.periodLabel,
    scope: plan.scope,
    limits: plan.limits,
    fx: { ...(previous?.fx ?? {}), ...args.fx },
    minStartYear: Number(today.slice(0, 4)),
    defaultGrowth: Math.min(0.15, Math.max(0, plan.defaultGrowth)),
    variants: plan.variants ?? undefined,
    components: plan.components,
    extras: plan.extras ? { ...plan.extras, unit: "month", note: "Monthly estimates. Frugal is 20% less, Comfortable 30% more." } : undefined,
    groups: plan.groups,
    items,
    defaults: { variant: plan.variants?.options[0]?.id, slots: items.slice(0, 3).map((i) => i.id) },
    version: (previous?.version ?? 0) + 1,
    updated: today,
    buildLog: previous?.buildLog ?? [],
  };
}

/** The current spec as a plan, so a follow-up prompt can edit it. */
export function planFromSpec(spec: Spec): Plan {
  return {
    title: spec.title,
    subject: spec.subject,
    periodLabel: spec.periodLabel,
    scope: spec.scope,
    limits: spec.limits ?? "",
    defaultGrowth: spec.defaultGrowth,
    components: spec.components,
    variants: spec.variants ? { label: spec.variants.label, fallback: spec.variants.fallback, options: spec.variants.options } : null,
    extras: spec.extras ? { label: spec.extras.label, categories: spec.extras.categories } : null,
    groups: spec.groups.map((g) => ({ id: g.id, label: g.label })),
    items: spec.items.map((i) => ({
      id: i.id,
      group: i.group,
      name: i.name,
      option: i.option,
      duration: i.duration,
      researchQuestion: "",
      hard: false,
    })),
  };
}
