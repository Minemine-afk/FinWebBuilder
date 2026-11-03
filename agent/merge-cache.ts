/**
 * Resolves a git conflict in data/price-cache.json during `git rebase`, when another build published first.
 * Stage 1 is the common base, stage 2 the branch we are rebasing onto, stage 3 this build's commit.
 * Both builds' prices are kept (see mergeCaches in lib/price-cache.ts).
 */
import { execFileSync } from "node:child_process";
import { mergeCaches, writeCache, type CacheEntry } from "@/lib/price-cache";

const FILE = "data/price-cache.json";

function stage(n: number): CacheEntry[] {
  try {
    const text = execFileSync("git", ["show", `:${n}:${FILE}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const data = JSON.parse(text) as { entries?: CacheEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

const merged = mergeCaches(stage(1), stage(2), stage(3));
writeCache(merged);
console.log(`Merged the price cache: ${merged.length} entries.`);
