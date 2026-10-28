/**
 * Official Singapore datasets the builder can pull straight into a projection calculator, so prices and
 * growth rates come from the published records rather than from a model reading web pages.
 *
 *   hdb-resale <slug> [--towns a,b] [--types "3 ROOM,4 ROOM"]
 *       HDB resale transactions (data.gov.sg). Adds one item per town and flat type: the median price of the
 *       last 12 months, the medians of the three 12-month windows before it, and rates from those yearly changes.
 *   private-index
 *       Prints URA's private residential price indices (SingStat M212261 landed, M212271 non-landed by region).
 *   private-items <slug> '<json array>'
 *       Adds private-property items whose price level the agent researched. Their history and rates come from
 *       the URA index for their segment, so every item's yearly rate is measured over the same three years.
 *
 * Items are tagged with "location" and "type" filters, which this script adds to the file as needed.
 */
import fs from "node:fs";
import { calculatorPath } from "@/lib/data";
import { historyCagr } from "@/lib/spec";

export const HDB_RESALE_DATASET = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
export const HDB_RESALE_PAGE = `https://data.gov.sg/datasets/${HDB_RESALE_DATASET}/view`;
const SINGSTAT = (id: string) => `https://tablebuilder.singstat.gov.sg/api/table/tabledata/${id}`;
export const SINGSTAT_PAGE = (id: string) => `https://tablebuilder.singstat.gov.sg/table/TS/${id}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const today = () => new Date().toISOString().slice(0, 10);
export const slugPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bHdb\b/g, "HDB");

export interface ResaleRow { month: string; town: string; flat_type: string; resale_price: number }
interface HistoryPoint { year: number; value: number; label?: string; url?: string }
export interface ProjectionItem {
  id: string; name: string; option: string; value: number; priceYear: number;
  rates: { low: number; base: number; high: number }; rateBasis: string;
  source: { url: string; verified: string; type: "official" | "secondary" | "estimate" };
  notes: string; tags: Record<string, string>; history: HistoryPoint[]; rationale: string;
}
interface FilterOption { id: string; label: string; group?: string; rationale?: string }

export function parseCsv(text: string): ResaleRow[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const col = (name: string) => head.indexOf(name);
  const [m, t, f, p] = [col("month"), col("town"), col("flat_type"), col("resale_price")];
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    return { month: c[m], town: c[t], flat_type: c[f], resale_price: Number(c[p]) };
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthName = (i: number) => `${MONTHS[i % 12]} ${Math.floor(i / 12)}`;

/** Low, base and high yearly rates from a history: base is the compound rate, low and high the weakest and strongest single year. */
export function ratesFromHistory(history: HistoryPoint[]) {
  const base = historyCagr(history) ?? 0;
  const yoy = history.slice(1).map((h, i) => h.value / history[i].value - 1);
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return { low: r4(Math.min(base, ...yoy)), base: r4(base), high: r4(Math.max(base, ...yoy)), yoy };
}

/**
 * One item per town and flat type with at least `minSales` sales in every window. Windows are the 12 months to the
 * latest month in the data, and the three 12-month periods before it, so each step is exactly one year.
 */
export function summariseResale(rows: ResaleRow[], opts: { towns?: string[]; types?: string[]; minSales?: number } = {}) {
  const latest = rows.reduce((m, r) => Math.max(m, monthIndex(r.month)), 0);
  const windows = [3, 2, 1, 0].map((k) => ({ end: latest - 12 * k, start: latest - 12 * k - 11 }));
  const minSales = opts.minSales ?? 10;
  const groups = new Map<string, number[][]>();
  for (const r of rows) {
    if (opts.towns && !opts.towns.includes(r.town)) continue;
    if (opts.types && !opts.types.includes(r.flat_type)) continue;
    const mi = monthIndex(r.month);
    const w = windows.findIndex((x) => mi >= x.start && mi <= x.end);
    if (w < 0) continue;
    const key = `${r.town}|${r.flat_type}`;
    if (!groups.has(key)) groups.set(key, [[], [], [], []]);
    groups.get(key)![w].push(r.resale_price);
  }
  const latestYear = Math.floor(latest / 12);
  const period = (w: { start: number; end: number }) => `${monthName(w.start)} to ${monthName(w.end)}`;
  const items: ProjectionItem[] = [];
  const skipped: string[] = [];
  for (const [key, sets] of [...groups.entries()].sort()) {
    const [town, type] = key.split("|");
    const counts = sets.map((s) => s.length);
    if (Math.min(...counts) < minSales) { skipped.push(`${town} ${type} (${counts.join("/")} sales)`); continue; }
    const history = sets.map((s, i) => ({
      year: latestYear - 3 + i,
      value: Math.round(median(s)),
      label: `Median of ${s.length.toLocaleString("en-SG")} resales, ${period(windows[i])}`,
    }));
    const { yoy, ...rates } = ratesFromHistory(history);
    const typeLabel = titleCase(type).replace(" Room", "-room");
    const changes = yoy.map((r, i) => `${history[i + 1].year}: ${(r * 100).toFixed(1)}%`).join(", ");
    items.push({
      id: `hdb-${slugPart(town)}-${slugPart(type)}`,
      name: `${titleCase(town)} · ${typeLabel} HDB flat`,
      option: `Median resale price, ${period(windows[3])}`,
      value: history[3].value,
      priceYear: latestYear,
      rates,
      rateBasis: `Base: compound yearly change of the median resale price over the last 3 years (${history[0].year} to ${history[3].year}, 12-month windows). Low and high: the weakest and strongest of those years (${changes}).`,
      source: { url: HDB_RESALE_PAGE, verified: today(), type: "official" },
      notes: `HDB resale transactions registered with HDB, published on data.gov.sg. ${counts[3].toLocaleString("en-SG")} sales in the latest 12 months.`,
      tags: { location: `${slugPart(town)}`, type: `hdb-${slugPart(type)}` },
      history,
      rationale: `Real transaction data, not an estimate: the median of every ${typeLabel} resale in ${titleCase(town)} registered in each 12-month window. A median moves with the mix of flats sold (newer or older blocks, higher or lower floors), and remaining lease matters: older flats tend to rise more slowly. The projection assumes the last 3 years' yearly rate carries on, which is a scenario, not a forecast.`,
    });
  }
  return { items, skipped, latest: monthName(latest), windows: windows.map(period) };
}

