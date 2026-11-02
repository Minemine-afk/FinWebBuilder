# FinWebBuilder user guide

FinWebBuilder turns a topic you type ("owning an e-bike in Singapore") into a finished calculator web page. An AI agent researches current Singapore prices, cites its sources, and publishes the page. All costs are shown in SGD. You do not need to use Claude yourself or write any code.

## 1. The quick tour

1. Open the site's home page (**Finexis calculators**). Existing calculators are listed there.
2. In **Build or refine a calculator**, enter the **Passcode**, then type a topic in **New calculator**.
3. Choose **Scope it first** (recommended) or **Build straight away**.
4. Wait a few minutes. The **Build in progress** panel shows a loading bar and the current step.
5. When the build finishes, the new calculator appears on the home page and is live at `/c/<slug>`. Open it and use it.

A build takes roughly 4 to 6 minutes. At API prices a build costs about S$1.30 to S$3 on Sonnet-style research and has reached about S$8 to S$12 for very large topics. When the builder runs on a Claude subscription it counts against the plan's usage instead of being billed. Each page shows its own exact cost (see section 7).

## 2. Writing a good prompt

A specific topic needs less fixing afterwards. Say:

- what it is, and where (Singapore is assumed);
- the size or quality ("90 sqm resale 4-room HDB, mid-range");
- who or what to compare, and how many ("at least 10 design firms and 10 contractors");
- whether you want a forecast ("predict future prices").

Example: *What a mid-range renovation of a 90 sqm resale 4-room HDB flat costs: compare at least 10 design firms and 10 contractors, and predict future prices from the last 3 years.*

### Vague prompts are fine

A short topic like "renovation costs" works because of **Scope it first**:

1. A cheap, fast step reads your topic, picks the calculator kind, and either proposes a scope or asks at most two multiple-choice questions. A quick draft scope from a built-in checklist appears at once; the smarter scope replaces it (you can switch) when it arrives. If the scoping step fails, the draft is used.
2. You see the suggested **kind** and why it was chosen, and can change it.
3. You tick or untick the options to research, add your own ("Add your own"), pick the research depth, and see an **estimated cost range** before any expensive work starts. Items marked *already priced* are reused from the price cache and cost less.
4. Press **Build the chosen items**.

**Build straight away** skips all of this and lets the agent choose.

**Research depth:** *Careful* (Opus researches, the default) or *Quick* (Sonnet researches, about half the cost).

Built-in checklists ("playbooks") exist for property, renovation, travel, cars and education topics. They add the official sources to try first, things to watch for and a minimum number of items.

## 3. The three calculator kinds

| Kind | Use it to answer | What the page offers |
|---|---|---|
| **Compare** | "Which option is cheaper over time?" (EV vs petrol, RTS Link vs bus vs car) | Options side by side, a break-even headline, a running-total table, inputs for years to compare and your own rate, optional drivers such as km per year |
| **Estimate** | "What will this project cost?" (HDB renovation, having a baby) | Line-by-line costs with a low to high range, finish levels, size and quantity inputs, optional lines, a contingency buffer. Optional presets (kinds of job) and providers (who does the work, each with a price level and its own price history, grown at a yearly rate for a future year) |
| **Projection** | "What will this be worth later?" (property value, savings) | Value over time at low, base, high or your own yearly rate, optional monthly deposits, a goal, a today's-money view, an "All options" ranking, filters (e.g. location and property type) and past prices |

The builder picks the kind for you. You can change it at scoping time, or later with *Suggest a change* (section 5), which rebuilds the page as another kind and keeps the prices.

Not built yet: health scores, tax calculators and unit converters.

## 4. Where the numbers come from

- **Web research.** The agent searches and reads pages. Every price carries a source URL and a verified date. Every figure can carry a hover-text **rationale** explaining the assumption; hover over figures to read it.
- **Official data tools** (no keys needed): HDB resale transactions from data.gov.sg (about 244,000 sales since January 2017, every town and flat type), and URA private property price indices from SingStat. Private per-town prices come from secondary sources researched by the agent and follow those indices.
- **Future prices.** By default, a future price compounds the yearly rate over the item's previous 3 years (the history-based rate). Providers and projection items use their own history.
- **Price cache.** Every build saves each figure with its source and date. A later build reuses figures verified in the last 180 days instead of researching them again.
- **Quality check.** Before publishing, the build checks option counts, a source and date on every price, a rationale on every figure, and the maths (zero prices, tiers that fall, rates out of range, outliers). A build that fails the check is not published.

## 5. Changing a calculator (Refine)

Two ways:

