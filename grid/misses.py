"""The model's biggest misses, and what happened on those days.

For each of the worst region-days (highest daily error, fairly scored regions, one per region):
  - the weather forecast the model was given (archived, >= 48 h ahead) vs the weather that actually
    happened (Open-Meteo ERA5 reanalysis archive), population-weighted the same way;
  - whether the official forecast missed too, and holidays/weekends.
Explanations are generated from those numbers, never written by hand.
"""
import time

import pandas as pd
import requests

from .config import PROCESSED
from .features import _holiday_dates
from .regions import REGIONS, region_points

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
N_MISSES = 10

# Well-documented events, added as context only (the numbers above them are computed, not edited).
EVENTS = [
    ({"FPL", "FPC", "TEC", "FMPP", "JEA"}, "2024-10-09", "2024-10-13",
     "Hurricane Milton made landfall in Florida on October 9, 2024, and left millions of customers without power."),
    ({"DUK", "CPLE", "SCEG", "SC", "SOCO", "TVA"}, "2024-09-26", "2024-09-30",
     "Hurricane Helene struck on September 26–27, 2024, causing widespread power outages across the Southeast and the Carolinas."),
]


def event_note(ba: str, day: pd.Timestamp) -> str:
    for regions, start, end, text in EVENTS:
        if ba in regions and pd.Timestamp(start) <= day <= pd.Timestamp(end):
            return text
    return ""


def observed_temp(ba: str, day: pd.Timestamp) -> pd.Series:
    """Hourly observed temperature (local day, population-weighted), from the reanalysis archive."""
    tz = REGIONS[ba]["tz"]
    parts, total = None, 0.0
    for _name, lat, lon, w in region_points(ba):
        r = requests.get(ARCHIVE, params={"latitude": lat, "longitude": lon, "start_date": day.date().isoformat(),
                                          "end_date": day.date().isoformat(), "hourly": "temperature_2m",
                                          "timezone": tz}, timeout=120, headers={"User-Agent": "beat-the-grid/1.0"})
        r.raise_for_status()
        s = pd.Series(r.json()["hourly"]["temperature_2m"], dtype="float64") * w
        parts = s if parts is None else parts.add(s, fill_value=0)
        total += w
        time.sleep(1.0)
    return parts / total


def find(d: pd.DataFrame, lb: pd.DataFrame) -> pd.DataFrame:
    fair = lb.loc[~lb.suspect_official, "ba"]
    daily = (d[d.ba.isin(fair)].groupby(["ba", "local_date"])
             .agg(mine=("ape_ours", "mean"), official=("ape_official", "mean"), hours=("ape_ours", "size"),
                  demand=("demand", "mean"), forecast=("p50", "mean")).reset_index())
    daily = daily[daily.hours >= 20]
    worst = daily.sort_values("mine", ascending=False).drop_duplicates("ba").head(N_MISSES)
    return worst.reset_index(drop=True)


def describe(row, fc_temp: pd.Series, obs_temp: pd.Series, holidays: set) -> str:
    bits = []
    note = event_note(row.ba, row.local_date)
    if note:
        bits.append(note)
    dmax = obs_temp.max() - fc_temp.max()
    dmean = obs_temp.mean() - fc_temp.mean()
    if abs(dmean) >= 2 or abs(dmax) >= 3:
        word = "hotter" if dmean > 0 else "colder"
        bits.append(f"The weather also differed from the 2-day-ahead forecast: {abs(dmean):.1f}°C {word} on average "
                    f"(high {obs_temp.max():.0f}°C actual vs {fc_temp.max():.0f}°C forecast), which may explain part of the miss.")
    else:
        bits.append(f"The weather forecast was close (within {abs(dmean):.1f}°C on average), so the miss came from elsewhere.")
        if row.forecast > row.demand * 1.15 and not note:
            bits.append("Demand fell far below what the weather and calendar implied, which is what large outages or a reporting problem look like.")
    over = row.forecast > row.demand
    bits.append(f"My forecast was {'too high' if over else 'too low'} by {abs(row.forecast / row.demand - 1) * 100:.0f}% on average.")
    if row.official > row.mine * 0.7:
        bits.append(f"The official forecast also struggled ({row.official * 100:.1f}% error), which points to a genuinely unusual day.")
    else:
        bits.append(f"The official forecast handled it much better ({row.official * 100:.1f}% error): "
                    "the operator likely knew something my inputs don't capture.")
    day = row.local_date.date()
    if day in holidays:
        bits.append("It was a holiday.")
    elif row.local_date.dayofweek >= 5:
        bits.append("It was a weekend.")
    return " ".join(bits)


def build(d: pd.DataFrame, lb: pd.DataFrame) -> list[dict]:
    wx = pd.read_parquet(PROCESSED / "weather.parquet")
    worst = find(d, lb)
    hol = _holiday_dates(range(2024, 2028))
    out = []
    for r in worst.itertuples():
        tz = REGIONS[r.ba]["tz"]
        w = wx[wx.ba == r.ba].copy()
        local = (w.ts - pd.Timedelta(hours=1)).dt.tz_convert(tz)
        fc = w.loc[local.dt.normalize().dt.tz_localize(None) == r.local_date, "temp"].reset_index(drop=True)
        try:
            obs = observed_temp(r.ba, r.local_date)
        except Exception as e:  # never fail the build on a reanalysis hiccup
            print("observed weather unavailable:", r.ba, r.local_date.date(), e)
            obs = pd.Series(dtype="float64")
        text = describe(r, fc, obs, hol) if len(obs) and len(fc) else ""
        out.append({"ba": r.ba, "name": REGIONS[r.ba]["name"], "date": str(r.local_date.date()),
                    "weekday": r.local_date.strftime("%A"), "mape_mine": r.mine, "mape_official": r.official,
                    "fc_temp_max": float(fc.max()) if len(fc) else None, "obs_temp_max": float(obs.max()) if len(obs) else None,
                    "fc_temp_mean": float(fc.mean()) if len(fc) else None, "obs_temp_mean": float(obs.mean()) if len(obs) else None,
                    "explanation": text})
    return out