/** Year-on-year history of an index at its latest quarter, e.g. 3Q 2023, 3Q 2024, 3Q 2025, 3Q 2026. */
export function indexHistory(series: Record<string, number>) {
  const keys = Object.keys(series).sort((a, b) => a.localeCompare(b));
  const latest = keys[keys.length - 1];
  const [year, q] = latest.split(" ");
  return [3, 2, 1, 0].map((k) => {
    const key = `${Number(year) - k} ${q}`;
    if (!(key in series)) throw new Error(`Index has no ${key}.`);
    return { year: Number(year) - k, quarter: key, value: series[key] };
  });
}

async function singstat(id: string): Promise<Record<string, Record<string, number>>> {
  const res = await fetch(SINGSTAT(id), { headers: { "User-Agent": "finwebbuilder", Accept: "application/json" } });
  if (!res.ok) throw new Error(`SingStat ${id}: HTTP ${res.status}`);
  const body = (await res.json()) as { Data: { row: { rowText: string; columns: { key: string; value: string }[] }[] } };
  return Object.fromEntries(body.Data.row.map((r) => [r.rowText, Object.fromEntries(r.columns.map((c) => [c.key, Number(c.value)]))]));
}

/** The URA indices each private segment follows. EC resale has no index of its own, so it follows non-landed OCR. */
export async function privateIndices() {
  const [byType, byRegion] = await Promise.all([singstat("M212261"), singstat("M212271")]);
  const pick = (table: Record<string, Record<string, number>>, row: string, id: string) => {
    if (!table[row]) throw new Error(`SingStat ${id} has no row "${row}" (rows: ${Object.keys(table).join(", ")}).`);
    return { id, row, history: indexHistory(table[row]) };
  };
  return {
    landed: pick(byType, "Landed", "M212261"),
    "non-landed": pick(byType, "Non-Landed", "M212261"),
    CCR: pick(byRegion, "Core Central Region", "M212271"),
    RCR: pick(byRegion, "Rest Of Central Region", "M212271"),
    OCR: pick(byRegion, "Outside Central Region", "M212271"),
  };
}

export const PRIVATE_TYPES: Record<string, { label: string; segment: (region: string) => string }> = {
  condo: { label: "Condominium or apartment", segment: (r) => r },
  ec: { label: "Executive condominium", segment: () => "OCR" },
  landed: { label: "Landed house", segment: () => "landed" },
};

export interface PrivateInput {
  location: string; label?: string; type: keyof typeof PRIVATE_TYPES; region: "CCR" | "RCR" | "OCR";
  value: number; url: string; basis: string; sourceType?: "secondary" | "estimate" | "official"; option?: string;
}

