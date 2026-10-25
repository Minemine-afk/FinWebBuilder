import fs from "node:fs";
import path from "node:path";
import { SpecSchema, type Spec } from "./spec";

export const DATA_DIR = path.join(process.cwd(), "data", "calculators");
export const HISTORY_DIR = path.join(process.cwd(), "data", "history");

export function calculatorPath(slug: string) {
  return path.join(DATA_DIR, `${slug}.json`);
}

export function readCalculator(slug: string): Spec | null {
  const file = calculatorPath(slug);
  if (!fs.existsSync(file)) return null;
  return SpecSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function listCalculators(): Spec[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readCalculator(f.replace(/\.json$/, "")))
    .filter((s): s is Spec => s !== null)
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.title.localeCompare(b.title));
}

/** Saves a calculator, keeping a copy of the version it replaces in data/history/<slug>/v<N>.json. */
export function writeCalculator(spec: Spec) {
  const parsed = SpecSchema.parse(spec);
  const previous = readCalculator(parsed.id);
  if (previous) {
    const dir = path.join(HISTORY_DIR, parsed.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `v${previous.version}.json`), JSON.stringify(previous, null, 2) + "\n");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(calculatorPath(parsed.id), JSON.stringify(parsed, null, 2) + "\n");
  return parsed;
}