- **On the calculator page:** the *Suggest a change* panel. Type the change ("Add a hybrid car", "recheck the BYD Atto 1 price"). Tick *no new research* to edit without any web access. A refinement runs on Sonnet and costs about S$0.20 (a first build was about S$1.36).
- **On the home page:** *Refine a calculator*. Choose the calculator, describe the change, press **Refine it**.

The change goes live automatically. The previous version is kept (see section 8). Edits are checked so that only problems the edit introduced count as errors.

## 6. Removing a calculator

On the home page, *Remove a calculator*: choose it from the list, press **Remove it**. The page and its saved versions are deleted from the site. Git history still holds the old files if you need one back.

## 7. Reading "How this page was built"

Every page ends with the build log: each AI call with its model, tokens, web searches and estimated cost in SGD, a subtotal per round and a running total. Pages built after 2026-10-28 also show the cost reported by Claude Code. Hand-built seed calculators say the AI cost was not metered.

## 8. Standalone pages and versions

- **Live pages** are served at `/c/<slug>` from the calculator's data file (`data/calculators/<slug>.json`) and the template for its kind.
- **Saved versions** of refined calculators are in `data/history/<slug>/` (v1, v2, ...). To roll back, restore a version's JSON over the current file.
- **Exporting a single page.** The project folder also holds earlier hand-made prototypes (`calculators/site/*.html`, `calculator-template/standalone/university-fees.html`). These are self-contained HTML files you can open from disk or upload to any web host. For current calculators the simplest export is to open the live page in the browser and use Save Page As, or fetch `/c/<slug>`.

## 9. Linking a Claude subscription (or a new account) to the builder

