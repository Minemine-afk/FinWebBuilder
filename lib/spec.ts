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
  /** Id of a driver (spec.drivers) this recurring cost scales with. Amounts are priced at the driver's default. */
  driver: z.string().optional(),
});

/** A number the viewer can change, e.g. km driven a year. Costs tied to it scale linearly from the default. */
export const DriverSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    unit: z.string().default(""),
    default: z.number().positive(),
    min: z.number().nonnegative(),
    max: z.number().positive(),
    step: z.number().positive().default(1),
    note: z.string().optional(),
  })
  .refine((d) => d.min <= d.default && d.default <= d.max, { message: "A driver's default must sit between its min and max." });

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
  /** US dollars Claude Code itself reported for this model in the run (modelUsage.costUSD), from its own token accounting. Subscription runs only. */
  reportedUsd: z.number().nonnegative().optional(),
  at: z.string().optional(),
});

/** Fields every kind of calculator shares. */
const commonShape = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scope: z.string().default(""),
  limits: z.string().optional(),
  /** Bumped on every build or accepted refinement. */
  version: z.number().int().positive().default(1),
  updated: z.string().optional(),
  /** Shown on the page when there is no build log, e.g. for hand-built calculators. */
  builtBy: z.string().optional(),
  buildLog: z.array(BuildLogEntrySchema).default([]),
};

const CompareSpecSchema = z
  .object({
    kind: z.literal("compare"),
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
    drivers: z.array(DriverSchema).max(4).default([]),
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
    const driverIds = new Set(s.drivers.map((d) => d.id));
    for (const c of s.components) {
      if (c.driver && !driverIds.has(c.driver)) issue(`Component "${c.id}" uses unknown driver "${c.driver}".`);
      if (c.driver && c.kind !== "recurring") issue(`Component "${c.id}" is one-off, so it cannot use a driver.`);
    }
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

const NumberInputSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    unit: z.string().default(""),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(1),
    note: z.string().optional(),
    /** Why the default and limits are what they are; shown as hover text. */
    rationale: z.string().optional(),
    /** Quick picks that fill the input, e.g. a flat type that sets the floor area. */
    choices: z.array(z.object({ label: z.string().min(1), value: z.number() })).optional(),
  })
  .refine((d) => d.min <= d.default && d.default <= d.max && d.min < d.max, { message: "An input's default must sit between its min and max." });

/** A dated figure in a price history, e.g. a provider's package price in 2023. */
const HistoryPointSchema = z.object({
  year: z.number().int(),
  value: z.number().positive(),
  /** What the figure is, e.g. "4-room BTO package" or "median of 1,210 sales". */
  label: z.string().optional(),
  url: z.string().optional(),
});

/** Yearly compound growth between the first and last point of a history (null when it can't be worked out). */
export function historyCagr(history: { year: number; value: number }[]): number | null {
  const pts = [...history].sort((a, b) => a.year - b.year);
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  if (last.year === first.year || first.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / (last.year - first.year)) - 1;
}

const RangeSchema = z.object({ low: z.number().nonnegative(), high: z.number().nonnegative() }).refine((r) => r.low <= r.high, { message: "low must not exceed high." });

