/* Projection maths. Inlined into the projection page by lib/render.ts and loaded by tests (module.exports below). */

/** Monthly growth factor minus one, for a yearly rate under the calculator's compounding rule. */
function monthlyRate(rate, compounding) {
  return compounding === "monthly" ? rate / 12 : Math.pow(1 + rate, 1 / 12) - 1;
}

/**
 * Month-by-month simulation, reported once a year. Each month the balance grows, then the deposit lands.
 * p: { start, deposit (per month), rate (yearly), years, compounding, inflation (yearly, 0 for none), goal (0 for none) }
 * Returns { rows: [{ year, open, deposits, growth, close, real, cumDeposits }], final, deposited, growth, goalMonths }
 * goalMonths is the first month the balance reaches the goal (null if never, 0 if it starts there).
 */
function project(p) {
  const i = monthlyRate(p.rate, p.compounding);
  let bal = p.start, deposited = 0, goalMonths = p.goal > 0 && bal >= p.goal ? 0 : null;
  const rows = [];
  for (let y = 1; y <= p.years; y++) {
    const open = bal;
    let dep = 0;
    for (let m = 1; m <= 12; m++) {
      bal = bal * (1 + i) + p.deposit;
      dep += p.deposit;
      if (goalMonths === null && p.goal > 0 && bal >= p.goal) goalMonths = (y - 1) * 12 + m;
    }
    deposited += dep;
    rows.push({ year: y, open, deposits: dep, growth: bal - open - dep, close: bal, real: bal / Math.pow(1 + (p.inflation || 0), y), cumDeposits: deposited });
  }
  return { rows, final: bal, deposited, growth: bal - p.start - deposited, goalMonths };
}

/** Monthly deposit needed to reach `goal` after `years`, starting from `start` (0 if the start alone gets there). */
function requiredDeposit(p) {
  const i = monthlyRate(p.rate, p.compounding), n = p.years * 12;
  if (n <= 0) return Math.max(0, p.goal - p.start);
  const growthFactor = Math.pow(1 + i, n);
  const annuity = i === 0 ? n : (growthFactor - 1) / i;
  return Math.max(0, (p.goal - p.start * growthFactor) / annuity);
}

if (typeof module !== "undefined" && module.exports) module.exports = { monthlyRate, project, requiredDeposit };
