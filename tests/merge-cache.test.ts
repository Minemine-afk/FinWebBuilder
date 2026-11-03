import { describe, expect, it } from "vitest";
import { mergeCaches, type CacheEntry } from "@/lib/price-cache";

const e = (calc: string, id: string, figure = "1"): CacheEntry => ({
  calc, id, name: id, tags: [], figure, currency: "SGD",
  source: { url: "https://example.com", verified: "2026-11-02", type: "secondary" }, rationale: "",
});

describe("mergeCaches", () => {
  it("keeps the entries of both builds", () => {
    const base = [e("old", "a")];
    const remote = [e("old", "a"), e("one", "x")];
    const mine = [e("old", "a"), e("two", "y")];
    expect(mergeCaches(base, remote, mine).map((m) => m.id)).toEqual(["a", "x", "y"]);
  });
  it("takes my entries for a calculator I rebuilt and the other side's for the rest", () => {
    const base = [e("a", "1", "old"), e("b", "2", "old")];
    const remote = [e("a", "1", "old"), e("b", "2", "newer")];
    const mine = [e("a", "1", "mine"), e("b", "2", "old")];
    const out = mergeCaches(base, remote, mine);
    expect(out.find((m) => m.calc === "a")?.figure).toBe("mine");
    expect(out.find((m) => m.calc === "b")?.figure).toBe("newer");
  });
});
