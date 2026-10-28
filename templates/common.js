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

/** A small "i" button whose text (the reasoning behind a figure) shows on hover, focus or tap. Empty text gives nothing. */
function tip(text) {
  const t = String(text ?? "").trim();
  return t ? `<button type="button" class="tip" data-tip="${esc(t)}" aria-label="Why: ${esc(t)}" aria-expanded="false">i</button>` : "";
}

/** Wires the hover-text boxes for every tip() on the page, now and later. Call once. */
function initTips() {
  if (typeof document === "undefined") return;
  const box = document.createElement("div");
  box.id = "tipBox"; box.setAttribute("role", "tooltip"); box.hidden = true;
  document.body.appendChild(box);
  let pinned = null;
  const show = (el) => {
    box.textContent = el.dataset.tip; box.hidden = false;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    const left = Math.min(window.innerWidth - b.width - 12, Math.max(12, r.left + r.width / 2 - b.width / 2));
    const top = r.bottom + 8 + b.height > window.innerHeight ? r.top - b.height - 8 : r.bottom + 8;
    box.style.left = left + "px"; box.style.top = Math.max(8, top) + "px";
    el.setAttribute("aria-expanded", "true");
  };
  const hide = (el) => { if (pinned && pinned !== el) return; box.hidden = true; if (el) el.setAttribute("aria-expanded", "false"); };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest && e.target.closest(".tip"); if (el && !pinned) show(el); });
  document.addEventListener("mouseout", (e) => { const el = e.target.closest && e.target.closest(".tip"); if (el && !pinned) hide(el); });
  document.addEventListener("focusin", (e) => { if (e.target.classList && e.target.classList.contains("tip")) show(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target.classList && e.target.classList.contains("tip") && pinned !== e.target) hide(e.target); });
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest(".tip");
    if (el) { e.preventDefault(); e.stopPropagation(); if (pinned === el) { pinned = null; hide(el); } else { if (pinned) pinned.setAttribute("aria-expanded", "false"); pinned = el; show(el); } return; }
    if (pinned) { const p = pinned; pinned = null; hide(p); }
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { const p = pinned || document.querySelector('.tip[aria-expanded="true"]'); pinned = null; hide(p); } });
  window.addEventListener("scroll", () => { if (!box.hidden) { const p = pinned; pinned = null; hide(p); } }, { passive: true });
}

/** Source badge and link, shared by every kind of page. */
function sourceBadge(src) {
  src = src || {};
  const su = safeUrl(src.url);
  const pill = src.type === "estimate" ? `<span class="pill warn" title="Worked out by the research agent from the sources it found, not a published figure">AI estimate</span>` : src.type === "secondary" ? `<span class="pill warn">Unofficial</span>` : src.type === "official" ? `<span class="pill good">Official</span>` : "";
  return pill + (su ? ` <a href="${esc(su)}" target="_blank" rel="noopener">${esc(hostOf(su))}</a>` : "");
}

/** Yearly compound growth across a history (oldest to newest), or 0. Same rule as lib/spec.ts historyCagr. */
function cagr(history) {
  const pts = (history || []).slice().sort((a, b) => a.year - b.year);
  if (pts.length < 2 || pts[0].value <= 0 || pts[pts.length - 1].year === pts[0].year) return 0;
  return Math.pow(pts[pts.length - 1].value / pts[0].value, 1 / (pts[pts.length - 1].year - pts[0].year)) - 1;
}

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

if (typeof module !== "undefined" && module.exports) module.exports = { esc, tip, initTips, sourceBadge, cagr, safeUrl, hostOf, pct, money, niceStep, shortMoney, clampInput, cumulative, breakEven };
