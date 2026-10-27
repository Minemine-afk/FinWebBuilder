/* Shared page helpers. Inlined into every calculator page by lib/render.ts and loaded by tests (module.exports below). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used by the pages that inline this file
const $ = (id) => document.getElementById(id);
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }
function pct(r) { return (r * 100).toFixed(1) + "%"; }
function money(v, cur) {
  if (cur === "SGD") return (v < 0 ? "-S$" : "S$") + Math.round(Math.abs(v)).toLocaleString("en-SG");
  try { return new Intl.NumberFormat("en-SG", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v); }
  catch { return cur + " " + Math.round(v).toLocaleString("en-SG"); }
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function shortMoney(v) { if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M"; if (v >= 1e3) return (v / 1e3).toFixed(0) + "k"; return Math.round(v).toString(); }

/**
 * Reads a number typed into a limited input. Out-of-range or non-numeric text still gives a usable
 * value (clamped, or the fallback) so results keep showing, plus a message to show under the field.
 */
function clampInput(text, { min, max, fallback, label, unit }) {
  const raw = String(text ?? "").trim();
  const u = unit ? " " + unit : "";
  if (raw === "" || !Number.isFinite(Number(raw))) return { value: fallback, error: `Enter a number for ${label}.` };
  const n = Number(raw);
  if (n < min) return { value: min, error: `${label} must be at least ${min}${u}. Using ${min}.` };
  if (n > max) return { value: max, error: `${label} can be at most ${max}${u}. Using ${max}.` };
  return { value: n, error: null };
}

/** Running totals of per-year totals. */
function cumulative(totals) { let acc = 0; return totals.map((t) => (acc += t)); }

/**
 * Where two options' running costs cross. `a` and `b` are per-year totals; only the years both cover are compared.
 * Returns { years, cheaperAfter: "a"|"b" } with years since the start (e.g. 4.2), or
 * { years: null, cheaper: "a"|"b"|"same" } when one option is cheaper at every year-end.
 */
function breakEven(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 1) return null;
  const ca = cumulative(a.slice(0, n)), cb = cumulative(b.slice(0, n));
  const diff = ca.map((v, i) => v - cb[i]);
  let j = diff[0] !== 0 ? 0 : -1; // last year-end where the two were not level
  for (let i = 1; i < n; i++) {
    if (diff[i] === 0) continue;
    if (j >= 0 && Math.sign(diff[j]) !== Math.sign(diff[i])) {
      const frac = diff[j] / (diff[j] - diff[i]);
      return { years: j + 1 + frac * (i - j), over: n, cheaperAfter: diff[i] < 0 ? "a" : "b" };
    }
    j = i;
  }
  const last = diff[n - 1];
  return { years: null, over: n, cheaper: last < 0 ? "a" : last > 0 ? "b" : "same" };
}

if (typeof module !== "undefined" && module.exports) module.exports = { esc, safeUrl, hostOf, pct, money, niceStep, shortMoney, clampInput, cumulative, breakEven };
