/* Cost-estimator maths. Inlined into the estimate page by lib/render.ts and loaded by tests (module.exports below). */

/** The price range of a line at a quality level; a missing level falls back to the first one on file. */
function linePrice(line, tier) {
  return line.prices[tier] || line.prices.default || Object.values(line.prices)[0];
}

/**
 * Totals for the chosen options.
 * state: { tier, inputs: {id: number}, qty: {lineId: number}, off: {lineId: boolean}, contingency: fraction }
 * A line is on unless the viewer switched it off, or it is optional and the viewer never switched it on.
 */
function estimate(spec, state) {
  const lines = spec.lines.map((line) => {
    const price = linePrice(line, state.tier);
    const on = state.on[line.id] !== undefined ? !!state.on[line.id] : !line.optional;
    const per = line.per && line.per !== "fixed" ? line.per : null;
    const qty = per ? Number(state.inputs[per]) || 0 : state.qty[line.id] !== undefined ? state.qty[line.id] : line.qty;
    const low = on ? price.low * qty : 0;
    const high = on ? price.high * qty : 0;
    return { id: line.id, group: line.group, on, per, qty, unitLow: price.low, unitHigh: price.high, low, high };
  });
  const groups = spec.groups.map((g) => {
    const mine = lines.filter((l) => l.group === g.id);
    return { id: g.id, label: g.label, low: mine.reduce((a, l) => a + l.low, 0), high: mine.reduce((a, l) => a + l.high, 0) };
  });
  const subLow = groups.reduce((a, g) => a + g.low, 0);
  const subHigh = groups.reduce((a, g) => a + g.high, 0);
  const c = Math.max(0, state.contingency || 0);
  const low = subLow * (1 + c), high = subHigh * (1 + c);
  return { lines, groups, subLow, subHigh, contingency: c, low, high, mid: (low + high) / 2 };
}

if (typeof module !== "undefined" && module.exports) module.exports = { linePrice, estimate };
