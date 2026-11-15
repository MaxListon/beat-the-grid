"""Archived weather FORECASTS (not observations) for every weather point.

Backtest: Open-Meteo Previous Runs API, variables suffixed `_previous_day2`, i.e. the value
the model predicted >= 48 h before the target hour. Every number used was published before
our 12:00 UTC issue time, so the backtest cannot peek at the actual weather.

Live: Open-Meteo Forecast API (the forecast as published at run time).

Output: data/processed/weather.parquet  (ba, ts [UTC end-of-hour], temp, dewpoint, cloud, wind, solar)
        population-weighted across each region's points.
"""
import datetime as dt
import time

import pandas as pd
import requests

from .config import CACHE, FIRST_YEAR, FULL_WEATHER_FROM, PROCESSED, WEATHER_LEAD
from .regions import REGIONS, region_points, unique_points

try:  # use the OS certificate store when available (python.org macOS builds lack one)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

VARS = {"temperature_2m": "temp", "dew_point_2m": "dewpoint", "cloud_cover": "cloud",
        "wind_speed_10m": "wind", "shortwave_radiation": "solar"}
ARCHIVE_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
PAUSE_S = 1.5   # one request at a time + this pause keeps us under the free tier's hourly budget
LIVE_URL = "https://api.open-meteo.com/v1/forecast"


def _get(url: str, params: dict, tries: int = 6) -> dict:
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=240, headers={"User-Agent": "beat-the-grid/1.0"})
        except requests.RequestException as e:   # timeouts while throttled: back off
            last = e
            time.sleep(min(120 * (i + 1), 600))
            continue
        if r.status_code == 429 or r.status_code >= 500:  # rate limit / server: wait and retry
            last = f"{r.status_code} {r.text[:200]}"
            time.sleep(min(120 * (i + 1), 600))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"Open-Meteo failed after {tries} tries: {last}")


def _frame(js: dict, suffix: str = "") -> pd.DataFrame:
    h = js["hourly"]
    df = pd.DataFrame({"ts_start": pd.to_datetime(h["time"], utc=True)})
    for api, short in VARS.items():
        vals = h.get(api + suffix)
        df[short] = (pd.to_numeric(pd.Series(vals), errors="coerce").astype("float32")
                     if vals is not None else pd.Series(float("nan"), index=df.index, dtype="float32"))
    # Open-Meteo stamps hours by their start; EIA by their end -> shift to end-of-hour
    df["ts"] = df.pop("ts_start") + pd.Timedelta(hours=1)
    return df


def _quarters(end: dt.date):
    for y in range(FIRST_YEAR, end.year + 1):
        for q in range(4):
            start = dt.date(y, 3 * q + 1, 1)
            if start > end:
                return
            stop = (dt.date(y + (q == 3), (3 * q + 3) % 12 + 1, 1) - dt.timedelta(days=1))
            yield y, q + 1, start, min(stop, end)


def archive_point(name: str, lat: float, lon: float, end: dt.date) -> pd.DataFrame:
    """Day-2 forecasts for one point, fetched and cached per quarter (small, resumable requests).

    Completed quarters never change, so they are fetched once; only the current quarter refreshes.
    """
    out = []
    for y, q, start, stop in _quarters(end):
        path = CACHE / "weather" / f"{name.replace(' ', '_')}_{y}Q{q}.parquet"
        complete = stop < end
        if path.exists() and complete:
            out.append(pd.read_parquet(path))
            continue
        # Before 2024 only temperature was archived; asking for the rest just burns API quota
        wanted = VARS if y >= FULL_WEATHER_FROM else {"temperature_2m": "temp"}
        js = _get(ARCHIVE_URL, {"latitude": lat, "longitude": lon, "timezone": "UTC",
                                "start_date": start.isoformat(), "end_date": stop.isoformat(),
                                "hourly": ",".join(f"{v}_{WEATHER_LEAD}" for v in wanted)})
        df = _frame(js, suffix=f"_{WEATHER_LEAD}")
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(path, index=False)
        out.append(df)
        time.sleep(PAUSE_S)  # be gentle: the free API throttles bursts of heavy archive queries
    df = pd.concat(out, ignore_index=True)
    df["point"] = name
    return df


def live_point(name: str, lat: float, lon: float) -> pd.DataFrame:
    js = _get(LIVE_URL, {"latitude": lat, "longitude": lon, "timezone": "UTC", "past_days": 2,
                         "forecast_days": 3, "hourly": ",".join(VARS)})
    df = _frame(js)
    df["point"] = name
    return df


def weight_regions(points: pd.DataFrame) -> pd.DataFrame:
    """Population-weighted average weather per region and hour."""
    rows = []
    for ba in REGIONS:
        w = pd.DataFrame([(n, wt) for n, _, _, wt in region_points(ba)], columns=["point", "w"])
        m = points.merge(w, on="point")
        cols = list(VARS.values())
        # Weighted mean per variable, using only the points that have a value. A missing value must
        # stay missing (NaN), never become 0: before Feb 2024 only temperature was archived.
        vals = m[cols]
        wts = vals.notna().mul(m.w, axis=0)
        agg = vals.mul(m.w, axis=0).groupby(m.ts).sum(min_count=1) / wts.groupby(m.ts).sum().replace(0, float("nan"))
        agg["ba"] = ba
        rows.append(agg.reset_index())
    return pd.concat(rows, ignore_index=True)


def build(end: dt.date | None = None) -> pd.DataFrame:
    end = end or dt.date.today() + dt.timedelta(days=1)
    pts = unique_points()
    frames = []
    for i, (name, (lat, lon)) in enumerate(pts.items(), 1):
        frames.append(archive_point(name, lat, lon, end))
        print(f"weather {i}/{len(pts)} {name}: {len(frames[-1]):,} hours", flush=True)
    w = weight_regions(pd.concat(frames, ignore_index=True))
    PROCESSED.mkdir(parents=True, exist_ok=True)
    w.to_parquet(PROCESSED / "weather.parquet", index=False)
    return w


if __name__ == "__main__":
    print(build().describe().round(1).to_string())
