import fs from "node:fs";
import path from "node:path";
import { formatSgd, modelName, SGD_PER_USD, summariseBuildLog } from "./pricing";
import type { Spec } from "./spec";

const TEMPLATES = path.join(process.cwd(), "templates");
const read = (file: string) => fs.readFileSync(path.join(TEMPLATES, file), "utf8");

/** Which page template and engine script each kind of calculator uses. */
const KIND_FILES: Record<Spec["kind"], { template: string; engine?: string }> = {
  compare: { template: "calculator.html" },
  estimate: { template: "estimate.html", engine: "estimate-engine.js" },
  projection: { template: "projection.html", engine: "projection-engine.js" },
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const num = (n: number) => n.toLocaleString("en-SG");

/** The "How this page was built" section: every agent call with its model, tokens, searches and estimated cost. */
export function buildCostSection(spec: Spec): string {
  const style = `<style>
#build-cost{max-width:1200px;margin:0 auto;padding:8px 16px 48px;font-family:Geist,system-ui,sans-serif}
#build-cost h2{font-size:1.15rem;margin:24px 0 8px}#build-cost p,#build-cost td,#build-cost th{font-size:.9rem}
#build-cost .scroll{overflow-x:auto}#build-cost table{border-collapse:collapse;width:100%;max-width:880px}
#build-cost th,#build-cost td{text-align:right;padding:6px 10px;border-bottom:1px solid rgba(128,128,128,.3);white-space:nowrap}
#build-cost th:first-child,#build-cost td:first-child{text-align:left;white-space:normal}
#build-cost .mute{opacity:.7}#build-cost tfoot td{font-weight:600}
</style>`;
  const head = `<section id="build-cost">${style}<h2>How this page was built</h2>`;
  if (!spec.buildLog.length) {
    const who = spec.builtBy ?? "Built by hand.";
    return `${head}<p class="mute">${esc(who)} The AI cost was not metered. Pages built by the research agent list every step here, with the model used, tokens, web searches and cost in Singapore dollars.</p></section>`;
  }
  const { rounds, totalSgd } = summariseBuildLog(spec.buildLog);
  let rows = "";
  let reportedTotal = 0, anyReported = false;
  for (const r of rounds) {
    const plan = r.entries.some((e) => e.billing === "subscription") ? " (Claude subscription)" : "";
    rows += `<tbody><tr><td colspan="6"><strong>${esc(r.round)}${plan}</strong></td></tr>`;
    for (const e of r.entries) {
      const tokensIn = e.input + e.cacheRead + e.cacheWrite;
      rows += `<tr><td>${esc(e.label)}</td><td>${esc(modelName(e.model))}</td><td>${num(tokensIn)}</td><td>${num(e.output)}</td><td>${num(e.searches)}</td><td>${formatSgd(e.costSgd)}</td></tr>`;
    }
    rows += `<tr><td colspan="5">${esc(r.round)} subtotal (our API estimate)</td><td>${formatSgd(r.subtotalSgd)}</td></tr>`;
    rows += `<tr class="mute"><td colspan="5">Running total (our API estimate)</td><td>${formatSgd(r.runningTotalSgd)}</td></tr>`;
    if (r.entries.some((e) => e.reportedUsd !== undefined)) {
      const sgd = r.entries.reduce((sum, e) => sum + (e.reportedUsd ?? 0), 0) * SGD_PER_USD;
      reportedTotal += sgd; anyReported = true;
      rows += `<tr><td colspan="5">${esc(r.round)}: cost reported by Claude Code</td><td>${formatSgd(sgd)}</td></tr>`;
    }
    rows += `</tbody>`;
  }
  const onPlan = spec.buildLog.some((e) => e.billing === "subscription");
  const planNote = onPlan
    ? " Rounds run on a Claude subscription were covered by the plan, so their figures show what the same work would have cost on the API. Where shown, \"cost reported by Claude Code\" is the figure Claude Code itself worked out from the same run's tokens, also at list prices and also not a charge; it can differ a little from ours because it prices cache writes and other details its own way. Builds made before it was recorded don't have it."
    : "";
  return `${head}<p class="mute">Estimated from the token counts and web searches reported for each step, priced at the published API rates converted to SGD (S$${SGD_PER_USD.toFixed(2)} per US$1). It is not an invoice and leaves out hosting.${planNote}</p>
<div class="scroll"><table><thead><tr><th>Step</th><th>Model</th><th>Tokens in</th><th>Tokens out</th><th>Searches</th><th>Cost</th></tr></thead>${rows}
<tfoot><tr><td colspan="5">Total AI cost so far (our API estimate)</td><td>${formatSgd(totalSgd)}</td></tr>${anyReported ? `<tr><td colspan="5">Total reported by Claude Code so far</td><td>${formatSgd(reportedTotal)}</td></tr>` : ""}</tfoot></table></div></section>`;
}

/** The "Suggest a change" chat panel: sends refinements to the cheap Sonnet refine path and shows the run's progress. */
export function refineWidget(spec: Spec): string {
  const style = `<style>
#refine-root{position:fixed;right:16px;bottom:16px;z-index:50;font:14px Geist,system-ui,sans-serif;color:#111}
#refine-root .rf-open{background:#1d4ed8;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
#refine-root .rf-panel{width:min(360px,calc(100vw - 32px));max-height:80vh;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:12px;padding:12px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
#refine-root .rf-head{display:flex;justify-content:space-between;align-items:center}
#refine-root .rf-x{background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:inherit}
#refine-root .rf-note{margin:6px 0;opacity:.75;font-size:12.5px}
#refine-root .rf-chat{max-height:200px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin:6px 0}
#refine-root .rf-msg{margin:0;padding:6px 10px;border-radius:10px;max-width:90%}
#refine-root .rf-me{align-self:flex-end;background:#dbeafe}#refine-root .rf-bot{align-self:flex-start;background:#f1f1f1}
#refine-root .rf-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
#refine-root .rf-chip{border:1px solid #bbb;background:#fff;border-radius:999px;padding:4px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:inherit}
#refine-root .rf-form{display:grid;gap:6px}#refine-root .rf-in{width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:8px;padding:6px 8px;font:inherit;color:inherit;background:#fff}
#refine-root .rf-check{font-size:12.5px}#refine-root .rf-send{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:8px;font:inherit;font-weight:600;cursor:pointer}
#refine-root .rf-send:disabled{opacity:.6}
@media print{#refine-root{display:none}}
</style>`;
  const config = JSON.stringify({ slug: spec.id, kind: spec.kind }).replace(/</g, "\\u003c");
  return `<div id="refine-root"></div>${style}<script>${read("refine.js").replace("__REFINE_CONFIG__", () => config)}</script>`;
}

/** The full calculator page: the kind's template with the shared styles and scripts and this spec built in. */
export function renderCalculatorHtml(spec: Spec, template = read(KIND_FILES[spec.kind].template)): string {
  // The page script only needs what it renders; the build log is shown by the section below.
  const { buildLog: _log, ...pageSpec } = spec;
  void _log;
  const json = JSON.stringify(pageSpec).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
  const nav = `<div style="padding:10px 16px;font:500 14px Geist,system-ui,sans-serif"><a href="/" style="color:inherit">&larr; All calculators</a></div>`;
  const engine = KIND_FILES[spec.kind].engine;
  let html = template
    .replace("__BASE_CSS__", () => read("shared.css"))
    .replace("__COMMON_JS__", () => read("common.js"))
    .replace("__ENGINE_JS__", () => (engine ? read(engine) : ""))
    .replace("__SPEC_JSON__", () => json)
    .replace("__TITLE__", () => esc(spec.title));
  html = html.replace("<body>", () => "<body>" + nav);
  // The page script also contains the text "</body>", so insert before the real closing tag (the last one).
  const end = html.lastIndexOf("</body>");
  return html.slice(0, end) + buildCostSection(spec) + refineWidget(spec) + html.slice(end);
}
