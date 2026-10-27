# compare: options side by side over time

Use for "A vs B (vs C)" topics: several real options whose total cost over a holding period is compared (cars, pets, trips, phones, plans). Worked example: data/calculators/ev-vs-petrol-car.json. The schema is `CompareSpecSchema` in lib/spec.ts.

Top level: `"kind": "compare"`, `id`, `title`, `subject` (singular noun), `currency`, `periodLabel`, `scope`, `limits`, `minStartYear`, `defaultGrowth` (yearly price rise, 0 to 0.15), `components`, `groups`, `items`, `defaults`. Optional: `variants` (price differs by buyer type), `extras` (optional monthly add-ons), `fx`/`fxNote` (only for non-SGD prices), `drivers`.

- `components`: 3 to 5 cost parts `{id, label, kind: "recurring"|"oneoff"}`; at least one recurring; one-off parts are paid once at the start.
- `drivers`: viewer-set numbers such as km a year `{id, label, unit, default, min, max, step}`. A recurring component with `"driver": id` is priced at the driver's default, and the page scales it linearly. Put only the usage-dependent cost (fuel, not insurance) in such a component. Use a driver only when the topic has an obvious usage input.
- `items`: 3 to 6 options `{id, group, name, option, currency, duration, priceYear, costs: {"default": {componentId: amount}}, history: [], source: {url, verified, type}, notes}`. Recurring amounts are per year; one-off amounts are totals.
- `groups`: `{id, label, growth}`. `defaults.slots`: up to 3 item ids shown first.
