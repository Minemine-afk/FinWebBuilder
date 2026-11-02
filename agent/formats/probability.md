# probability: the chance a plan lasts

Use when the answer is a chance, not a number: "will my savings last in retirement", "how much can I withdraw each year", drawdown and goal-success topics. The page runs many simulated market paths and shows the share that last, a typical and a poor-market ending balance, and the yearly spending that still holds the target chance. Worked example: agent/examples/probability.json. The schema is `ProbabilitySpecSchema` in lib/spec.ts.

Top level: `"kind": "probability"`, `id`, `title`, `subject` (singular noun, default "portfolio"), `currency`, `scope`, `limits`, `savings`, `withdrawal`, optional `contribution`, `yearsToStart`, `yearsInRetirement`, `inflation`, `simulations`, `seed`, `target`, `items`, `defaults`.

- `savings`, `withdrawal`, `contribution`: viewer inputs `{id, label, unit, default, min, max, step, rationale}` in today's money. `withdrawal` is per year. `contribution` is per year until withdrawals begin; leave it out when nothing more is saved.
- `yearsToStart` / `yearsInRetirement`: `{default, min, max}` in years. `yearsToStart` may be 0.
- `inflation`: yearly fraction (default 0.025). Use the central bank's target or a recent average, and say which in `limits`.
- `target`: the share of paths that must last (default 0.9). `simulations` default 1000; keep `seed` fixed.
- `items`: 2 to 5 portfolios `{id, name, option, expectedReturn, volatility, source: {url, verified, type}, notes, rationale}`. `expectedReturn` is the average yearly return before inflation as a fraction; `volatility` is the yearly standard deviation as a fraction. Take both from the same published source and period (a long-run index dataset or a fund provider's capital-market assumptions), and say the period in `rationale`. More volatile portfolios should have the higher expected return.
- Defaults: pick `savings`, `withdrawal` and years that fit a typical reader of the topic, not an extreme.

Research per portfolio: the long-run average yearly return and its yearly volatility, the period, and the source. Mark a figure ESTIMATE when it is a reasoned blend of two published figures, and say how it was blended.
In `limits`, say this is a model of possible markets, not a forecast, and what it leaves out (tax, fees, changing spending, taxes on withdrawals, state pensions).
