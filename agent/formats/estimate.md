# estimate: what a project costs, line by line

Use for "how much does X cost" topics where the reader's own size, scope or quality changes the answer (renovation, wedding, event, moving house, starting a business). Worked example: data/calculators/hdb-renovation-cost.json. The schema is `EstimateSpecSchema` in lib/spec.ts.

Top level: `"kind": "estimate"`, `id`, `title`, `subject`, `currency`, `priceYear`, `scope`, `limits`, `inputs`, `tiers`, `contingency`, `groups`, `lines`.

- `inputs`: 0 to 4 numbers the viewer sets, e.g. floor area or guests `{id, label, unit, default, min, max, step}`. Defaults must be typical; min and max sensible limits.
- `tiers`: quality levels `{label, default, options: [{id, label, note}]}`, 2 to 3 of them (e.g. basic, standard, premium). Omit for a single level; then each line's `prices` has one key, `"default"`.
- `contingency`: `{default, max}` as fractions, e.g. 0.1 and 0.3.
- `groups`: 3 to 6 `{id, label}` that split the total.
- `lines`: 8 to 16 items `{id, group, label, description, per, unit, qty, qtyMax, optional, prices, source, notes}`. `per` is an input id (price is per unit of that input) or "fixed" (price per unit and the viewer sets `qty`, e.g. 2 bathrooms). `unit` says what one unit is ("per sqm", "per room"). `prices` has one `{low, high}` range per tier id, for ONE unit; low is a cheap but realistic quote, high a dear one. Mark `optional: true` for things many people skip; they start switched off.
- Every price is a range from real sources. Where a source gives only a whole-project range, split it across lines yourself, say so in `limits`, and give the line `"type": "estimate"`.
