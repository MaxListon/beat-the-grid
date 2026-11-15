"""EIA-930 hourly demand and each balancing authority's own day-ahead demand forecast.

Source: EIA Hourly Electric Grid Monitor six-month BALANCE files (no API key needed).
Output: data/processed/eia.parquet with one row per (ba, utc hour):
    ba, ts (UTC, end of hour), demand, official_fc, demand_raw
`demand` is EIA's adjusted demand when present (EIA cleans obvious reporting errors),
falling back to the raw reported value.
"""
import datetime as dt
import subprocess
from pathlib import Path

import pandas as pd

from .config import CACHE, EIA_SIX_MONTH, FIRST_YEAR, PROCESSED

COLS = {
    "Balancing Authority": "ba",
    "UTC Time at End of Hour": "ts",
    "Demand Forecast (MW)": "official_fc",
    "Demand (MW)": "demand_raw",
    "Demand (MW) (Adjusted)": "demand_adj",
}


def halves(today: dt.date | None = None):
    today = today or dt.date.today()
    for y in range(FIRST_YEAR, today.year + 1):
        for half in ("Jan_Jun", "Jul_Dec"):
            if y == today.year and half == "Jul_Dec" and today.month < 7:
                continue
            yield y, half


def download(year: int, half: str, force: bool = False) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"EIA930_BALANCE_{year}_{half}.csv"
    current = dt.date.today()
    is_live = year == current.year and (half == "Jul_Dec") == (current.month >= 7)
    if path.exists() and not force and not is_live:
        return path
    tmp = path.with_suffix(".part")
    # curl uses the OS certificate store; python.org builds on macOS often lack one
    subprocess.run(["curl", "-sSfL", "--retry", "4", "--retry-delay", "5", "--max-time", "900",
                    "-o", str(tmp), EIA_SIX_MONTH.format(year=year, half=half)], check=True)
    tmp.replace(path)
    return path


def parse(path: Path) -> pd.DataFrame:
    header = pd.read_csv(path, nrows=0).columns
    use = [c for c in COLS if c in header]
    df = pd.read_csv(path, usecols=use, thousands=",", low_memory=False).rename(columns=COLS)
    df["ts"] = pd.to_datetime(df["ts"], format="%m/%d/%Y %I:%M:%S %p", utc=True)
    for c in ("official_fc", "demand_raw", "demand_adj"):
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("float32")
    if "demand_adj" not in df:
        df["demand_adj"] = float("nan")
    df["demand"] = df["demand_adj"].fillna(df["demand_raw"])
    return df[["ba", "ts", "demand", "official_fc", "demand_raw"]]


def build(force_live: bool = True) -> pd.DataFrame:
    frames = []
    for y, h in halves():
        p = download(y, h, force=False)
        frames.append(parse(p))
        print(f"EIA {y} {h}: {len(frames[-1]):,} rows", flush=True)
    df = (pd.concat(frames, ignore_index=True)
            .drop_duplicates(["ba", "ts"], keep="last")
            .sort_values(["ba", "ts"], ignore_index=True))
    PROCESSED.mkdir(parents=True, exist_ok=True)
    df.to_parquet(PROCESSED / "eia.parquet", index=False)
    return df


if __name__ == "__main__":
    d = build()
    print(d.groupby("ba").demand.mean().sort_values(ascending=False).head(60).round(0).to_string())