/**
 * A private-property item: today's price level is the researched `value`; earlier years are that value moved back
 * along its URA index, so its yearly rate is the index's measured rise over the same three years.
 */
export function privateItem(p: PrivateInput, indices: Awaited<ReturnType<typeof privateIndices>>): ProjectionItem {
  const kind = PRIVATE_TYPES[p.type];
  if (!kind) throw new Error(`Unknown private type "${p.type}" (use ${Object.keys(PRIVATE_TYPES).join(", ")}).`);
  const segment = kind.segment(p.region) as keyof typeof indices;
  const idx = indices[segment];
  const last = idx.history[3];
  const history = idx.history.map((h) => ({
    year: h.year,
    value: Math.round((p.value * h.value) / last.value / 1000) * 1000,
    label: `Today's price moved along URA ${segment === "landed" ? "landed" : segment + " non-landed"} index (${h.quarter}: ${h.value})`,
    url: SINGSTAT_PAGE(idx.id),
  }));
  history[3].value = p.value;
  const { yoy, ...rates } = ratesFromHistory(history);
  const label = p.label ?? titleCase(p.location.replace(/-/g, " "));
  const changes = yoy.map((r, i) => `${history[i + 1].year}: ${(r * 100).toFixed(1)}%`).join(", ");
  return {
    id: `${p.type}-${slugPart(p.location)}`,
    name: `${label} · ${kind.label}`,
    option: p.option ?? "Typical price today",
    value: p.value,
    priceYear: last.year,
    rates,
    rateBasis: `Base: compound yearly change of URA's ${segment === "landed" ? "landed" : segment + " non-landed"} price index over the last 3 years (${idx.history[0].quarter} to ${last.quarter}). Low and high: its weakest and strongest year (${changes}).`,
    source: { url: p.url, verified: today(), type: p.sourceType ?? "secondary" },
    notes: p.basis,
    tags: { location: slugPart(p.location), type: p.type },
    history,
    rationale: `The price today is researched (${p.basis}). URA publishes private price indices by region and type, not by town, so this item's past prices and its yearly rate follow the ${segment === "landed" ? "island-wide landed" : segment === "OCR" && p.type === "ec" ? "Outside Central Region non-landed index (ECs have no index of their own)" : segment + " non-landed"} index (official, SingStat ${idx.id}). A single estate can rise faster or slower than its region.`,
  };
}

const TYPE_OPTIONS: FilterOption[] = [
  { id: "hdb-1-room", label: "HDB 1-room", group: "HDB flat" },
  { id: "hdb-2-room", label: "HDB 2-room", group: "HDB flat" },
  { id: "hdb-3-room", label: "HDB 3-room", group: "HDB flat" },
  { id: "hdb-4-room", label: "HDB 4-room", group: "HDB flat" },
  { id: "hdb-5-room", label: "HDB 5-room", group: "HDB flat" },
  { id: "hdb-executive", label: "HDB executive flat", group: "HDB flat" },
  { id: "hdb-multi-generation", label: "HDB multi-generation flat", group: "HDB flat" },
  { id: "ec", label: "Executive condominium (EC)", group: "Private" },
  { id: "condo", label: "Condominium or apartment", group: "Private" },
  { id: "landed", label: "Landed house", group: "Private" },
];

/** Adds or replaces items (by id) and makes sure the location and type filters list every tag they use. */
export function mergeItems(spec: Record<string, unknown>, items: ProjectionItem[], locationLabels: Record<string, string> = {}) {
  const existing = (Array.isArray(spec.items) ? spec.items : []) as { id: string }[];
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const it of items) byId.set(it.id, it);
  const all = [...byId.values()] as ProjectionItem[];
  const filters = (Array.isArray(spec.filters) ? spec.filters : []) as { id: string; label: string; options: FilterOption[] }[];
  const ensure = (id: string, label: string) => {
    let f = filters.find((x) => x.id === id);
    if (!f) { f = { id, label, options: [] }; filters.push(f); }
    return f;
  };
  const loc = ensure("location", "Location");
  const type = ensure("type", "Property type");
  for (const it of all) {
    const l = it.tags?.location, t = it.tags?.type;
    if (l && !loc.options.some((o) => o.id === l)) loc.options.push({ id: l, label: locationLabels[l] ?? titleCase(l.replace(/-/g, " ")) });
    if (t && !type.options.some((o) => o.id === t)) type.options.push(TYPE_OPTIONS.find((o) => o.id === t) ?? { id: t, label: titleCase(t.replace(/-/g, " ")) });
  }
  loc.options.sort((a, b) => a.label.localeCompare(b.label));
  type.options.sort((a, b) => TYPE_OPTIONS.findIndex((o) => o.id === a.id) - TYPE_OPTIONS.findIndex((o) => o.id === b.id));
  return { ...spec, items: all, filters, baseRateFrom: "history" };
}

