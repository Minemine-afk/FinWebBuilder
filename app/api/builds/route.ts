import { githubConfig, recentRuns } from "@/lib/github";

/** What the builder is doing now and has done lately, for the progress panel. Shows only run titles and steps. */
export async function GET() {
  const cfg = githubConfig();
  if (!cfg) return Response.json({ runs: [] });
  return Response.json({ runs: await recentRuns(cfg) }, { headers: { "cache-control": "no-store" } });
}
