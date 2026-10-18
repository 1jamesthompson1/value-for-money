# OpenCode Go — value map

A single static page that plots **included monthly usage** for every OpenCode Go model
against its **Artificial Analysis Intelligence Index**, and highlights the Pareto front:
the models that are not beaten on both usage and intelligence.

- Live site: https://1jamesthompson1.github.io/value-for-money/ (after Pages is enabled)
- Data is refreshed **daily** by a GitHub Action.
- No framework, no build step, no runtime dependencies.

![scatter plot](https://raw.githubusercontent.com/1jamesthompson1/value-for-money/main/.github/preview.png)

## How it works

```
scripts/scrape.mjs
  ├─ https://opencode.ai/v2/docs/console/go/#usage-limits
  │    → monthly $ limit, token prices, estimated requests/month (Go + Go Plus)
  └─ https://artificialanalysis.ai/leaderboards/models
       → intelligence index, creator, open-weights flag
            ↓
public/data/latest.json + public/data/history/YYYY-MM-DD.json
            ↓
GitHub Actions → GitHub Pages
```

The page loads `public/data/latest.json` and draws the chart in the browser with
hand-written SVG. The Pareto front is recomputed client-side whenever you switch
between Go / Go Plus or between the two usage axes.

### Usage axes

| Axis | Meaning |
| --- | --- |
| **Requests / month** (default) | OpenCode's published estimate for a typical request mix. This captures the fact that a $60 allowance buys far more requests on a cheap model than on an expensive one. |
| **Included $ / month** | The monthly dollar allowance listed by OpenCode. |

Both are "higher is better", as is the intelligence score. A model is on the Pareto
front when no other matched model has **both** more usage and a higher score.

### Matching and caveats

- OpenCode sometimes lists the same model twice (peak/off-peak pricing, context
  tiers). These rows are merged and the cheapest tier is used for the price shown in
  the tooltip.
- Artificial Analysis often has several reasoning configurations per model
  (`Max`, `High`, `Xhigh`, …). The **highest-scoring** configuration is used.
- A few names differ between the sources. Those aliases live in `AA_ALIASES` in
  `scripts/scrape.mjs`: Beam Free → Beam 1.0, Muse Spark 1.x Contributor →
  Muse Spark 1.x, Gemini 4 Argon Contributor → Gemini 4 Argon, Qwen3.8 Flash →
  Qwen3.8-Flash-Next.
- Models with no Artificial Analysis score are excluded and listed in the snapshot's
  `unmatched` array. Currently: GLM-5.2, LongCat 2.5 Preview Free, MiMo-V2.5,
  MiMo-V2.5-Pro, Muse Spark 1.2 Contributor, Hy4 preview, Space Bunny, GPT 5.6 Luna.
- `unlimited` free models are placed at the right edge of the chart and labelled `∞`.
- The OpenCode page's "estimated requests" figures are estimates based on a stated
  token mix, not measured usage.

This is an unofficial comparison. It is not affiliated with OpenCode or Artificial
Analysis.

## Local development

```bash
npm run scrape   # refresh public/data
npm run serve    # http://localhost:4173
```

Node 24+ is required for the built-in `fetch`.

## Data format

`public/data/latest.json`:

```jsonc
{
  "generatedAt": "2026-10-19T05:17:00.000Z",
  "sources": { "opencode": "...", "artificialAnalysis": "..." },
  "models": [
    {
      "name": "GLM-5.3-Flash",
      "input": 0.15,
      "output": 0.5,
      "aa": { "intelligence": 41.81, "name": "GLM-5.3-Flash", "...": "..." },
      "go": { "monthlyLimit": 60, "monthlyRequests": 31580 },
      "go-plus": { "monthlyLimit": 180, "monthlyRequests": 94740 }
    }
  ],
  "unmatched": ["GLM-5.2", "..."]
}
```

`public/data/history/` keeps one file per UTC day, and `public/data/index.json`
lists the available dates.

## GitHub setup

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Run the **Refresh data and deploy** workflow once (or push to `main`).

The workflow runs at 05:17 UTC every day, commits the new snapshot, and deploys the
`public/` folder. It can also be triggered manually from the Actions tab.

## Licence

MIT for the code. Scraped data belongs to its respective sources.
