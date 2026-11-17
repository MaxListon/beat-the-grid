# Beat the Grid: Project Write-up

*Maxwell Liston · University of Washington, B.S. Informatics (Data Science) · November 2026*

## The question
Every US balancing authority publishes a day-ahead forecast of hourly electricity demand. Those forecasts decide how many power plants are scheduled, so errors cost real money. **Can one open model, built only from public data, match or beat them, under rules that keep the comparison fair?**

## Data
- **Demand and official forecasts:** EIA-930 (Hourly Electric Grid Monitor), 2022–2026, every balancing authority. That's about 2.6 million region-hours.
- **Weather:** archived *forecasts* (not observations), made ≥ 48 hours ahead, from the Open-Meteo previous-runs API. They come from up to three large cities per region and are population-weighted: 78 locations in total.
- **Prices:** EIA wholesale market data (ICE), 2026 on-peak hub prices. These are used only for the dollar illustration.

## The rules
1. Each forecast covers one local day and is issued at 12:00 UTC the day before. It may use demand data only up to 06:00 UTC that morning. A test scrambles every later value and checks that the model's inputs don't change.
2. Weather inputs are forecasts that existed before the issue time. I considered fresher "one day ahead" archived forecasts and **rejected** them, because for most target hours they come from model runs published after the issue time.
3. Regions were selected on data coverage alone: 34 regions (≥ 1,500 MW, ≥ 90% coverage).
4. Regions whose official forecast has a median error above 10% (FPC, PSCO, PSEI) are excluded from the headline. Their "forecast" doesn't match their reported demand. This rule was set before scoring.
5. Hours where either forecast is off by more than 50% are treated as data glitches and dropped **for both sides** (0.9% of hours).

## Method
- **Model:** one global LightGBM model. It predicts demand as a ratio to the past week's mean, so a 1.6 GW utility and the 97 GW PJM learn from each other. Settings were tuned on April–June 2024, a window that is never scored.
- **Uncertainty:** an 80% interval from quantile models, calibrated per region with conformalized quantile regression on a held-out recent window.
- **Backtest:** walk-forward with quarterly retraining, July 2024 → November 2026. That's 696,190 scored region-hours, all out of sample.
- **Significance:** a Diebold-Mariano test on daily errors (Newey-West variance, small-sample correction), with Holm correction across regions.

## Results
| Contest | Regions | Wins | Losses | Ties | My error | Official | Blend |
|---|---|---|---|---|---|---|---|
| Main contest | 31 (97% of demand) | 12 | 14 | 5 | **3.08%** | 3.68% | **2.45%** |
| Strict check (official median error ≤ 5%) | 25 (86%) | 6 | 14 | 5 | **3.05%** | 3.20% | **2.32%** |

*Errors are load-weighted mean absolute percentage error per hour.*

- **No clean sweep.** The operators win more regions. Southern Company (1.4% error) and ISO New England are excellent.
- **My model wins where it matters most by size.** It beats **PJM**, the largest US grid (2.69% vs 3.51%), and California (3.17% vs 8.12%), so its demand-weighted error is lower.
- **When each side is stronger.** On genuine official forecasts, my model is better overnight and in the morning. The operators are better at the late-afternoon peak and on the busiest 5% of days, when their real-time information matters most.
- **The 80% interval is well calibrated:** it contains the actual value 79.5% of the time.

## The peak contest
Operators care most about each day's highest hour, because that's when the most expensive plants run. Scored the same way (Diebold-Mariano with Holm correction, 26,495 region-days), **the operators win clearly: 19 losses, 10 wins, 2 ties for my model.** Their demand-weighted peak error is 2.87% vs my 3.26%, and they place the peak within an hour of the real one on 85% of days vs my 79%. Even in PJM, where my model wins on hourly error, the operator calls the peak better (1.8% vs 2.9%).

I tried a separate model trained only to predict each day's peak (walk-forward, tuned on the never-scored window). It was *worse* than taking the highest hour of the hourly forecast (3.60% vs 3.26%), so it wasn't adopted. The blend still helps at the peak: 2.40% error, better than the official forecast in 22 of 31 regions.

