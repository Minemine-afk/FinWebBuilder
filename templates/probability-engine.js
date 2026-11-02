/* Probability maths. Inlined into the probability page by lib/render.ts and loaded by tests (module.exports below). */

/** Small seeded random generator, so the same inputs always give the same answer. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box-Muller) from a uniform generator. */
function normals(rand, count) {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 2) {
    const u = Math.max(rand(), 1e-12), v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < count) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/**
 * Lognormal yearly growth factors with arithmetic mean 1 + mean and standard deviation sd, so the average
 * simulated return matches the stated one.
 */
function lognormalParams(mean, sd) {
  const s2 = Math.log(1 + (sd * sd) / ((1 + mean) * (1 + mean)));
  return { mu: Math.log(1 + mean) - s2 / 2, sigma: Math.sqrt(s2) };
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Simulates the plan. Amounts in, and balances out, are in today's money.
 * p: { savings, contribution (per year until withdrawals start), withdrawal (per year), yearsToStart, yearsInRetirement,
 *      inflation, mean, sd, runs, seed }
 * Each year: before the start, the balance grows then the contribution lands; after it, the withdrawal leaves first,
 * then what is left grows. Both rise with inflation. A path fails when the balance cannot cover a withdrawal.
 * Returns { successRate, years (total), bands: { p10, p50, p90 } (balance at the end of each year, index 0 = now),
 *           medianFinal, p10Final, failYear (first year the 10th-percentile path is empty, or null) }
 */
function simulate(p) {
  const years = p.yearsToStart + p.yearsInRetirement;
  const { mu, sigma } = lognormalParams(p.mean, p.sd);
  const draws = normals(mulberry32(p.seed), p.runs * years);
  const infl = 1 + p.inflation;
  const paths = Array.from({ length: years + 1 }, () => new Float64Array(p.runs));
  let ok = 0;
  for (let r = 0; r < p.runs; r++) {
    let bal = p.savings, alive = true;
    paths[0][r] = bal;
    for (let y = 1; y <= years; y++) {
      const growth = Math.exp(mu + sigma * draws[r * years + (y - 1)]);
      const f = Math.pow(infl, y); // nominal money at the end of year y, per 1 of today's money
      if (y <= p.yearsToStart) bal = bal * growth + (p.contribution || 0) * f;
      else if (alive) {
        bal -= p.withdrawal * f;
        if (bal < 0) { alive = false; bal = 0; } else bal *= growth;
      } else bal = 0;
      paths[y][r] = bal / f;
    }
    if (alive) ok++;
  }
  const bands = { p10: [], p50: [], p90: [] };
  for (let y = 0; y <= years; y++) {
    const s = Array.from(paths[y]).sort((a, b) => a - b);
    bands.p10.push(percentile(s, 0.1)); bands.p50.push(percentile(s, 0.5)); bands.p90.push(percentile(s, 0.9));
  }
  const failIdx = bands.p10.findIndex((v, y) => y > p.yearsToStart && v <= 0);
  return { successRate: ok / p.runs, years, bands, medianFinal: bands.p50[years], p10Final: bands.p10[years], failYear: failIdx < 0 ? null : failIdx };
}

/** Largest yearly withdrawal (today's money) whose success rate still meets `target`, found by bisection. */
function sustainableWithdrawal(p, target) {
  let lo = 0, hi = Math.max(p.withdrawal * 4, p.savings, 1);
  if (simulate({ ...p, withdrawal: hi }).successRate >= target) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (simulate({ ...p, withdrawal: mid }).successRate >= target) lo = mid; else hi = mid;
  }
  return lo;
}

if (typeof module !== "undefined" && module.exports) module.exports = { mulberry32, normals, lognormalParams, percentile, simulate, sustainableWithdrawal };
