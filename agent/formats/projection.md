# projection: how a value grows over time

Use for "what will X be worth or cost in N years" (future prices) and "how long to reach a goal" (saving). Worked examples: data/calculators/saving-for-a-goal.json (the viewer types the start, adds money monthly, has a goal) and data/calculators/future-hdb-resale-price.json (a price today grows at a rate). The schema is `ProjectionSpecSchema` in lib/spec.ts.

Top level: `"kind": "projection"`, `id`, `title`, `subject`, `currency`, `scope`, `limits`, `valueLabel`, `startMode`, `years`, `rateLimits`, `compounding`, `items`, `defaults`. Optional: `start`, `contribution`, `goal`, `inflation`.

- `startMode`: "input" (the viewer types the amount, so give `start: {id, label, unit, default, min, max, step}`) or "item" (each item has a `value`, e.g. today's price).
- `contribution`: regular deposit `{id, label, unit, default, min, max, step, period: "month"|"year"}`; only for saving topics. `goal`: `{id, label, unit, default, min, max, step}` when the topic has a target.
- `years`: `{default, min, max}`. `rateLimits`: the range a viewer may type for their own rate, as fractions. `compounding`: "annual" for prices, "monthly" for interest paid monthly. `inflation`: yearly fraction, to offer a "today's money" view.
- `items`: 1 to 6 things to project `{id, name, option, value, priceYear, rates: {low, base, high}, rateBasis, source, notes}`. Rates are yearly fractions with low <= base <= high, taken from real history or published rates; say in `rateBasis` how each was chosen. They are scenarios, not forecasts: say so in `limits`.