The builder does not log in to Claude through the website. The research runs inside GitHub (the repository's *Actions*), and GitHub needs a secret code that proves whose Claude account to use. There are two choices. Pick **one**.

| | A. Claude subscription (recommended) | B. API key |
|---|---|---|
| Secret name in GitHub | `CLAUDE_CODE_OAUTH_TOKEN` | `ANTHROPIC_API_KEY` |
| Who pays | Your Claude Pro or Max plan; builds use up plan allowance, no extra bill | Pay per use from the Claude Console balance |
| Spending cap | Your plan's usage limits | `MAX_SPEND_SGD` variable (default 25 per run) |

**Important:** if both secrets exist, the API key wins and the subscription is ignored. Delete the API key if you want builds to use the subscription.

### A. Link a Claude subscription

You need: a Claude **Pro or Max** plan, admin rights on the GitHub repository (the "Settings" tab is visible), and one computer with Claude Code installed for about two minutes. It is only used to print the code; it does not need to stay installed, and the builder never runs on it.

1. On a computer, install and open **Claude Code** (instructions at code.claude.com; a terminal window is needed once).
2. In the terminal, type `claude setup-token` and press Enter.
3. A browser page opens. **Sign in with the Claude account whose plan you want to use** and approve access. Check the account name shown: this is the account that will pay for every build.
4. Back in the terminal a long code appears (it starts with `sk-ant-oat`). Copy all of it. Treat it like a password: don't paste it into chats, emails or the repository. It is shown only once.
5. Open the repository on GitHub: **Settings > Secrets and variables > Actions > New repository secret**.
6. Name: `CLAUDE_CODE_OAUTH_TOKEN` (exactly, capital letters). Secret: paste the code. Press **Add secret**.
7. Confirm there is **no** `ANTHROPIC_API_KEY` secret in the same list. If there is, delete it, or builds will use that instead.

If you cannot install Claude Code on your own computer, ask someone you trust to do steps 1 to 4 on theirs, signing in as *your* account, and send you the code through a private channel. Never post it in a group chat.

### B. Link an API key instead

1. Go to console.anthropic.com, sign in and add credit under **Billing**.
2. Open **API keys > Create key**, name it "FinWebBuilder", and copy the key (starts with `sk-ant-`). It is shown only once.
3. In GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Name `ANTHROPIC_API_KEY`, paste the key, **Add secret**.
4. Optional: under the **Variables** tab add `MAX_SPEND_SGD` (for example `10`) to cap one run.
5. Optional: add the same `ANTHROPIC_API_KEY` in Vercel (**Project > Settings > Environment Variables**). Then the "Scope it first" step can call the cheap scoping model directly. Without it, scoping runs through GitHub using the subscription token.

### Check that it works

1. On the site, enter the passcode and build something small, for example "Shampoo prices in Singapore", with **Build straight away**.
2. In GitHub, open the **Actions** tab and click the newest **Build calculator** run. A green tick after a few minutes means success, and the calculator appears on the home page.
3. To see which path ran, open the run: *Run the research agent (API)* means the API key was used; *Research with Claude Code (subscription)* means the subscription was used. Steps for the path not used are greyed out.
4. A page's *How this page was built* section shows the models used and the cost.

### Switching to a different Claude account later

1. Repeat steps 2 to 4 of section A while signed in to the **new** account. (If the browser keeps logging you in as the old account, sign out of claude.ai first or use a private window.)
2. In GitHub, open the existing secret `CLAUDE_CODE_OAUTH_TOKEN` in **Settings > Secrets and variables > Actions**, press the pencil/**Update** button, paste the new code and save. The old account is no longer used from the next build.
3. Revoke the old code if you no longer want it to work: sign in to the old account on claude.ai, and in its settings remove the Claude Code connection or app access.
4. Run a small test build as above. Builds already running keep using the old account until they finish.

To switch from a subscription to an API key (or back): add the new secret, and delete the other one so the right one is used.

### Common errors

| What you see | Likely cause and fix |
|---|---|
| Run fails immediately with "Add the ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN repository secret first" | Neither secret exists, or the name has a typo. Re-add it with the exact name |
| Authentication, "invalid token" or 401 errors in the *Research with Claude Code* step | The code was copied incompletely, has spaces, or was revoked. Create a new one (section A) and update the secret |
| Rate limit, usage limit or "plan limit reached" message | The subscription's allowance is used up. Wait for it to reset, switch to another account, or use an API key |
| "Credit balance is too low" (API key) | Add credit in the Claude Console |
| Builds seem to use the wrong account or get billed | An `ANTHROPIC_API_KEY` secret exists and overrides the subscription. Delete it |
| Buttons on the site say something went wrong before any run starts | Not a Claude problem: check `BUILDER_PASSCODE`, `GITHUB_TOKEN` and `GITHUB_REPOSITORY` in Vercel (section 10) |
| Everything is set but a run still fails after a long time | Open the failed step and read the last printed message, then see the troubleshooting table in section 11 |

Security notes: the token can run Claude as your account, so only people who know the builder passcode should be able to start builds, and secrets in GitHub cannot be read back, only replaced.

## 10. Hosting and workflow setup (one time)

**GitHub:** the Claude credential is covered in section 9.

**Vercel, Project > Settings > Environment Variables:** `BUILDER_PASSCODE` (the passcode for the build box), `GITHUB_TOKEN` (fine-grained token for this repo only, Actions read and write), `GITHUB_REPOSITORY` (`Minemine-afk/FinWebBuilder`). Vercel's free Hobby plan does not allow commercial use.

Builds and removals publish straight to `main` with no approval step, so keep the passcode private.

You can also start builds by hand from the repository's **Actions** tab (*Build calculator*, *Remove calculator*). Build inputs: `topic` (new) or `slug` plus `prompt` (refine), `kind`, `no_research`, `research_model` (opus or sonnet). Only one build runs at a time; extra requests queue, and only one pending run is kept.

## 11. Troubleshooting

| Symptom | What to do |
|---|---|
| "Couldn't reach the server" or an error message after pressing a button | Check the passcode, and that the Vercel variables above are set |
| Nothing happens, no progress panel | The GitHub token may lack Actions read/write, or a build is already queued; check the Actions tab |
| Run fails with "wrote no file" | Open the run's *Record the subscription run* step and read Claude's printed final message. Re-run the build |
| Build fails the quality check | Usually too few options or a figure without a source. Re-run with a more specific prompt, or choose more items at scoping |
| Result is off-topic or too generic | Use **Scope it first** and tighten the scope, or refine with a precise request |
| Page didn't change after a build | The site redeploys when the build commits to `main`; wait a minute and reload |
| A price looks wrong | Hover the figure for its rationale and source, then use *Suggest a change* ("recheck the X price") |
| Cost looks high | Choose *Quick* research depth, reduce the item count, or rely on cached items |
| Two builds at once | They run one after another, by design |

## 12. Commands (for developers)

```bash
npm run dev          # local site
npm test             # unit tests, no API calls
npm run typecheck
npm run agent -- --topic "Owning an e-bike in Singapore"        # needs ANTHROPIC_API_KEY
npm run agent -- --slug ev-vs-petrol-car --prompt "Add a hybrid car"
npx tsx agent/subscription.ts rebuild-cache                      # rebuild the price cache
```

Where things live: kind formats the agent reads in `agent/formats/`, worked examples in `agent/examples/`, schemas in `lib/spec.ts`, page maths in `templates/*-engine.js`, playbooks in `agent/playbooks.ts`, official data tools in `agent/datasets.ts`.
