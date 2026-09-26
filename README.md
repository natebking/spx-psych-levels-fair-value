# SPX Psych Levels + Fair Value for ES, MES and SPY

A TradingView (Pine Script v6) indicator that draws round SPX levels (100s, 50s and optional 25s) on ES/MES futures and SPY charts, translated through each instrument's basis to the index, plus a cash-session ADR envelope.

- **ES / MES:** chart level = SPX level + fair-value basis
- **SPY:** chart level = SPX level / 10 + (SPY - SPX / 10)

Levels show where round SPX numbers sit on your chart. They are reference areas, not predictions or trade signals.

## Install

1. Copy [`spx_psych_levels.pine`](spx_psych_levels.pine).
2. In TradingView, open the Pine Editor, paste it in and click **Add to chart**.
3. Use it on an ES, MES (continuous or the active contract) or SPY chart.

The same script is published on TradingView as **SPX Psych Levels + Fair Value for ES, MES and SPY** by SpinTrades.

## Supported charts

| | Supported | Otherwise |
| --- | --- | --- |
| Symbols | ES, MES, SPY | Nothing is drawn (QQQ, SPX, NQ and others) |
| Timeframes | Intraday intervals that divide 30 minutes (1, 2, 3, 5, 10, 15, 30 min...), plus 1h, 2h, 3h, 4h | Nothing is drawn, no error |

1h to 4h charts are calculated from completed 5-minute bars, so they match a 5-minute chart and can update up to five minutes after a session event.

## The grid

- **Span** scales with the expected daily range (ADR-14 by default; ADR-10, VIX, VIX1D or VIX9D selectable), or a fixed number of levels per side.
- With 50s on, each session's grid is one evenly spaced 50-point ladder centred on the 100 nearest price, with the same number of 100s each side, so every day has the same shape. Turning on 25s fills every gap in it.
- **Session Anchored** (default) holds the basis captured at the session open: 18:00 New York for futures, the first bar of the day for SPY. **Live Basis** re-projects the levels as the basis moves.
- **Re-centre Grid on Trend** rebuilds the grid if price moves more than 100 SPX points from its centre.
- **Sessions to Show** (1 to 41, default 3: the current session plus the two before it) keeps earlier sessions' grids, faded, each drawn only across its own session. TradingView allows 500 lines per script, so on long lookbacks the oldest sessions drop off first.

## Fair value (ES / MES)

| Mode | How the basis is set |
| --- | --- |
| **Observed** (default) | Smoothed ES - SPX difference from bars with matching timestamps. Needs no rate data. |
| **Theoretical** | Carry model: SPX x rate x days to expiry, less an estimated dividend yield. |
| **Blended** | Model plus half the observed deviation (capped at 6 points). |

SPY always uses its observed ETF basis, which already includes dividends, expenses and tracking.

**Model Rate Source** only matters in Theoretical and Blended modes:

| Option | Data | Table shows |
| --- | --- | --- |
| **Treasury (free)** (default) | `TVC:US01MY`, `TVC:US03MY`, `CBOE:IRX`, `TVC:US06MY`, `TVC:US01Y`. The 3M rate blends IRX (converted from a discount rate to a bond-equivalent yield) with US03MY. | TSY |
| **FRED** | `FRED:DGS1MO`, `DGS3MO`, `DGS6MO`, `DGS1`. Some accounts may need economic-data access. | FRED |
| **Fixed backup** | No requests. Fixed curve: 1M 4.22%, 3M 4.06%, 6M 3.95%, 1Y 3.85%. | est |

Any missing or out-of-range tenor falls back to the fixed curve and the rate is marked **est**. Observed mode and SPY never request rate data.

## ADR envelope

The 09:30 New York cash open plus and minus the average high-low range of the prior 14 (or 10) completed cash sessions, in the chart's own prices. Today's developing range is excluded, so the lines stay fixed during the day.

- **ES / MES** keep the last valid cash envelope overnight until a new one is ready. It is not reset at the 18:00 futures open.
- **SPY** shows the envelope only during the cash session and clears it at the close, including early closes.

It is a descriptive range reference, not a probability.

## Info table

You pick the rows under **Info Table** in the settings. By default it shows one row, **Fair value**: the value with its mode, plus rate, source and days to expiry in Theoretical and Blended. On SPY it shows the observed ETF basis.

Optional rows: SPX equivalent of the current price, nearest levels above and below with distance in SPX points, nearest 100s, today's range against ADR, the ADR+ and ADR- prices with their distance, and the contract. Position and text size are adjustable.

A second group, **Info Table: Model (ES/MES)**, adds the carry model's inputs: the model fair value, the observed basis and its gap to the model, the rate breakdown (Treasury rate + funding spread + seasonal premium), the Treasury curve (fixed estimates marked *), days to expiry, and the dividend yield estimate.

A **Check** row appears in amber only when the basis or rate can't be trusted, for example while waiting for SPX data or when the rate is an estimate. Untick every row to hide the table.

## Tests

The `tests` folder runs the indicator's Pine source through [PineTS](https://github.com/LuxAlgo/PineTS) with controlled price data: session and holiday boundaries, stale or missing quotes, SPY units, daylight-saving changes, grid spacing and 25-point coverage, previous-session drawing limits, 1h to 4h replay against 5-minute state, and blank output on unsupported symbols and timeframes.

```
npm --prefix tests ci
node --stack-size=4000 tests/holiday-regression.cjs
```

These tests check the script's logic. They don't replace checking it on a live TradingView chart.

## License

Copyright (c) 2025-2026 SpinTrades. Licensed under the [Mozilla Public License 2.0](LICENSE).
