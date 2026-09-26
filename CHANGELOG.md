# Changelog

## 16.11.0 (2026-09-26)

First open-source release, under the Mozilla Public License 2.0. It succeeds the author's earlier closed-source ES-only version.

- SPY support through its observed ETF basis to SPX, alongside ES and MES.
- 1h, 2h, 3h and 4h charts, calculated from completed 5-minute bars.
- Free Treasury yields as the default model rate source, with FRED and a fixed backup curve as options.
- One evenly spaced grid that ends on a 100 at each side; optional 25s fill every gap.
- Previous sessions' grids, each drawn only across its own session.
- Compact info table by default (SPX equivalent, nearest levels with distance, range vs ADR), with a Full option.
- Unsupported symbols and timeframes draw nothing instead of showing an error.
