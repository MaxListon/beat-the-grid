"""Project-wide settings. Every rule that affects fairness lives here, in one place."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("GRID_CACHE", Path.home() / ".cache" / "beat-the-grid"))  # raw downloads (outside the repo)
PROCESSED = ROOT / "data" / "processed"
FORECASTS = ROOT / "forecasts"          # live forecast log (committed daily: the public track record)
SITE_DATA = ROOT / "docs" / "data"      # JSON consumed by the website
MODELS = ROOT / "models"

EIA_SIX_MONTH = "https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/EIA930_BALANCE_{year}_{half}.csv"
FIRST_YEAR = 2022                       # archived day-ahead weather forecasts start in 2022

# ---- Fairness rules (see README "The rules") --------------------------------------------
# A forecast for local day D is issued at 12:00 UTC on D-1 (4 am Pacific / 7 am Eastern).
ISSUE_HOUR_UTC = 12
# It may only use demand observed up to 06:00 UTC on D-1 (6 h reporting lag).
DATA_CUTOFF_HOUR_UTC = 6
# Weather inputs are forecasts made >= 48 h before the target hour ("previous_day2"),
# so every value used was published before the issue time.
WEATHER_LEAD = "previous_day2"

# ---- Region selection (data-quality rules only; never based on how good the official forecast is)
MIN_MEAN_DEMAND_MW = 1_500
MIN_COVERAGE = 0.90                     # share of test hours with valid demand AND official forecast

# ---- Backtest
# Archived day-ahead forecasts of humidity/cloud/wind/sunlight start 2024-02-01 (temperature: 2022),
# so scoring starts 2024-07-01: every test hour has the full weather set; 2022-24 is training warm-up.
BACKTEST_START = "2024-07-01"
FULL_WEATHER_FROM = 2024
RETRAIN_EVERY_MONTHS = 3
QUANTILES = (0.1, 0.5, 0.9)


# ---- Live record
def voided(folder: Path | None = None) -> dict:
    """Days whose forecast is kept in the log but not scored (forecasts/void.json). Only ever added
    before the day starts, with the reason, so voiding can't be used to drop bad results."""
    import json
    f = (folder or FORECASTS) / "void.json"
    return json.loads(f.read_text()) if f.exists() else {}


def live_files(folder: Path | None = None, pattern: str = "20??-??-??.csv") -> list:
    """Forecast files in date order, excluding voided days."""
    folder = folder or FORECASTS
    v = voided(folder)
    return [f for f in sorted(folder.glob(pattern)) if f.name[:10] not in v]
