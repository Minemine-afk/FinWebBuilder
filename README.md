# FinWebBuilder

Cost-comparison calculators that build themselves. Type a topic, and a research agent searches the web for current Singapore prices and publishes a new calculator page. Follow-up prompts refine an existing calculator.

## How it works

1. The **Build or refine** box on the home page sends the request (with a passcode) to `app/api/build`, which starts the `Build calculator` GitHub Actions workflow.
2. The workflow runs `agent/run.ts`, which calls the Claude API:
   - **Opus 5.5** plans the calculator's structure and checks the finished numbers.
   - **Sonnet 5.5** searches the web, reads pages and extracts prices.
   - An option that is hard to price, or a price Sonnet can't confirm, is researched again on Opus.
   - A follow-up prompt is triaged by Sonnet. A simple edit stays on Sonnet; an open-ended change is planned and checked by Opus.
   The routing lives in `agent/models.ts`.
3. The result is saved as `data/calculators/<slug>.json`. A new calculator is committed to `main` and goes live on the next deploy. A refinement opens a pull request: merge it to publish, close it to discard. Older versions are kept in `data/history/<slug>/`.
4. Every page shows **How this page was built**: each API call with its model, tokens, web searches and estimated cost in SGD, with a subtotal for each round and a running total. Prices are in `lib/pricing.ts`.

Pages are served from `app/c/[slug]/route.ts`, which fills `templates/calculator.html` (the calculator engine from the FinexisEdu builder prototype) with the spec.

## Setup

**GitHub (Settings → Secrets and variables → Actions)**

- Secret `ANTHROPIC_API_KEY`: an API key from the Claude Console. The agent can't use a Claude chat subscription.
- Optional variable `MAX_SPEND_SGD`: stops a run once its estimated cost passes this (default 25).
- Settings → Actions → General → Workflow permissions: allow GitHub Actions to create pull requests.

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
