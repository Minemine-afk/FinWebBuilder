import fs from "node:fs";
import path from "node:path";
import { formatSgd, modelName, SGD_PER_USD, summariseBuildLog } from "./pricing";
import type { Spec } from "./spec";

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "calculator.html");

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
  for (const r of rounds) {
    const plan = r.entries.some((e) => e.billing === "subscription") ? " (Claude subscription)" : "";
    rows += `<tbody><tr><td colspan="6"><strong>${esc(r.round)}${plan}</strong></td></tr>`;
    for (const e of r.entries) {
      const tokensIn = e.input + e.cacheRead + e.cacheWrite;
      rows += `<tr><td>${esc(e.label)}</td><td>${esc(modelName(e.model))}</td><td>${num(tokensIn)}</td><td>${num(e.output)}</td><td>${num(e.searches)}</td><td>${formatSgd(e.costSgd)}</td></tr>`;
    }
    rows += `<tr><td colspan="5">${esc(r.round)} subtotal</td><td>${formatSgd(r.subtotalSgd)}</td></tr>`;
    rows += `<tr class="mute"><td colspan="5">Running total</td><td>${formatSgd(r.runningTotalSgd)}</td></tr></tbody>`;
  }
  const onPlan = spec.buildLog.some((e) => e.billing === "subscription");
  const planNote = onPlan
    ? " Rounds run on a Claude subscription were covered by the plan, so their figures show what the same work would have cost on the API."
    : "";
  return `${head}<p class="mute">Estimated from the token counts and web searches reported for each step, priced at the published API rates converted to SGD (S$${SGD_PER_USD.toFixed(2)} per US$1). It is not an invoice and leaves out hosting.${planNote}</p>
<div class="scroll"><table><thead><tr><th>Step</th><th>Model</th><th>Tokens in</th><th>Tokens out</th><th>Searches</th><th>Cost</th></tr></thead>${rows}
<tfoot><tr><td colspan="5">Total AI cost so far</td><td>${formatSgd(totalSgd)}</td></tr></tfoot></table></div></section>`;
}

/** The full calculator page: the prototype's standalone page with this spec built in. */
export function renderCalculatorHtml(spec: Spec, template = fs.readFileSync(TEMPLATE_PATH, "utf8")): string {
  // The page script only needs what it renders; the build log is shown by the section below.
  const { buildLog: _log, ...pageSpec } = spec;
  void _log;
  const json = JSON.stringify(pageSpec).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
  const nav = `<div style="padding:10px 16px;font:500 14px Geist,system-ui,sans-serif"><a href="/" style="color:inherit">&larr; All calculators</a></div>`;
  let html = template.replace("__SPEC_JSON__", () => json).replace("__TITLE__", () => esc(spec.title));
  html = html.replace("<body>", () => "<body>" + nav);
  // The page script also contains the text "</body>", so insert before the real closing tag (the last one).
  const end = html.lastIndexOf("</body>");
  return html.slice(0, end) + buildCostSection(spec) + html.slice(end);
}
