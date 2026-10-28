# projection: how a value grows over time

Use for "what will X be worth or cost in N years" (future prices) and "how long to reach a goal" (saving). Worked example: agent/examples/projection.json (a price today grows at a rate). For a saving topic, use `startMode: "input"` with `start`, `contribution` and `goal` as described below. The schema is `ProjectionSpecSchema` in lib/spec.ts.

Top level: `"kind": "projection"`, `id`, `title`, `subject`, `currency`, `scope`, `limits`, `valueLabel`, `startMode`, `years`, `rateLimits`, `compounding`, `items`, `defaults`. Optional: `start`, `contribution`, `goal`, `inflation`, `filters`, `baseRateFrom`.

- `startMode`: "input" (the viewer types the amount, so give `start: {id, label, unit, default, min, max, step}`) or "item" (each item has a `value`, e.g. today's price).
- `contribution`: regular deposit `{id, label, unit, default, min, max, step, period: "month"|"year"}`; only for saving topics. `goal`: `{id, label, unit, default, min, max, step}` when the topic has a target.
- `years`: `{default, min, max}`. `rateLimits`: the range a viewer may type for their own rate, as fractions. `compounding`: "annual" for prices, "monthly" for interest paid monthly. `inflation`: yearly fraction, to offer a "today's money" view.
- `items`: things to project `{id, name, option, value, priceYear, rates: {low, base, high}, rateBasis, source, notes, rationale, history, tags}`. 1 to 6 normally; any number when `filters` narrow them. Rates are yearly fractions with low <= base <= high, taken from real history or published rates; say in `rateBasis` how each was chosen. They are scenarios, not forecasts: say so in `limits`. `history` is past values `[{year, value, label}]`, oldest first; `rationale` is hover text on why the value and rates are what they are.
- `filters` (for long lists, e.g. property by location and type): up to 3 `{id, label, options: [{id, label, group, rationale}]}`; every item gives its option for each filter in `tags`. `group` makes option groups in the select (e.g. "HDB flat", "Private").
- `baseRateFrom: "history"` makes validate check that each item's base rate is the compound yearly growth across its `history` (use this when the reader asked for rates from past years).

## Official data tools (property topics)

Run these instead of researching the same figures by hand; they write items straight into the calculator file, with sources, history, rates and rationale:

- `npx tsx agent/datasets.ts hdb-resale <slug> [--towns "BUKIT BATOK,CLEMENTI"]`: every HDB town and flat type from HDB's resale transactions on data.gov.sg (median of the last 12 months plus the three 12-month windows before it). Creates the file if it doesn't exist, and adds `location` and `type` filters.
- `npx tsx agent/datasets.ts private-index`: URA's private price indices (landed; non-landed by CCR, RCR, OCR) with their 3-year yearly rates.
- `npx tsx agent/datasets.ts private-items <slug> '<json array>'`: private-property items whose price today you researched: `[{"location": "bukit-batok", "label": "Bukit Batok", "type": "condo"|"ec"|"landed", "region": "CCR"|"RCR"|"OCR", "value": 1450000, "url": "<source>", "basis": "<what the figure is, unit size, date>", "sourceType": "secondary"|"estimate"|"official"}]`. Past values and rates follow the URA index for the segment. Use the same location ids as the HDB towns (lowercase, hyphens) so the location filter lines up.
After running them, edit only the top-level fields (title, scope, limits, years, defaults) yourself; never retype the generated items.
