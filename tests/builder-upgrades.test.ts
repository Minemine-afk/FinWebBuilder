import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, qualityReport, requestedMinimum } from "@/agent/subscription";
import { findPlaybook, PLAYBOOKS, playbookPrompt } from "@/agent/playbooks";
import { route, HAIKU } from "@/agent/models";
import { planWithApi } from "@/lib/plan-server";
import { choiceText, clarifyPrompt, estimateCost, fallbackPlan, guessKind, parsePlan, PlanChoiceSchema } from "@/lib/plan";
import { cachePrompt, countCached, findSimilar, harvest, readCache, updateCache } from "@/lib/price-cache";
import { checkQuality } from "@/lib/quality";
import { readExample } from "@/lib/data";
import { renderCalculatorHtml } from "@/lib/render";
import { SpecSchema, type Spec } from "@/lib/spec";
import { describeRun } from "@/lib/github";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const today = new Date("2026-10-28");

describe("topic playbooks", () => {
  it("match vague topics to the right playbook", () => {
    expect(findPlaybook("renovation costs")?.id).toBe("renovation");
    expect(findPlaybook("HDB resale price in Tampines")?.id).toBe("property");
    expect(findPlaybook("2 week trip to Japan")?.id).toBe("travel");
    expect(findPlaybook("EV vs petrol car")?.id).toBe("cars");
    expect(findPlaybook("NUS tuition fees")?.id).toBe("education");
    expect(findPlaybook("owning a pet rock")).toBeNull();
  });
  it("name official sources, a checklist and a minimum", () => {
    expect(PLAYBOOKS.map((p) => p.id)).toEqual(["property", "renovation", "travel", "cars", "education"]);
    for (const p of PLAYBOOKS) {
      expect(p.sources.some((s) => s.official)).toBe(true);
      expect(p.checklist.length).toBeGreaterThanOrEqual(5);
      expect(playbookPrompt(p)).toContain(`at least ${p.minItems}`);
    }
  });
});

