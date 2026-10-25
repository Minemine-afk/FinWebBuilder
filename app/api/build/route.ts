import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Starts the research agent: dispatches the build-calculator GitHub Actions workflow.
 * Needs BUILDER_PASSCODE, GITHUB_TOKEN (fine-grained, Actions: write on this repo) and
 * GITHUB_REPOSITORY (owner/repo) in the hosting environment.
 */
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new"), passcode: z.string(), topic: z.string().trim().min(3).max(200) }),
  z.object({
    mode: z.literal("refine"),
    passcode: z.string(),
    slug: z.string().regex(/^[a-z0-9-]{1,48}$/),
    prompt: z.string().trim().min(3).max(500),
  }),
]);

function passcodeOk(given: string) {
  const expected = process.env.BUILDER_PASSCODE;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the form and try again." }, { status: 400 });
  const body = parsed.data;
  if (!passcodeOk(body.passcode)) return Response.json({ error: "Wrong passcode." }, { status: 401 });

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return Response.json({ error: "The builder isn't connected to GitHub yet." }, { status: 503 });

  const inputs = body.mode === "new" ? { topic: body.topic } : { slug: body.slug, prompt: body.prompt };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/build-calculator.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: process.env.GITHUB_BRANCH ?? "main", inputs }),
  });
  if (!res.ok) return Response.json({ error: `GitHub refused the request (${res.status}).` }, { status: 502 });
  return Response.json({ ok: true, runsUrl: `https://github.com/${repo}/actions/workflows/build-calculator.yml` });
}
