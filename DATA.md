# Data dictionary

Everything the website shows comes from public data, and the backtest results are published as three
Parquet tables in [`docs/data/sql/`](docs/data/sql/). The site's [SQL console](https://maxliston.github.io/beat-the-grid/#sql)
queries them in your browser with DuckDB. You can also download them and use pandas, DuckDB, R or anything
else that reads Parquet:

```python
import pandas as pd
base = "https://maxliston.github.io/beat-the-grid/data/sql/"
hourly = pd.read_parquet(base + "hourly.parquet")
```

```sql
-- DuckDB, from your own machine
SELECT * FROM 'https://maxliston.github.io/beat-the-grid/data/sql/regions.parquet';
```

## Conventions

- **MW** is average megawatts over the hour, which equals megawatt-hours of energy in that hour.
- **Error** is absolute percentage error: `|forecast − actual| / actual`. Averages over hours or days are
  mean absolute percentage error (MAPE). "Demand-weighted" averages weight each region by its average demand.
- **Dates and hours are local to each region.** `local_hour` 0 is the hour from midnight to 1 am.
  `hour_ending_utc` is the same hour as EIA reports it: the UTC time at which the hour *ends*.
- **Backtest period:** July 1, 2024 to November 14, 2026, walk-forward (each quarter forecast by a model
  trained only on earlier data). Hours with obvious data glitches in EIA's records were removed before scoring.

## `hourly.parquet`: one row per region and hour (696,190 rows)

| Column | Type | Meaning |
|---|---|---|
| `region` | text | EIA code of the balancing authority, e.g. `PJM`, `ERCO`, `CISO`. Names are in `regions`. |
| `hour_ending_utc` | timestamp | End of the hour, in UTC, as EIA reports it. |
| `local_date` | date | Calendar date in the region's own time zone. |
| `local_hour` | integer 0–23 | Hour of the local day (0 = midnight to 1 am). |
| `actual_mw` | integer | Demand that actually happened (EIA-930). |
| `official_mw` | integer | The grid operator's own day-ahead forecast (EIA-930). |
| `ours_mw` | integer | My model's forecast (the median). |
| `ours_low_mw` | integer | Low end of my 80% prediction range (10th percentile). |
| `ours_high_mw` | integer | High end of my 80% prediction range (90th percentile). |
| `blend_mw` | integer | Weighted mix of `ours_mw` and `official_mw`, with weights learned only from earlier quarters. |

## `regions.parquet`: one row per region (34 rows)

| Column | Type | Meaning |
|---|---|---|
| `region` | text | EIA code (joins to the other tables). |
| `name` | text | Full name, e.g. "PJM Interconnection". |
| `area` | text | Where it is, e.g. "Mid-Atlantic & Chicago". |
| `avg_demand_mw` | number | Average hourly demand over the backtest. |
| `in_headline` | true/false | Counted in the headline results. False for 3 regions (FPC, PSCO, PSEI) whose official forecast has a median hourly error above 10%, which points to a reporting mismatch rather than a real forecast. The threshold was set before scoring. |
| `in_strict_check` | true/false | In the stricter robustness check: the operator's median hourly error is under 5%. |
| `result` | text | `win`, `loss` or `tie` for my model vs the official forecast, or `not scored`. |
| `error_ours` | number | My MAPE over the backtest (0.0269 = 2.69%). |
| `error_official` | number | The official forecast's MAPE. |
| `error_blend` | number | The blend's MAPE. |
| `p_value_holm` | number | Diebold-Mariano p-value on daily errors, Holm-corrected across regions. Win or loss needs < 0.05. |
| `hours` | integer | Number of scored hours. |

## `peaks.parquet`: one row per region and day (28,746 rows)

Days with at least 23 scored hours. The peak is the day's highest hour.

| Column | Type | Meaning |
|---|---|---|
| `region` | text | EIA code. |
| `local_date` | date | Local calendar date. |
| `actual_peak_mw` | integer | The day's highest actual hourly demand. |
| `actual_peak_hour` | integer 0–23 | Local hour when it happened. |
| `ours_peak_mw`, `ours_peak_hour` | integer | Highest hour of my forecast, and when. |
| `official_peak_mw`, `official_peak_hour` | integer | Highest hour of the official forecast, and when. |

## Live forecasts: [`forecasts/`](forecasts/)

| File | Contents |
|---|---|
| `YYYY-MM-DD.csv` | The forecast for that day, issued the day before and never edited: `issued_at_utc, ba, ts_utc, local_hour, p10, p50, p90` (MW; `ts_utc` is the end of the hour). |
| `YYYY-MM-DD.why.json` | What pushed each region's forecast up or down (from the model's SHAP values), plus temperatures. |
| `live_scores.csv` | Daily score per region once EIA has reported the whole day: `mape_ours`, `mape_official`, `in_80` (share of hours inside the 80% range). |
| `void.json` | Forecasts withdrawn before their day began, with the reason. |

## Sources

- Demand and official forecasts: [EIA-930 Hourly Electric Grid Monitor](https://www.eia.gov/electricity/gridmonitor/) (public domain).
- Weather forecasts: [Open-Meteo](https://open-meteo.com/) previous-runs and forecast APIs (CC BY 4.0).
- Storm warnings (experiment only): National Weather Service, via the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/).
