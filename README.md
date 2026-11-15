# Token Radar 01 — entry by @velzard

A token launch radar for make.fun's **Token Radar 01**: a Node 22 program (`main.ts`,
standard library only) that reads the competition's sealed DefiLlama snapshot and ranks
every rankable pre-token protocol by an implied value, with a farm plan for each, a
static dashboard, and the dossier the judge reads.

## The model (peer-multiple-2)

No protocol's name is special-cased. One function prices every row:

- **Peer multiple** — for the protocol's category, take the tokenized protocols'
  market-cap-to-TVL ratios, clip them to [0.02, 5], and median them. Categories with
  fewer than 8 trading peers are shrunk toward the global median (weight k=3); a
  category with no trading peers uses the global median.
- **Growth factor** — `1 + clamp(change_7d, −50%, +100%) × 0.35`; unreported growth
  earns no credit.
- **Tenure factor** — `0.75 + 0.25 × (1 − e^(−age/540d))` over the days the protocol
  has run with no token recorded; unknown age counts as 365 days.

`implied = round(TVL × peer multiple × growth factor × tenure factor)`.

The board carries all 40 watchlist protocols plus every other rankable pre-token
protocol in the snapshot. Protocols whose tokens already trade are never ranked —
they are the peer evidence, shown on the dashboard's "Already trading" view.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory. The dashboard (`dashboard/index.html` beside `data.js`) renders fully
offline: a sortable, filterable board, a detail view per protocol with the model's
arithmetic line by line, and the farm plan.