/** Cost estimator: line items with a price range per quality level, scaled by size and quantity. */
const EstimateSpecSchema = z
  .object({
    kind: z.literal("estimate"),
    ...commonShape,
    subject: z.string().default("project"),
    /** Year the prices were published. */
    priceYear: z.number().int(),
    /** Size/quantity inputs that lines can scale with, e.g. floor area or number of guests. */
    inputs: z.array(NumberInputSchema).max(4).default([]),
    /** Quality levels. Every line prices each one. Omit for a single "default" level. */
    tiers: z
      .object({ label: z.string(), options: z.array(z.object({ id: z.string(), label: z.string(), note: z.string().optional(), rationale: z.string().optional() })).min(1), default: z.string() })
      .optional(),
    /** Kinds of job, e.g. "Full renovation of a new BTO flat" or "Kitchen only". Each switches on its own set of lines. */
    presets: z
      .object({
        label: z.string(),
        default: z.string(),
        options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), note: z.string().optional(), rationale: z.string().optional(), lines: z.array(z.string()).min(1) })).min(2),
      })
      .optional(),
    /**
     * Who does the work. Each provider prices the lines at its own level (factor x the line range) and its prices
     * move at the yearly rate of its own price history, so the viewer can price a job for a future year.
     */
    providers: z
      .object({
        label: z.string().default("Provider"),
        default: z.string(),
        /** Furthest year the viewer can price a job for. */
        maxYear: z.number().int(),
        options: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              /** e.g. "Interior design firm", "Contractor", "Design-and-build". */
              type: z.string().default(""),
              url: z.string().optional(),
              /** Price level against the line ranges: 1 = market, 1.2 = 20% dearer. */
              factor: z.number().min(0.3).max(3),
              /** Why this factor: which of its prices were compared with which market figure. */
              factorBasis: z.string().min(1),
              /** At least three years of this provider's own prices (same scope each year), oldest first. Its yearly rate is the compound growth across them. */
              history: z.array(HistoryPointSchema).min(3),
              /** Why these figures show this provider's price trend, and what was assumed. */
              rationale: z.string().min(1),
              source: SourceSchema,
              notes: z.string().default(""),
            }),
          )
          .min(2),
      })
      .optional(),
    /** Buffer added on top of the sum, as a fraction. The viewer can change it between 0 and max. */
    contingency: z.object({ default: z.number().min(0).max(1), max: z.number().min(0).max(1) }).default({ default: 0.1, max: 0.3 }),
    groups: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
    lines: z
      .array(
        z.object({
          id: z.string().min(1),
          group: z.string(),
          label: z.string().min(1),
          description: z.string().optional(),
          /** "fixed": price is per unit and the viewer sets the quantity. Otherwise an input id: price is per unit of that input. */
          per: z.string().default("fixed"),
          /** What one unit is, e.g. "per room", "per sq ft", "each". */
          unit: z.string().default("each"),
          qty: z.number().nonnegative().default(1),
          qtyMax: z.number().positive().default(20),
          /** An optional line starts switched off. */
          optional: z.boolean().default(false),
          /** tier id (or "default") -> price range for one unit */
          prices: z.record(z.string(), RangeSchema),
          source: SourceSchema,
          notes: z.string().default(""),
          /** Why the range is what it is, and anything assumed; shown as hover text. */
          rationale: z.string().optional(),
        }),
      )
      .min(2),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const inputIds = new Set(s.inputs.map((i) => i.id));
    const groupIds = new Set(s.groups.map((g) => g.id));
    const tierIds = s.tiers ? s.tiers.options.map((o) => o.id) : ["default"];
    if (s.tiers && !tierIds.includes(s.tiers.default)) issue(`Default tier "${s.tiers.default}" is not one of the options.`);
    if (s.contingency.default > s.contingency.max) issue("Contingency default exceeds its max.");
    const ids = new Set<string>();
    for (const l of s.lines) {
      if (ids.has(l.id)) issue(`Duplicate line id "${l.id}".`);
      ids.add(l.id);
      if (!groupIds.has(l.group)) issue(`"${l.label}" is in unknown group "${l.group}".`);
      if (l.per !== "fixed" && !inputIds.has(l.per)) issue(`"${l.label}" scales with unknown input "${l.per}".`);
      for (const t of tierIds) if (!l.prices[t]) issue(`"${l.label}" has no price for "${t}".`);
      for (const k of Object.keys(l.prices)) if (!tierIds.includes(k)) issue(`"${l.label}" prices unknown tier "${k}".`);
    }
    if (s.presets) {
      const presetIds = s.presets.options.map((o) => o.id);
      if (!presetIds.includes(s.presets.default)) issue(`Default preset "${s.presets.default}" is not one of the options.`);
      for (const o of s.presets.options) for (const id of o.lines) if (!ids.has(id)) issue(`Preset "${o.label}" switches on unknown line "${id}".`);
    }
    if (s.providers) {
      const pids = new Set<string>();
      for (const p of s.providers.options) {
        if (pids.has(p.id)) issue(`Duplicate provider id "${p.id}".`);
        pids.add(p.id);
        const years = p.history.map((h) => h.year);
        if (new Set(years).size !== years.length) issue(`Provider "${p.name}" has two history points for the same year.`);
      }
      if (!pids.has(s.providers.default)) issue(`Default provider "${s.providers.default}" is not one of the options.`);
      if (s.providers.maxYear < s.priceYear) issue("providers.maxYear is before priceYear.");
    }
  });

const RateSchema = z.number().min(-0.5).max(1);

