/* Cost-estimator maths. Inlined into the estimate page by lib/render.ts and loaded by tests (module.exports below). */

/** The price range of a line at a quality level; a missing level falls back to the first one on file. */
function linePrice(line, tier) {
  return line.prices[tier] || line.prices.default || Object.values(line.prices)[0];
}

/** Yearly compound growth from the first to the last point of a history (0 when it can't be worked out). */
function historyRate(history) {
  const pts = (history || []).slice().sort((a, b) => a.year - b.year);
  if (pts.length < 2) return 0;
  const first = pts[0], last = pts[pts.length - 1];
  if (last.year === first.year || !(first.value > 0)) return 0;
  return Math.pow(last.value / first.value, 1 / (last.year - first.year)) - 1;
}

/**
 * How a provider moves the line prices: its price level, its yearly rate (from its own history) and the
 * multiplier for a job priced in `year`. Without providers everything is 1.
 */
function providerScale(spec, providerId, year) {
  const list = spec.providers ? spec.providers.options : [];
  const p = list.find((o) => o.id === providerId) || list.find((o) => spec.providers && o.id === spec.providers.default);
  if (!p) return { provider: null, factor: 1, rate: 0, years: 0, growth: 1, scale: 1 };
  const rate = historyRate(p.history);
  const years = Math.max(0, (year || spec.priceYear) - spec.priceYear);
  const growth = Math.pow(1 + rate, years);
  return { provider: p, factor: p.factor, rate, years, growth, scale: p.factor * growth };
}

/**
 * Totals for the chosen options.
 * state: { tier, inputs: {id: number}, qty: {lineId: number}, on: {lineId: boolean}, contingency: fraction, preset?, provider?, year? }
 * A line is on when the viewer switched it on; otherwise when the chosen preset lists it (or, with no presets, when it is not optional).
 */
function estimate(spec, state) {
  const preset = spec.presets ? spec.presets.options.find((o) => o.id === state.preset) || spec.presets.options.find((o) => o.id === spec.presets.default) : null;
  const ps = providerScale(spec, state.provider, state.year);
  const lines = spec.lines.map((line) => {
    const price = linePrice(line, state.tier);
    const byDefault = preset ? preset.lines.includes(line.id) : !line.optional;
    const on = state.on[line.id] !== undefined ? !!state.on[line.id] : byDefault;
    const per = line.per && line.per !== "fixed" ? line.per : null;
    const qty = per ? Number(state.inputs[per]) || 0 : state.qty[line.id] !== undefined ? state.qty[line.id] : line.qty;
    const unitLow = price.low * ps.scale, unitHigh = price.high * ps.scale;
    const low = on ? unitLow * qty : 0;
    const high = on ? unitHigh * qty : 0;
    return { id: line.id, group: line.group, on, per, qty, unitLow, unitHigh, low, high };
  });
  const groups = spec.groups.map((g) => {
    const mine = lines.filter((l) => l.group === g.id);
    return { id: g.id, label: g.label, low: mine.reduce((a, l) => a + l.low, 0), high: mine.reduce((a, l) => a + l.high, 0) };
  });
  const subLow = groups.reduce((a, g) => a + g.low, 0);
  const subHigh = groups.reduce((a, g) => a + g.high, 0);
  const c = Math.max(0, state.contingency || 0);
  const low = subLow * (1 + c), high = subHigh * (1 + c);
  return { lines, groups, subLow, subHigh, contingency: c, low, high, mid: (low + high) / 2, preset: preset ? preset.id : null, provider: ps };
}

/** The same job at every provider, cheapest first. */
function compareProviders(spec, state) {
  if (!spec.providers) return [];
  return spec.providers.options
    .map((p) => { const e = estimate(spec, { ...state, provider: p.id }); return { id: p.id, name: p.name, type: p.type, rate: e.provider.rate, factor: p.factor, low: e.low, high: e.high, mid: e.mid }; })
    .sort((a, b) => a.mid - b.mid);
}

if (typeof module !== "undefined" && module.exports) module.exports = { linePrice, historyRate, providerScale, estimate, compareProviders };
