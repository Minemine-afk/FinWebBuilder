import { githubConfig, activeRuns } from "@/lib/github";

/** The builds running now, for the progress panel. Shows only each run's title and current step. */
export async function GET() {
  const cfg = githubConfig();
  if (!cfg) return Response.json({ runs: [] });
  return Response.json({ runs: await activeRuns(cfg) }, { headers: { "cache-control": "no-store" } });
}
