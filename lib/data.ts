import fs from "node:fs";
import path from "node:path";
import { SpecSchema, type CompareSpec, type Spec } from "./spec";

export const DATA_DIR = path.join(process.cwd(), "data", "calculators");
export const HISTORY_DIR = path.join(process.cwd(), "data", "history");

export function calculatorPath(slug: string) {
  return path.join(DATA_DIR, `${slug}.json`);
}

export function readCalculator(slug: string): Spec | null {
  const file = calculatorPath(slug);
  if (!fs.existsSync(file)) return null;
  return SpecSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) as Spec;
}

/** A comparison calculator; throws if the slug is some other kind. The API agent only builds and refines comparisons. */
export function readCompare(slug: string): CompareSpec | null {
  const spec = readCalculator(slug);
  if (spec && spec.kind !== "compare") throw new Error(`"${slug}" is a ${spec.kind} calculator; this agent only handles comparisons.`);
  return spec;
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

/**
 * Saves a calculator, keeping a copy of the version it replaces in data/history/<slug>/v<N>.json.
 * Pass `previous` when the file on disk has already been overwritten (the subscription run edits it in place).
 */
export function writeCalculator(spec: Spec, previous: Spec | null = readCalculator(spec.id)) {
  const parsed = SpecSchema.parse(spec) as Spec;
  if (previous) {
    const dir = path.join(HISTORY_DIR, parsed.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `v${previous.version}.json`), JSON.stringify(previous, null, 2) + "\n");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(calculatorPath(parsed.id), JSON.stringify(parsed, null, 2) + "\n");
  return parsed;
}

/** The builder's worked example for a kind (agent/examples/<kind>.json), which the tests also use. */
export function readExample<K extends Spec["kind"]>(kind: K): Extract<Spec, { kind: K }> {
  const file = path.join(process.cwd(), "agent", "examples", `${kind}.json`);
  return SpecSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) as Extract<Spec, { kind: K }>;
}
