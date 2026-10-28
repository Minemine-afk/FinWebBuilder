/**
 * Which model runs each step. Sonnet does the bulk reading and extraction at about
 * half Opus's price; Opus does the judgement calls. Change the routing here.
 */
export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-5-5";

export type Step =
  | "plan" // decide the calculator's structure and what to research
  | "research" // web search and page reading for some items
  | "extract" // turn research notes into structured prices
  | "verify" // check the finished numbers against each other and the sources
  | "classify" // decide whether a follow-up prompt is simple or open-ended
  | "clarify" // read a vague topic and propose a scope or ask up to two questions
  | "patch"; // apply a follow-up prompt to an existing calculator

export interface Route {
  model: typeof OPUS | typeof SONNET | typeof HAIKU;
  effort: "low" | "medium" | "high";
}

export interface RouteContext {
  /** A step being retried because the cheaper model's result failed its check. */
  escalated?: boolean;
  /** A follow-up prompt the classifier judged open-ended rather than a simple edit. */
  openEnded?: boolean;
  /** The planner marked this item as hard to price (niche, future, or conflicting sources). */
  hardItem?: boolean;
}

export function route(step: Step, ctx: RouteContext = {}): Route {
  switch (step) {
    case "plan":
    case "verify":
      return { model: OPUS, effort: "high" };
    case "patch":
      return ctx.openEnded ? { model: OPUS, effort: "high" } : { model: SONNET, effort: "medium" };
    case "research":
      return ctx.escalated || ctx.hardItem ? { model: OPUS, effort: "high" } : { model: SONNET, effort: "medium" };
    case "extract":
      return ctx.escalated ? { model: OPUS, effort: "medium" } : { model: SONNET, effort: "low" };
    case "classify":
      return { model: SONNET, effort: "low" };
    case "clarify":
      return { model: HAIKU, effort: "low" };
  }
}