## The most useful finding: better together
The two forecasts make different mistakes. A blend weighted per region and time of day, learned only from earlier quarters, cuts the operators' error from **3.68% to 2.45% (−33%)** and beats the official forecast in **28 of 31** regions (22 of 25 in the strict set). The learned weights are interpretable. California should trust my model 85–100%, PJM about 80% at night but 40% in the afternoon, and Southern Company only 10–20%.

**Scale:** annualised, the official forecasts mis-forecast ~151 TWh of electricity versus ~102 TWh blended. At 2026 wholesale prices that's roughly $9.2B vs $6.4B of energy value. This is an illustration of scale only: the real cost of forecast error is a fraction of the energy's value.

## Where it fails
Three of the model's ten worst days were **Hurricanes Milton and Helene** (October and September 2024). The weather forecasts were accurate, but millions of customers lost power, so demand collapsed. The operators knew about the outages, and a weather-driven model can't. Other misses point to reporting problems in the demand data.

**Experiment: storm warnings.** I added two inputs from archived National Weather Service warnings (hurricane, tropical storm, storm surge, extreme wind, ice storm): the population-weighted share of a region's cities under a warning at issue time, and the share where one ended in the previous 72 hours. Only warnings already in effect at the issue time count. In the same walk-forward backtest, error on the ~5,100 storm hours fell from 8.3% to 7.9% and hurricane days improved by 13–35% (Dominion SC on Helene: 30.9% → 20.2%), with ordinary days unchanged. **Not adopted yet:** the idea came from looking at the test period's worst days, so the gain is partly hindsight. It needs new storms to confirm it.

## What I tried that didn't work
- **A dedicated daily-peak model:** less accurate than the peak of the hourly forecast (3.60% vs 3.26%), so not adopted.
- **More weather cities (3 → 5 per region):** no gain on the tuning window (3.98% vs 4.00%; better in only 15 of 34 regions), so it was not adopted.
- **Mean-based "unreliable official data" rule:** I first implemented it with the mean, which flagged 6 regions because of a few glitch hours. I corrected it to the median, as originally specified.
- **Zero-filled weather:** missing 2022–23 humidity, cloud, wind and sunlight values were first averaged as 0. I caught it, fixed it, and covered it with tests.

## Live
The model was frozen on 2026-11-15 (published as the [v1.0.0 release](https://github.com/MaxListon/beat-the-grid/releases/tag/v1.0.0), with checksums). A GitHub Action publishes the next day's forecast every day at 12:00 UTC and commits it before the day begins, with a "what pushed it up or down" explanation from the model's SHAP values. Each finished day is scored automatically, added to a public track-record calendar, and plotted against the range of errors the backtest found normal, so anyone can see whether the backtest held up.

The first days of running it live taught more than the backtest did:

- **A data-feed bug, caught before it counted.** The first live forecast (for 2026-11-16) read demand only from EIA's bulk files, which run more than a day behind, so four inputs the model always had in the backtest were blank. I voided that forecast before its day began, kept the file unchanged in the public log, and switched the live job to EIA's real-time feed. The first valid forecast was for 2026-11-17.
- **Reliability.** GitHub started the first scheduled run 2 hours 43 minutes late. The job now has two backup runs a day, exact package versions are pinned so the frozen model gives identical forecasts, and a failed run opens a GitHub issue automatically.
- **A safeguard from my own mistake.** A manual test run I started just after midnight UTC began building the next day's forecast 11 hours early, before all its inputs existed. I cancelled it before anything was saved, and the code now refuses to issue a forecast before 12:00 UTC on the day before.

## Check the numbers yourself
The site has a SQL console (DuckDB running in the browser) over every scored hour, every region and every daily peak, with example queries. Every number in this write-up can be reproduced there, or from the [analysis notebook](https://github.com/MaxListon/beat-the-grid/blob/main/notebooks/analysis.ipynb) using the tables described in [DATA.md](https://github.com/MaxListon/beat-the-grid/blob/main/DATA.md).

You can also try to beat the model yourself: the site's "Can you beat the model?" section shows real demand from the days before a past day, lets you draw your own 24-hour forecast, and scores it against my model and the grid operator's.

## Next steps
- Confirm the **storm-warning signal** on the 2027 hurricane season, then adopt it as model v2.
- Find inputs that explain the operators' peak advantage (same-morning load data, large-customer schedules).
- Compare live results with the backtest after 3–6 months.
