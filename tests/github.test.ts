import { describe, expect, it } from "vitest";
import { describeRun } from "@/lib/github";

const run = (over: Partial<Parameters<typeof describeRun>[0]>) => ({
  id: 1,
  name: "Build calculator",
  display_title: "Build: Owning an e-bike",
  status: "in_progress",
  conclusion: null,
  created_at: "2026-10-26T05:00:00Z",
  html_url: "https://github.com/o/r/actions/runs/1",
  ...over,
});
const step = (name: string, status: string) => ({ name, status, conclusion: status === "completed" ? "success" : null });

describe("describeRun", () => {
  it("names the topic and the step being worked on", () => {
    const r = describeRun(run({}), { steps: [step("Run npm ci", "completed"), step("Research with Claude Code (subscription)", "in_progress"), step("Publish", "pending")] });
    expect(r).toMatchObject({ kind: "build", title: "Owning an e-bike", state: "running", step: "Researching prices on the web" });
    expect(r.progress).toBeGreaterThan(0);
    expect(r.progress).toBeLessThan(1);
  });
  it("tells refinements and removals apart", () => {
    expect(describeRun(run({ display_title: "Refine: dog-vs-cat" }), undefined).kind).toBe("refine");
    expect(describeRun(run({ display_title: "Remove: dog-vs-cat", status: "completed", conclusion: "success" }), undefined)).toMatchObject({ kind: "remove", state: "done", progress: 1 });
  });
  it("reports failures and queued runs", () => {
    expect(describeRun(run({ status: "completed", conclusion: "failure" }), undefined)).toMatchObject({ state: "failed", step: "The build failed. Nothing was published." });
    expect(describeRun(run({ status: "queued" }), undefined)).toMatchObject({ state: "queued", step: "Waiting to start" });
  });
});
