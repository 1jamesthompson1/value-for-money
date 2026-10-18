# OpenCode Go — value map

A single static page that plots **included monthly usage** for every OpenCode Go model
against its **Artificial Analysis Intelligence Index**, and highlights the Pareto front:
the models that are not beaten on both usage and intelligence.

- Live site: https://james.sjhl.nz/value-for-money/
- Data is refreshed **daily** at 05:17 UTC by a GitHub Action.
- No framework, no build step, no runtime dependencies.

![scatter plot](https://raw.githubusercontent.com/1jamesthompson1/value-for-money/main/.github/preview.png)

## How it works

`scripts/scrape.mjs` pulls monthly usage limits and token prices from the OpenCode Go
docs and intelligence scores from Artificial Analysis, then writes
`public/data/latest.json` plus a daily snapshot under `public/data/history/`.
GitHub Actions deploys `public/` to GitHub Pages.

The page loads that JSON and draws the chart as hand-written SVG. Usage can be shown
as estimated **requests / month** or **included $ / month** (both "higher is better"),
and the Pareto front is recomputed in the browser whenever you switch.

The two sources disagree on a few names and list some models more than once; those
rows are reconciled in `scripts/scrape.mjs` (`AA_ALIASES` and friends). Models AA has
retired from its leaderboard are still scored from their AA model page. Anything with
no intelligence score anywhere is excluded, listed at the bottom of the page, and
recorded in the snapshot's `unmatched` array.

This is an unofficial comparison. It is not affiliated with OpenCode or Artificial
Analysis.

## Local development

```bash
npm run scrape   # refresh public/data
npm run serve    # http://localhost:4173
```

Node 24+ is required for the built-in `fetch`.

## Licence

MIT for the code. Scraped data belongs to its respective sources.