function readOrSkeleton(slug: string): Record<string, unknown> {
  const file = calculatorPath(slug);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    kind: "projection", id: slug, title: "Property value", currency: "SGD", subject: "property", valueLabel: "Price today",
    startMode: "item", years: { default: 5, min: 1, max: 20 }, rateLimits: { min: -0.1, max: 0.15 }, compounding: "annual", items: [],
  };
}
const save = (slug: string, spec: Record<string, unknown>) => fs.writeFileSync(calculatorPath(slug), JSON.stringify(spec, null, 2) + "\n");
const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function downloadResale(): Promise<string> {
  const api = `https://api-open.data.gov.sg/v1/public/api/datasets/${HDB_RESALE_DATASET}`;
  await fetch(`${api}/initiate-download`);
  for (let i = 0; i < 20; i++) {
    const poll = (await (await fetch(`${api}/poll-download`)).json()) as { data?: { status?: string; url?: string } };
    if (poll.data?.url && poll.data.status === "DOWNLOAD_SUCCESS") return (await fetch(poll.data.url)).text();
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("data.gov.sg did not prepare the HDB resale download in time.");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "hdb-resale") {
    const slug = args[0];
    if (!slug || slug.startsWith("--")) throw new Error("Usage: hdb-resale <slug> [--towns A,B] [--types \"3 ROOM,4 ROOM\"]");
    const towns = flag(args, "--towns")?.split(",").map((s) => s.trim().toUpperCase());
    const types = flag(args, "--types")?.split(",").map((s) => s.trim().toUpperCase());
    const rows = parseCsv(await downloadResale());
    const { items, skipped, latest, windows } = summariseResale(rows, { towns, types });
    const labels = Object.fromEntries([...new Set(rows.map((r) => r.town))].map((t) => [slugPart(t), titleCase(t)]));
    save(slug, mergeItems(readOrSkeleton(slug), items, labels));
    console.log(`${rows.length.toLocaleString("en-SG")} resale records to ${latest}. Windows: ${windows.join("; ")}.`);
    console.log(`Added ${items.length} HDB items to data/calculators/${slug}.json (ids hdb-<town>-<flat type>).`);
    for (const it of items) console.log(`  ${it.id}: ${it.value} | base ${(it.rates.base * 100).toFixed(1)}%/yr | ${it.history.map((h) => h.value).join(" > ")}`);
    if (skipped.length) console.log(`Skipped (fewer than 10 sales in a window): ${skipped.join("; ")}`);
  } else if (command === "private-index") {
    const ind = await privateIndices();
    for (const [k, v] of Object.entries(ind)) {
      const g = historyCagr(v.history) ?? 0;
      console.log(`${k} (${v.id} "${v.row}"): ${v.history.map((h) => `${h.quarter} ${h.value}`).join(", ")} | 3-year yearly rate ${(g * 100).toFixed(2)}%`);
    }
    console.log(`Use private-items to add condo (follows its region), ec (follows OCR non-landed) and landed (island-wide landed) items.`);
  } else if (command === "private-items") {
    const slug = args[0];
    const list = JSON.parse(args[1] ?? "[]") as PrivateInput[];
    if (!slug || !list.length) throw new Error(`Usage: private-items <slug> '[{"location":"bukit-batok","label":"Bukit Batok","type":"condo","region":"OCR","value":1450000,"url":"https://...","basis":"..."}]'`);
    const ind = await privateIndices();
    const items = list.map((p) => privateItem(p, ind));
    const labels = Object.fromEntries(list.filter((p) => p.label).map((p) => [slugPart(p.location), p.label!]));
    save(slug, mergeItems(readOrSkeleton(slug), items, labels));
    for (const it of items) console.log(`  ${it.id}: ${it.value} | base ${(it.rates.base * 100).toFixed(1)}%/yr | ${it.history.map((h) => h.value).join(" > ")}`);
    console.log(`Added ${items.length} private items to data/calculators/${slug}.json.`);
  } else {
    throw new Error("Commands: hdb-resale <slug>, private-index, private-items <slug> '<json>'");
  }
}

if (process.argv[1] && /datasets\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
