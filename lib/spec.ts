import { z } from "zod";

/**
 * A calculator spec: the JSON the page template renders. Same shape as the
 * builder prototype's specs, plus the agent's version and build log.
 */

export const SourceSchema = z.object({
  url: z.string().default(""),
  verified: z.string().default(""),
  type: z.enum(["official", "secondary", "estimate"]).default("estimate"),
});

export const ComponentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["recurring", "oneoff"]),
});

export const ItemSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  name: z.string().min(1),
  option: z.string().default(""),
  url: z.string().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  duration: z.number().positive(),
  priceYear: z.number().int(),
  locked: z.boolean().default(false),
  lockedNote: z.string().optional(),
  /** variant id ("default" when the calculator has no variants) → component id → amount per year or one-off */
  costs: z.record(z.string(), z.record(z.string(), z.number().nonnegative())),
  history: z.array(z.object({ year: z.number().int(), variant: z.string().optional(), value: z.number() })).default([]),
  extras: z
    .object({
      year: z.number().int(),
      months: z.number().positive(),
      monthly: z.record(z.string(), z.number().nonnegative()),
      source: SourceSchema.optional(),
    })
    .optional(),
  source: SourceSchema,
  notes: z.string().default(""),
});

/** One API call the agent made, with the usage the API reported. */
export const BuildLogEntrySchema = z.object({
  round: z.string(),
  label: z.string(),
  /** Model id that served the call, e.g. claude-sonnet-5-5 */
  model: z.string(),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheWrite: z.number().int().nonnegative().default(0),
  searches: z.number().int().nonnegative().default(0),
  fetches: z.number().int().nonnegative().default(0),
  /** "subscription": ran on a Claude plan, so the cost is what it would have been on the API, not a charge. */
  billing: z.enum(["api", "subscription"]).default("api"),
  at: z.string().optional(),
});

export const SpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    subject: z.string().default("option"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    periodLabel: z.string().default("Year"),
    scope: z.string().default(""),
    limits: z.string().optional(),
    fxNote: z.string().optional(),
    fx: z.record(z.string(), z.number().positive()).default({}),
    minStartYear: z.number().int(),
    defaultGrowth: z.number().min(0).max(0.15),
    variants: z
      .object({
        label: z.string(),
        fallback: z.string(),
        options: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
        note: z.string().optional(),
      })
      .optional(),
    components: z.array(ComponentSchema).min(1),
    extras: z
      .object({
        label: z.string(),
        unit: z.string().default("month"),
        categories: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
        note: z.string().optional(),
      })
      .optional(),
    groups: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          growth: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
          extrasGrowth: z.number().optional(),
        }),
      )
      .min(1),
    items: z.array(ItemSchema).min(1),
    defaults: z.object({ variant: z.string().optional(), slots: z.array(z.string()).max(3) }),
    /** Bumped on every build or accepted refinement. */
    version: z.number().int().positive().default(1),
    updated: z.string().optional(),
    /** Shown on the page when there is no build log, e.g. for hand-built calculators. */
    builtBy: z.string().optional(),
    buildLog: z.array(BuildLogEntrySchema).default([]),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!s.components.some((c) => c.kind === "recurring")) issue("At least one component must be recurring.");
    const componentIds = new Set(s.components.map((c) => c.id));
    const groupIds = new Set(s.groups.map((g) => g.id));
    const itemIds = new Set<string>();
    for (const it of s.items) {
      if (itemIds.has(it.id)) issue(`Duplicate item id "${it.id}".`);
      itemIds.add(it.id);
      if (!groupIds.has(it.group)) issue(`"${it.name}" is in unknown group "${it.group}".`);
      if (it.currency !== s.currency && !(s.fx[it.currency] > 0)) issue(`"${it.name}" is priced in ${it.currency} with no fx rate.`);
      for (const row of Object.values(it.costs)) {
        for (const key of Object.keys(row)) if (!componentIds.has(key)) issue(`"${it.name}" has a cost for unknown component "${key}".`);
      }
    }
    for (const slot of s.defaults.slots) if (!itemIds.has(slot)) issue(`Default slot "${slot}" is not an item.`);
  });

export type Spec = z.infer<typeof SpecSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type BuildLogEntry = z.infer<typeof BuildLogEntrySchema>;

export function slugify(text: string): string {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "calculator"
  );
}
