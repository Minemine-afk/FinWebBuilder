import { z } from "zod";
import { dispatchWorkflow, githubConfig, passcodeOk } from "@/lib/github";

/** Removes a calculator: dispatches the remove-calculator GitHub Actions workflow, which deletes its data from main. */
const Body = z.object({ passcode: z.string(), slug: z.string().regex(/^[a-z0-9-]{1,48}$/) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a calculator to remove." }, { status: 400 });
  if (!passcodeOk(parsed.data.passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });

  const cfg = githubConfig();
  if (!cfg) return Response.json({ error: "The builder isn't connected to GitHub yet." }, { status: 503 });

  const status = await dispatchWorkflow(cfg, "remove-calculator.yml", { slug: parsed.data.slug });
  if (status !== 204) return Response.json({ error: `GitHub refused the request (${status}).` }, { status: 502 });
  return Response.json({ ok: true });
}
