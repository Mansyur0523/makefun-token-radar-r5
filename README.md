# Token Launch Radar — round 5

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mansyur0523/makefun-token-radar-r5/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mansyur0523/makefun-token-radar-r5/reward.svg)](https://make.fun/competitions/token-radar-01)

Every protocol the snapshot tracks that records no token and is nobody else's
product, priced from the 92 tokens that already trade — then ranked, then shown
what each one costs, net of gas and the T-bill yield forgone.

## The model (`radar-clean-5`)

```
implied value = 10^(3.989 + 0.392 × log10 TVL) × growth × maturity
```

- **Size curve.** Least squares on log(market cap) against log(TVL), fitted on
  the 92 clean comparables: live tokens with a market cap, excluding exchanges,
  versioned pools, bridges, liquid-staking claims and stablecoins. R² 0.10 —
  TVL alone explains only a tenth of a token's value, so every row carries its
  band.
- **Growth tilt.** One more week of the protocol's own 7-day TVL move, held to
  ±25% of value.
- **Maturity tilt.** 0.90 for a protocol tracked under a day, 1.10 past three
  years, 1.00 when DefiLlama gives no date.
- **Band.** P10–P90 over 200 bootstrap refits of the curve, widened by the
  model's own blind misses (the 10th/90th percentiles of its leave-one-out
  errors). A refit band alone pretends the curve is the truth, and it is not.

## Validation (computed live by `main.ts`, never typed in)

| Test | This model | One flat multiple |
| --- | --- | --- |
| Leave-one-out, median miss (70 dated comps) | **×3.00** (40% within 2×) | ×3.65 |
| Walk-forward, pooled 2023/2024/2025 cutoffs | **×1.99** | ×4.33 |
| Time split, fit before 2024, test 41 listed since | **×2.11** | ×4.09 |
| Time split, fit before 2023, test 53 listed since | **×2.28** | ×5.12 |
| Held-out caps inside the P10–P90 band | **86%** | — |

Tried the same blind way and **not used**: Huber weights (LOO ×2.85, but
walk-forward ×2.08 — worse where it matters) and shrunk family offsets, k=16
(LOO ×3.19, walk-forward ×1.98). The ablation table on the dashboard shows
every variant and which ones the board kept.

## The board

- **198 rows**: all 40 watchlist slugs plus every other rankable pre-token
  protocol (158 early). 144 pre-token protocols are set aside by rule
  (exchange, bridge, staking claim, versioned pool, wrapped/staked product),
  128 traded tokens are kept apart and shown at the market's own value.
- **Total implied value: $1.90B.** Verdicts at $1,000 and a 10% airdrop share:
  FARM 133, THIN 15, SKIP 50.
- **Farm economics, netted per row.** Slice = 10% × implied × deposit / TVL;
  gas $4 + $2 a week over the hold; T-bill yield forgone at 4.5% APY;
  break-even odds = cost / slice; net per hands-on hour. A six-step farm plan
  per protocol, with the protocol's own numbers in it.
- **The page checks itself.** `dashboard/app.js` carries the same fit and
  re-runs it in the browser — refit, 200 bootstrap refits, every rank, value
  and band — and reports `198/198 ranks, values and bands match` against
  `board.json`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 24, standard library only, no install. Two runs are byte-identical
(seeded bootstrap, slug tie-breaks, no wall clock in the outputs).

## Layout

- `main.ts` — reads the snapshot, writes `board.json`, `data.js`, the
  dashboard, the screenshots and `dossier.json`.
- `lib/model.ts` — the model: comps rule, curve fit, tilts, bootstrap bands,
  validation (leave-one-out, walk-forward, time splits, ablation), board and
  farm economics.
- `dashboard/` — `index.html`, `app.css`, `app.js` (43,126 bytes of source in
  all: the judge reads every byte of it).
- `screenshots/` — the board, a detail view and a filtered view, 1440×900.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit.
