import { listCalculators } from "@/lib/data";
import { describeSpec } from "@/lib/spec";
import { formatSgd, summariseBuildLog } from "@/lib/pricing";
import { BuilderForms } from "./builder-forms";
import { BuildProgress } from "./build-progress";

export default function Home() {
  const calculators = listCalculators();
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-semibold">Finexis calculators</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Compare what real choices cost over time. Every price is in Singapore dollars, cites its source and rises with its own price trend.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Calculators">
        {calculators.map((c) => {
          const { totalSgd } = summariseBuildLog(c.buildLog);
          return (
            <a key={c.id} href={`/c/${c.id}`} className="block rounded-xl border border-border bg-surface p-5 hover:border-accent">
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted">{c.scope}</p>
              <p className="mt-3 text-xs text-accent">
                {describeSpec(c)} · version {c.version} · {c.buildLog.length ? `AI cost ${formatSgd(totalSgd)}` : "built by hand"}
              </p>
            </a>
          );
        })}
      </section>

      <BuildProgress />

      <BuilderForms calculators={calculators.map((c) => ({ id: c.id, title: c.title }))} />
    </main>
  );
}