describe("scoping plan", () => {
  it("guesses a kind from the wording and falls back to the playbook", () => {
    expect(guessKind("dog vs cat")).toBe("compare");
    expect(guessKind("future price of a condo")).toBe("projection");
    expect(guessKind("how much does a wedding cost")).toBe("estimate");
    expect(guessKind("holiday")).toBeNull();
    const plan = fallbackPlan("renovation");
    expect(plan.kind).toBe("estimate");
    expect(plan.items.length).toBeGreaterThan(5);
    expect(plan.playbook).toBe("renovation");
    expect(plan.source).toBe("fallback");
  });
  it("parses the model's JSON, repairs a bad default and rejects junk", () => {
    const reply = `Here you go: ${JSON.stringify({
      kind: "estimate",
      kindReason: "A project cost.",
      summary: "Covers a 4-room HDB.",
      questions: [{ id: "flat", question: "Which flat type?", options: [{ id: "a", label: "4-room" }, { id: "b", label: "5-room" }], default: "zzz" }],
      items: [{ id: "paint", label: "Painting" }],
      playbook: "nonsense",
    })}`;
    const plan = parsePlan(reply, "renovation costs")!;
    expect(plan.source).toBe("haiku");
    expect(plan.questions[0].default).toBe("a");
    expect(plan.playbook).toBeNull();
    expect(parsePlan("no json", "x")).toBeNull();
    expect(parsePlan(JSON.stringify({ kind: "nope" }), "x")).toBeNull();
    const three = { kind: "compare", questions: [1, 2, 3].map((n) => ({ id: `q${n}`, question: "Which one?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], default: "a" })) };
    expect(parsePlan(JSON.stringify(three), "x")).toBeNull(); // at most two questions
  });
  it("runs the scoping step on Haiku and never throws", async () => {
    expect(route("clarify").model).toBe(HAIKU);
    const ok = await planWithApi("dog vs cat", { messages: { create: async (req: { model: string }) => ({ content: [{ type: "text", text: JSON.stringify({ kind: "compare", model: req.model }) }] }) } } as never);
    expect(ok.source).toBe("haiku");
    const bad = await planWithApi("renovation", { messages: { create: async () => { throw new Error("down"); } } } as never);
    expect(bad.source).toBe("fallback");
    expect(clarifyPrompt("x", "")).toContain("at most 2 multiple-choice questions");
  });
  it("estimates cost from the item count, research model and reused items", () => {
    const opus = estimateCost(10, "opus"), sonnet = estimateCost(10, "sonnet"), reuse = estimateCost(10, "opus", 6);
    expect(sonnet.highSgd).toBeLessThan(opus.lowSgd * 2);
    expect(sonnet.lowSgd).toBeLessThan(opus.lowSgd);
    expect(reuse.highSgd).toBeLessThan(opus.highSgd);
    expect(opus.lowSgd).toBeLessThan(opus.highSgd);
  });
  it("turns the reader's choices into prompt text, with the kind fixed", () => {
    const choice = PlanChoiceSchema.parse({ kind: "estimate", answers: [{ question: "Flat?", answer: "4-room" }], include: ["Painting"], exclude: ["Air-conditioning"], summary: "A 4-room." });
    const text = choiceText(choice);
    expect(text).toContain('kind "estimate"');
    expect(text).toContain("Cover these: Painting.");
    expect(text).toContain("Leave these out: Air-conditioning.");
    const p = buildPrompt({ slug: "x", round: "First build", previous: null }, `topic\n${text}`, "opus", { kind: "estimate", playbook: findPlaybook("renovation") });
    expect(p).toContain('already chose the "estimate" kind');
    expect(p).not.toContain("Pick the calculator kind");
    expect(p).toContain("Playbook for");
    expect(p).toContain("confirmed scope in the request overrides");
    expect(p).toContain("quality check");
  });
});

describe("build prompt additions", () => {
  it("reuses cached prices only on new builds", () => {
    const cache = "Prices already researched in earlier builds.\n- Painting";
    expect(buildPrompt({ slug: "x", round: "First build", previous: null }, "t", "opus", { cache })).toContain(cache);
    const previous = readExample("compare");
    expect(buildPrompt({ slug: previous.id, round: "Refinement 1", previous }, "t", "opus", { cache })).not.toContain("Prices already researched");
  });
  it("lets a refinement skip research, or rebuild as another kind", () => {
    const previous = readExample("compare");
    const state = { slug: previous.id, round: "Refinement 1", previous };
    const cheap = buildPrompt(state, "tidy wording", "opus", { noResearch: true });
    expect(cheap).toContain("Do not use the web or any sub-agent");
    expect(cheap).not.toContain("price-researcher");
    const swap = buildPrompt(state, "as estimate", "opus", { switchTo: "estimate" });
    expect(swap).toContain('as a "estimate" calculator');
    expect(swap).toContain("agent/formats/estimate.md");
  });
  it("reads a requested minimum from the request", () => {
    expect(requestedMinimum("at least 12 providers")).toBe(12);
    expect(requestedMinimum("Minimum of 10 options")).toBe(10);
    expect(requestedMinimum("wedding")).toBeUndefined();
  });
});

describe("quality check", () => {
  const compare = () => clone(readExample("compare"));
  const estimate = () => clone(readExample("estimate"));
  const errors = (s: Spec, minItems?: number) => checkQuality(s, { today, minItems }).filter((i) => i.level === "error").map((i) => `${i.where}: ${i.message}`);

  it("passes the worked examples and the built calculators", () => {
    expect(errors(readExample("compare"))).toEqual([]);
    expect(errors(readExample("estimate"))).toEqual([]);
    const dir = "data/calculators";
    for (const f of fs.readdirSync(dir)) {
      const spec = SpecSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) as Spec;
      const state = { slug: spec.id, round: "x", previous: spec };
      expect(qualityReport(spec, state).errors, f).toEqual([]); // nothing new compared with itself
    }
  });
  it("flags too few options", () => {
    const s = compare();
    expect(errors(s, s.items.length + 1).join()).toContain("needs at least");
  });
  it("flags a price with no source, no date or no rationale", () => {
    const s = compare();
    s.items[0].source = { url: "", verified: "2026-10-01", type: "secondary" };
    s.items[1].source = { url: "https://x.example", verified: "", type: "official" };
    s.items[2].notes = "";
    const e = errors(s).join("\n");
    expect(e).toContain("no source URL");
    expect(e).toContain("no verified date");
    expect(e).toContain("hover rationale");
  });
  it("flags a future date and warns about an old one", () => {
    const s = compare();
    s.items[0].source.verified = "2027-03-01";
    s.items[1].source.verified = "2025-01-01";
    expect(errors(s).join()).toContain("in the future");
    expect(checkQuality(s, { today }).some((i) => i.level === "warning" && i.message.includes("over a year ago"))).toBe(true);
  });
  it("catches maths problems: a zero recurring cost, a zero price, unsorted tiers", () => {
    const c = compare();
    for (const k of Object.keys(c.items[0].costs.default)) if (c.components.find((x) => x.id === k)?.kind === "recurring") c.items[0].costs.default[k] = 0;
    expect(errors(c).join()).toContain("no recurring cost above zero");
    const e = estimate();
    e.lines[0].prices.standard = { low: 0, high: 0 };
    expect(errors(e).join()).toContain("zero price");
    const t = estimate();
    t.lines[1].prices.premium = { low: 1, high: 2 };
    expect(checkQuality(t, { today }).some((i) => i.message.includes("tiers should rise"))).toBe(true);
  });
  it("only blocks problems a refinement adds", () => {
    const before = compare();
    before.items[0].notes = "";
    const same = qualityReport(before, { slug: before.id, round: "r", previous: before });
    expect(same.errors).toEqual([]);
    expect(same.warnings.some((w) => w.message.includes("already in the earlier version"))).toBe(true);
    const after = clone(before);
    after.items[1].notes = "";
    expect(qualityReport(after, { slug: after.id, round: "r", previous: before }).errors).toHaveLength(1);
  });
});

describe("price cache", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")), "cache.json");
  it("harvests one entry per option, line or item, with the source and rationale", () => {
    const e = harvest(readExample("estimate"));
    expect(e).toHaveLength(readExample("estimate").lines.length);
    expect(e[0]).toMatchObject({ currency: "SGD", source: { verified: expect.any(String) } });
    expect(e[0].figure).toContain(" to ");
    expect(harvest(readExample("compare"))[0].figure).toMatch(/\d/);
    expect(harvest(readExample("projection"))[0].figure).toContain("yearly rate");
  });
  it("replaces a calculator's entries on rebuild and keeps others", () => {
    const file = tmp();
    const a = readExample("estimate"), b = clone(a);
    b.id = "other-reno";
    updateCache(a, file);
    updateCache(b, file);
    expect(readCache(file).length).toBe(a.lines.length * 2);
    a.lines = a.lines.slice(0, 3);
    updateCache(a, file);
    expect(readCache(file).filter((x) => x.calc === a.id)).toHaveLength(3);
    expect(readCache(file).filter((x) => x.calc === "other-reno")).toHaveLength(b.lines.length);
    expect(readCache(path.join(os.tmpdir(), "missing-cache.json"))).toEqual([]);
  });
  it("finds similar topics and marks old entries for a recheck", () => {
    const file = tmp();
    const spec = readExample("estimate");
    spec.title = "HDB renovation cost";
    updateCache(spec, file);
    const entries = readCache(file);
    const hits = findSimilar("renovation flooring in an HDB flat", entries, { today });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.name).toMatch(/floor/i);
    expect(findSimilar("japan trip", entries, { today })).toEqual([]);
    expect(countCached(["Flooring"], entries, today)).toBeGreaterThanOrEqual(0);
    const prompt = cachePrompt("hdb renovation flooring", entries, today);
    expect(prompt).toContain("reuse its figure");
    expect(prompt).not.toContain("(OLD: recheck)");
    expect(cachePrompt("hdb renovation flooring", entries, new Date("2028-01-01"))).toContain("(OLD: recheck)");
    expect(cachePrompt("japan trip", entries, today)).toBe("");
  });
});

describe("sample prompt", () => {
  it("fits the topic limit and names what, where, size, who to compare and a forecast", () => {
    const src = fs.readFileSync("app/plan-builder.tsx", "utf8");
    const sample = /const EXAMPLE_TOPIC = "([^"]+)"/.exec(src)![1];
    expect(sample.length).toBeLessThanOrEqual(200);
    expect(sample).toMatch(/Singapore/);
    expect(sample).toMatch(/sqm/);
    expect(sample).toMatch(/compare at least 10 design firms and 10 contractors/);
    expect(sample).toMatch(/predict future prices.*past 3 years/);
  });
});

describe("pages and runs", () => {
  it("add the suggest-a-change chat to every kind of page", () => {
    for (const kind of ["compare", "estimate", "projection"] as const) {
      const html = renderCalculatorHtml(readExample(kind));
      expect(html).toContain('id="refine-root"');
      expect(html).toContain("Suggest a change");
      expect(html).toContain(`"kind":"${kind}"`);
      expect(html).not.toContain("__REFINE_CONFIG__");
    }
  });
  it("shows scoping runs in the progress panel", () => {
    const run = { id: 1, path: ".github/workflows/plan-calculator.yml", display_title: "Plan: renovation", status: "in_progress", conclusion: null, created_at: "2026-10-28T00:00:00Z", html_url: "u" };
    expect(describeRun(run, { steps: [{ name: "Scope the topic with Claude Code (Haiku)", status: "in_progress", conclusion: null }] })).toMatchObject({ kind: "plan", title: "renovation", step: "Scoping the topic" });
  });
});
