# Pre-token radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rajarmdn/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rajarmdn/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for [make.fun](https://make.fun)'s “Build the best token launch radar” bounty: it reads the
sealed DefiLlama snapshot, finds the protocols that record no token yet, and ranks them by what a
launch would be worth.

The value model comes from the snapshot's own figures: the median market-cap-to-TVL multiple of each
category's already-tokenised protocols, adjusted by the protocol's seven-day TVL growth, how long it
has run with no token, and how many chains it reaches. Every row carries the farm steps a reader
would take, and the dashboard shows the whole multiplication chain, the comparables behind each
category multiple, and a filter for the watchlist, a category, a chain or a TVL floor.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json`, `out/data.js`, `out/dossier.json` and copies `dashboard/` and
`screenshots/` there.

## Layout

- `main.ts` — reads the snapshot, scores the candidates, writes the board and the dossier
- `lib/model.ts` — the comparable-ratio valuation model
- `dashboard/` — the static page (board, protocol detail, saved filter), no network, no framework
- `vendor/makefun-board.ts` — the kit's dossier library
- `scripts/` — nothing; the dashboard renders from `data.js` alone
