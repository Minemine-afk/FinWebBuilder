import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { callCostSgd } from "@/lib/pricing";
import type { BuildLogEntry } from "@/lib/spec";
import { route, type RouteContext, type Step } from "./models";

/** Server-side retry on another model if a request is declined; routes by refusal category. */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export class BudgetExceededError extends Error {}

/**
 * Wraps the Claude API for one build or refinement round: picks the model for each step,
 * records the usage of every call in the build log, and stops once the round's budget is spent.
 */
export class Agent {
  readonly log: BuildLogEntry[] = [];
  private client: Anthropic;

  constructor(
    readonly round: string,
    readonly budgetSgd: number,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  get spentSgd() {
    return this.log.reduce((sum, e) => sum + callCostSgd(e), 0);
  }

  private record(label: string, msg: BetaMessage) {
    const u = msg.usage;
    this.log.push({
      round: this.round,
      label,
      model: msg.model,
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      searches: u.server_tool_use?.web_search_requests ?? 0,
      fetches: u.server_tool_use?.web_fetch_requests ?? 0,
      at: new Date().toISOString(),
    });
    if (msg.stop_reason === "refusal") throw new Error(`The model declined step "${label}".`);
    if (this.spentSgd > this.budgetSgd) {
      throw new BudgetExceededError(`Stopped after "${label}": spent S$${this.spentSgd.toFixed(2)} of the S$${this.budgetSgd} budget.`);
    }
  }

  /** One call that must return JSON matching `schema`. */
  async structured<S extends z.ZodType>(
    step: Step,
    ctx: RouteContext,
    label: string,
    system: string,
    user: string,
    schema: S,
  ): Promise<z.infer<S>> {
    const r = route(step, ctx);
    const stream = this.client.beta.messages.stream({
      ...FALLBACK,
      model: r.model,
      max_tokens: 32000,
      output_config: { effort: r.effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const msg = await stream.finalMessage();
    this.record(label, msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (msg.stop_reason === "max_tokens") throw new Error(`Step "${label}" ran out of output tokens.`);
    return schema.parse(JSON.parse(text));
  }

  /** A research call with web search and web fetch. Returns the model's written notes. */
  async research(ctx: RouteContext, label: string, system: string, user: string, maxSearches = 8): Promise<string> {
    const r = route("research", ctx);
    const messages: BetaMessageParam[] = [{ role: "user", content: user }];
    let notes = "";
    // A long server-tool turn can pause; send it back to let the model carry on.
    for (let turn = 0; turn < 4; turn++) {
      const stream = this.client.beta.messages.stream({
        ...FALLBACK,
        model: r.model,
        max_tokens: 32000,
        output_config: { effort: r.effort },
        cache_control: { type: "ephemeral" },
        system,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: maxSearches },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearches },
        ],
        messages,
      });
      const msg = await stream.finalMessage();
      this.record(turn ? `${label} (continued)` : label, msg);
      notes += msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
    return notes.trim();
  }
}