/** Projection: how a starting value grows over time under low/base/high rates, optionally with regular deposits and a goal. */
const ProjectionSpecSchema = z
  .object({
    kind: z.literal("projection"),
    ...commonShape,
    subject: z.string().default("value"),
    /** Label of the starting amount, e.g. "Price today" or "Amount saved so far". */
    valueLabel: z.string().default("Starting value"),
    /** "item": each item carries its own starting value (a price today). "input": the viewer types the starting amount. */
    startMode: z.enum(["item", "input"]),
    start: NumberInputSchema.optional(),
    /** Regular deposit, e.g. monthly saving. Omit for pure growth of a price. */
    contribution: NumberInputSchema.extend({ period: z.enum(["month", "year"]).default("month") }).optional(),
    years: z.object({ default: z.number().int().positive(), min: z.number().int().positive(), max: z.number().int().positive() }).default({ default: 10, min: 1, max: 40 }),
    /** Limits on the rate the viewer can type, as fractions. */
    rateLimits: z.object({ min: RateSchema, max: RateSchema }).default({ min: 0, max: 0.15 }),
    /** "annual": the rate is an effective yearly rate. "monthly": rate / 12 is credited each month. */
    compounding: z.enum(["annual", "monthly"]).default("annual"),
    /** Adds a "today's money" column at this yearly inflation (fraction), switchable by the viewer. */
    inflation: z.number().min(0).max(0.2).optional(),
    goal: NumberInputSchema.optional(),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          option: z.string().default(""),
          url: z.string().optional(),
          /** Starting value when startMode is "item". */
          value: z.number().nonnegative().optional(),
          rates: z.object({ low: RateSchema, base: RateSchema, high: RateSchema }),
          /** How the three rates were chosen, e.g. "2020-2025 average yearly rise". */
          rateBasis: z.string().default(""),
          priceYear: z.number().int().optional(),
          source: SourceSchema,
          notes: z.string().default(""),
          /** Filter id -> option id, e.g. {"location": "clementi", "type": "hdb-4-room"}. */
          tags: z.record(z.string(), z.string()).optional(),
          /** Past values, oldest first, e.g. the median price in each of the last few years. */
          history: z.array(HistoryPointSchema).optional(),
          /** Why the value and rates are what they are, and what was assumed; shown as hover text. */
          rationale: z.string().optional(),
        }),
      )
      .min(1),
    defaults: z.object({ item: z.string().optional() }).default({}),
    /**
     * Ways to narrow a long list of items, e.g. location and property type. Each item names its option for every
     * filter in "tags", and the page shows one select per filter.
     */
    filters: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), group: z.string().optional(), rationale: z.string().optional() })).min(1) }))
      .max(3)
      .default([]),
    /** "history": every item's base rate must be the compound yearly growth across its own price history. */
    baseRateFrom: z.enum(["history", "judgement"]).default("judgement"),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.startMode === "input" && !s.start) issue('startMode "input" needs a "start" input.');
    const filterOptions = new Map(s.filters.map((f) => [f.id, new Set(f.options.map((o) => o.id))]));
    for (const it of s.items) {
      for (const [fid, opts] of filterOptions) {
        const tag = it.tags?.[fid];
        if (!tag) issue(`"${it.name}" has no "${fid}" tag.`);
        else if (!opts.has(tag)) issue(`"${it.name}" is tagged with unknown ${fid} "${tag}".`);
      }
      if (s.baseRateFrom === "history") {
        const g = historyCagr(it.history ?? []);
        if (g === null) issue(`"${it.name}" needs at least two history points, since base rates come from history.`);
        else if (Math.abs(g - it.rates.base) > 0.0006) issue(`"${it.name}" base rate ${it.rates.base} should be its history's yearly growth, ${g.toFixed(4)}.`);
      }
    }
    const ids = new Set<string>();
    for (const it of s.items) {
      if (ids.has(it.id)) issue(`Duplicate item id "${it.id}".`);
      ids.add(it.id);
      if (s.startMode === "item" && !(typeof it.value === "number" && it.value > 0)) issue(`"${it.name}" needs a starting "value".`);
      if (!(it.rates.low <= it.rates.base && it.rates.base <= it.rates.high)) issue(`"${it.name}" rates must run low <= base <= high.`);
    }
    if (s.defaults.item && !ids.has(s.defaults.item)) issue(`Default item "${s.defaults.item}" does not exist.`);
    if (s.years.min > s.years.default || s.years.default > s.years.max) issue("years.default must sit between min and max.");
    if (s.rateLimits.min > s.rateLimits.max) issue("rateLimits.min exceeds max.");
  });

export type CompareSpec = z.infer<typeof CompareSpecSchema>;
export type EstimateSpec = z.infer<typeof EstimateSpecSchema>;
export type ProjectionSpec = z.infer<typeof ProjectionSpecSchema>;
export const KINDS = ["compare", "estimate", "projection"] as const;
export type Kind = (typeof KINDS)[number];

/** Any calculator. Files written before there were kinds have no "kind" and are comparisons. */
export const SpecSchema = z.preprocess(
  (raw) => (raw && typeof raw === "object" && !("kind" in raw) ? { kind: "compare", ...raw } : raw),
  z.discriminatedUnion("kind", [CompareSpecSchema, EstimateSpecSchema, ProjectionSpecSchema]),
);
export type Spec = CompareSpec | EstimateSpec | ProjectionSpec;
export { CompareSpecSchema, EstimateSpecSchema, ProjectionSpecSchema };

/** One-line description for lists: what the reader can do with it. */
export function describeSpec(spec: Spec): string {
  if (spec.kind === "estimate") return `Cost estimate · ${spec.lines.length} line items`;
  if (spec.kind === "projection") return `Projection · ${spec.items.length} ${spec.items.length === 1 ? "scenario set" : "options"}`;
  return `Comparison · ${spec.items.length} options`;
}
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
