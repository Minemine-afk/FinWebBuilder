# FinWebBuilder

Cost-comparison calculators that build themselves. Type a topic, and a research agent searches the web for current Singapore prices and publishes a new calculator page. Follow-up prompts refine an existing calculator.

## How it works

1. The **Build or refine** box on the home page sends the request (with a passcode) to `app/api/build`, which starts the `Build calculator` GitHub Actions workflow.
2. The workflow runs `agent/run.ts`, which calls the Claude API (or, on a Claude subscription, Claude Code with the same plan-research-check steps, see Setup):
   - **Opus 5.5** plans the calculator's structure and checks the finished numbers.
   - **Sonnet 5.5** searches the web, reads pages and extracts prices.
   - An option that is hard to price, or a price Sonnet can't confirm, is researched again on Opus.
   - A follow-up prompt is triaged by Sonnet. A simple edit stays on Sonnet; an open-ended change is planned and checked by Opus.
   The routing lives in `agent/models.ts`.
3. The result is saved as `data/calculators/<slug>.json`. A new calculator or a refinement is committed straight to `main` and goes live when the site redeploys, with no approval step. Older versions are kept in `data/history/<slug>/`. The **Remove a calculator** box dispatches `Remove calculator`, which deletes the calculator and its saved versions from `main` (git history still has them). The home page's **Build in progress** panel shows the loading bar and current step of any build or removal running right now (through `app/api/builds`), and disappears when none is.
4. Every page shows **How this page was built**: each API call with its model, tokens, web searches and estimated cost in SGD, with a subtotal for each round and a running total. Prices are in `lib/pricing.ts`.

## Calculator kinds

Each calculator JSON has a `kind`, and the builder picks one per topic (files with no `kind` are comparisons):

- **compare** (`templates/calculator.html`): options side by side over a period. Shows a break-even headline, a running-total table, limited inputs (years to compare, own rate) and optional *drivers* such as km a year, which scale the cost components that depend on them.
- **estimate** (`templates/estimate.html`): what a project costs, line by line, with a low to high range, finish levels, size and quantity inputs, optional lines and a contingency buffer. Example: HDB renovation.
- **projection** (`templates/projection.html`): a value over time at low, base, high or your own yearly rate, with optional monthly deposits, a goal and a today's-money view. Examples: saving for a goal, future HDB price.

Schemas are in `lib/spec.ts`; the format notes the agent reads are in `agent/formats/`. The page maths lives in `templates/*-engine.js` and `templates/common.js`, which the tests run directly. Health, tax and converter calculators are not built yet.

The Claude Code (subscription) path chooses the kind. The API-key agent in `agent/pipeline.ts` still builds comparisons only.

Pages are served from `app/c/[slug]/route.ts`, which fills the kind's template (the compare engine comes from the FinexisEdu builder prototype) with the spec.

## Setup

**GitHub (Settings → Secrets and variables → Actions)**: add one of these secrets.

- `CLAUDE_CODE_OAUTH_TOKEN`, to run on a Claude Pro or Max subscription: run `claude setup-token` in Claude Code on your computer and save the token it prints. Each build then runs Claude Code through the [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions): Opus leads, and the `price-researcher` sub-agent (`.claude/agents/`) does the reading on Sonnet. Runs count against your plan's usage limits rather than being billed, and the page's cost section shows what the run would have cost on the API. The token is tied to your account, so keep the builder passcode-protected.
- `ANTHROPIC_API_KEY`, to pay per use: an API key from the Claude Console. This runs the API agent in `agent/` with per-step Sonnet/Opus routing and a spending cap (optional variable `MAX_SPEND_SGD`, default 25). When both secrets are set, the API key is used.

**Hosting (Vercel → Project → Settings → Environment Variables)**

- `BUILDER_PASSCODE`: the passcode for the build box.
- `GITHUB_TOKEN`: a fine-grained token for this repository only, with **Actions: Read and write**.
- `GITHUB_REPOSITORY`: `Minemine-afk/FinWebBuilder`.

Vercel's free Hobby plan doesn't allow commercial use, so a Finexis site needs Pro.

## Commands

```bash
npm run dev          # local site
npm test             # unit tests (no API calls)
npm run typecheck
npm run agent -- --topic "Owning an e-bike in Singapore"           # needs ANTHROPIC_API_KEY
npm run agent -- --slug ev-vs-petrol-car --prompt "Add a hybrid car"
```

The three starting calculators (dog vs cat, electric vs petrol car, Japan trip) were researched by hand, so their build-cost section says the AI cost wasn't metered.
