import { listCalculators, readCalculator } from "@/lib/data";
import { renderCalculatorHtml } from "@/lib/render";

// Every calculator is rendered at build time; a new one appears after the next deploy.
export const dynamicParams = false;

export async function generateStaticParams() {
  return listCalculators().map((s) => ({ slug: s.id }));
}

export async function GET(_request: Request, { params }: RouteContext<"/c/[slug]">) {
  const { slug } = await params;
  const spec = readCalculator(slug);
  if (!spec) return new Response("Not found", { status: 404 });
  return new Response(renderCalculatorHtml(spec), { headers: { "content-type": "text/html; charset=utf-8" } });
}
