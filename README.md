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

## Working from vague prompts

A short topic like "renovation costs" is turned into a good calculator in these steps (each is cheap, and none changes what a precise prompt does):

1. **Scope first.** *Scope it first* on the home page runs a Haiku step (`agent/plan.ts`, workflow `Plan calculator`, or one direct API call when the site has `ANTHROPIC_API_KEY`). It reads the topic, picks the calculator kind, and either proposes a scope or asks at most two multiple-choice questions. The plan is saved to the `builder-plans` branch (one small file each, so no site deploy) and the page polls for it. If the step fails, a built-in fallback plan from the topic's playbook is used. *Build straight away* skips all of this.
2. **Kind shown, with a switch.** The plan names the suggested kind (comparison, cost estimate or projection) and why; the reader can change it before building. A published page shows its kind in the *Suggest a change* panel, which can rebuild it as another kind and keeps the prices.
3. **Scope preview with cost.** The reader ticks or unticks the options to research, adds their own, picks research depth (Opus careful, Sonnet about half the cost) and sees an estimated cost range before the expensive run starts. Items already in the price cache are marked and cost less. The confirmed scope goes to the build as the workflow's `plan` input.
4. **Playbooks** (`agent/playbooks.ts`): property, renovation, travel, cars and education. Each has a checklist, official sources to try first, things to watch for and a minimum item count, and is added to the build prompt when the topic matches.
5. **Quality check** (`lib/quality.ts`): `validate` now also checks option counts, a source URL and verified date on every price, a hover rationale on every figure and the maths (zero prices, tiers that fall, rates outside their limits, outliers). Claude must fix every error before it finishes, and `record` runs the check again, so a failing build is not published. On a refinement only problems the edit added are errors.
6. **Chat refinement.** Every page has a *Suggest a change* panel. It sends the request to the refine path, which runs on Sonnet (about S$0.20), with an optional *no new research* box that blocks web access, and shows the run's progress.
7. **Price cache** (`lib/price-cache.ts`, `data/price-cache.json`): every build saves each option's, line's or item's figure, source and date. A new build gets the entries most like its topic and reuses those verified in the last 180 days instead of researching them again. Rebuild it with `npx tsx agent/subscription.ts rebuild-cache`. Figures the official data tools regenerate for free are not cached.

## Calculator kinds

Each calculator JSON has a `kind`, and the builder picks one per topic (files with no `kind` are comparisons):

- **compare** (`templates/calculator.html`): options side by side over a period. Shows a break-even headline, a running-total table, limited inputs (years to compare, own rate) and optional *drivers* such as km a year, which scale the cost components that depend on them.
- **estimate** (`templates/estimate.html`): what a project costs, line by line, with a low to high range, finish levels, size and quantity inputs, optional lines and a contingency buffer. Optional *presets* (kinds of job that switch lines on) and *providers* (who does the work: each has a price level and at least three years of its own prices, and the page grows its prices at that yearly rate for a future year). Example: HDB renovation cost.
- **projection** (`templates/projection.html`): a value over time at low, base, high or your own yearly rate, with optional monthly deposits, a goal and a today's-money view. Long lists can be narrowed by up to three *filters* (e.g. location and property type), items can show their past prices, and `baseRateFrom: "history"` makes every base rate the compound yearly change across the item's own history. Example: Singapore property value.

Schemas are in `lib/spec.ts`; the format notes the agent reads are in `agent/formats/`, with a worked example per kind in `agent/examples/` (kept out of `data/` so removing a calculator never removes them). Any figure can carry a `rationale`, shown on the page as hover text.

**Official data tools** (`agent/datasets.ts`, which the build is allowed to run): `hdb-resale` adds every HDB town and flat type from HDB's resale transactions on data.gov.sg; `private-index` prints URA's private price indices from SingStat; `private-items` adds researched private-property prices whose past values and rates follow those indices. A build can also ask for Opus price research with the workflow's `research_model` input. The page maths lives in `templates/*-engine.js` and `templates/common.js`, which the tests run directly. Health, tax and converter calculators are not built yet.

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
