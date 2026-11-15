"""Turn demand + weather forecasts into model rows, enforcing the information cutoff.

One row = one (region, target hour). For a target hour in local day D:
  issue time  = 12:00 UTC on D-1
  data cutoff = 06:00 UTC on D-1  -> any demand observation after this is invisible
Weather columns are day-2 forecasts (published >= 48 h ahead), so they are always visible.

The model predicts a *ratio*: demand / (mean demand over the 7 days before the cutoff).
Ratios let one model learn across regions of very different sizes (PJM ~94 GW, JEA ~1.6 GW).
"""
import numpy as np
import pandas as pd
import holidays as hol

from .config import DATA_CUTOFF_HOUR_UTC
from .regions import REGIONS

WEATHER = ["temp", "dewpoint", "cloud", "wind", "solar"]
FEATURES = [
    "ba_code", "hour", "dow", "month", "doy_sin", "doy_cos", "is_holiday", "near_holiday", "is_weekend",
    "r_lag2d", "r_lag3d", "r_lag7d", "r_last", "r_level24", "level_vs_year",
    *WEATHER, "temp_3h", "temp_day_mean", "temp_day_max", "temp_day_min", "hdd", "cdd",
    "temp_minus_lag7d", "temp_minus_last", "solar_day_sum",
]
TARGET = "ratio"


def _holiday_dates(years) -> set:
    us = hol.US(years=years)
    days = set(us.keys())
    for y in years:  # high-impact days that aren't federal holidays
        thanksgiving = [d for d, n in hol.US(years=[y]).items() if "Thanksgiving" in n]
        if thanksgiving:
            days.add(thanksgiving[0] + pd.Timedelta(days=1).to_pytimedelta())
        days.add(pd.Timestamp(y, 12, 24).date())
        days.add(pd.Timestamp(y, 12, 31).date())
    return days


def build_region(ba: str, eia: pd.DataFrame, wx: pd.DataFrame, target_days: pd.DatetimeIndex | None = None) -> pd.DataFrame:
    """Rows for one region. eia/wx are that region's hourly frames (UTC end-of-hour `ts`)."""
    tz = REGIONS[ba]["tz"]
    s = eia.set_index("ts")["demand"].astype("float64")
    s = s.where(s > 0)
    full = pd.date_range(s.index.min(), max(s.index.max(), wx.ts.max()), freq="h", tz="UTC")
    s = s.reindex(full)
    w = wx.set_index("ts")[WEATHER].reindex(full)

    df = pd.DataFrame(index=full)
    df.index.name = "ts"
    df["demand"] = s
    df["official_fc"] = eia.set_index("ts")["official_fc"].reindex(full)
    local_start = (full - pd.Timedelta(hours=1)).tz_convert(tz)       # hour-beginning, local
    df["local_date"] = pd.to_datetime(local_start.date)
    df["hour"] = local_start.hour
    df["dow"] = local_start.dayofweek
    df["month"] = local_start.month
    doy = local_start.day_of_year
    df["doy_sin"], df["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    hd = _holiday_dates(range(full.min().year - 1, full.max().year + 2))
    d = df["local_date"].dt.date
    df["is_holiday"] = d.isin(hd).astype("int8")
    df["near_holiday"] = (d.map(lambda x: (x - pd.Timedelta(days=1).to_pytimedelta()) in hd or
                                (x + pd.Timedelta(days=1).to_pytimedelta()) in hd)).astype("int8")
    df["is_weekend"] = (df.dow >= 5).astype("int8")

    # ---- information cutoff -------------------------------------------------------------
    issue_day = df["local_date"] - pd.Timedelta(days=1)
    df["cutoff"] = issue_day.dt.tz_localize("UTC") + pd.Timedelta(hours=DATA_CUTOFF_HOUR_UTC)
    cut = pd.DatetimeIndex(df["cutoff"])                                # tz-aware (UTC)

    # Demand statistics as of each cutoff hour (computed once per cutoff, then broadcast)
    roll24 = s.rolling(24, min_periods=18).mean()
    roll168 = s.rolling(168, min_periods=120).mean()
    roll8760 = s.rolling(24 * 365, min_periods=24 * 200).mean()
    df["level168"] = roll168.reindex(cut).to_numpy()
    df["level24"] = roll24.reindex(cut).to_numpy()
    df["last"] = s.reindex(cut).to_numpy()
    df["level_vs_year"] = df.level168 / roll8760.reindex(cut).to_numpy()

    def visible_lag(hours: int) -> np.ndarray:
        t = df.index - pd.Timedelta(hours=hours)
        vals = s.reindex(t).to_numpy()
        return np.where(t <= cut, vals, np.nan)                     # hide anything after the cutoff

    lvl = df.level168.values
    df["r_lag2d"] = visible_lag(48) / lvl
    df["r_lag3d"] = visible_lag(72) / lvl
    df["r_lag7d"] = visible_lag(168) / lvl
    df["r_last"] = df["last"] / lvl
    df["r_level24"] = df.level24 / lvl
    df[TARGET] = df.demand / lvl

    # ---- weather (forecasts) --------------------------------------------------------------
    for c in WEATHER:
        df[c] = w[c].values
    df["temp_3h"] = w["temp"].rolling(3, min_periods=1).mean().values
    by_day = df.groupby("local_date")
    df["temp_day_mean"] = by_day.temp.transform("mean")
    df["temp_day_max"] = by_day.temp.transform("max")
    df["temp_day_min"] = by_day.temp.transform("min")
    df["solar_day_sum"] = by_day.solar.transform("sum")
    df["hdd"] = (18 - df.temp).clip(lower=0)
    df["cdd"] = (df.temp - 22).clip(lower=0)
    df["temp_minus_lag7d"] = df.temp - w["temp"].shift(168).values
    df["temp_minus_last"] = df.temp - w["temp"].reindex(cut).to_numpy()

    df["ba"] = ba
    df["ba_code"] = list(REGIONS).index(ba)
    df = df.reset_index()
    if target_days is not None:
        df = df[df.local_date.isin(target_days)]
    return df


def build_all(eia: pd.DataFrame, wx: pd.DataFrame, regions=None) -> pd.DataFrame:
    parts = []
    for ba in regions or REGIONS:
        e, w = eia[eia.ba == ba], wx[wx.ba == ba]
        if len(e) and len(w):
            parts.append(build_region(ba, e, w))
    out = pd.concat(parts, ignore_index=True)
    return out[out.level168.notna()]
