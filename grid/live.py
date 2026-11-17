"""The live contest. Run once a day at ~12:00 UTC (GitHub Actions):

  1. score every past forecast whose target day is now fully reported by EIA
  2. issue tomorrow's forecast for every region with the FROZEN model, and write it to
     forecasts/YYYY-MM-DD.csv (never overwritten -> the git history is the proof of timing)
  3. rebuild the website data

The model in models/frozen/ was trained once, before launch, and is never retuned on live data.
"""
import datetime as dt
import json
from pathlib import Path

import pandas as pd

from . import eia as eia_mod
from . import model, weather
from .config import FORECASTS, ISSUE_HOUR_UTC, MODELS, PROCESSED, live_files
from .features import build_region
from .regions import REGIONS, unique_points

FROZEN = MODELS / "frozen"


def recent_eia(days: int = 400) -> pd.DataFrame:
    """Demand history for the live forecast, the same inputs the backtest had at each cutoff.

    Over a year of history (the model compares last week with the past year), from the six-month
    bulk files, which lag by a day or more. The newest hours come from EIA's live Grid Monitor feed,
    used only where the bulk files have no value yet.
    """
    today = dt.date.today()
    start = today - dt.timedelta(days=days)
    halves, y, h = [], start.year, "Jan_Jun" if start.month < 7 else "Jul_Dec"
    while (y, h) <= (today.year, "Jan_Jun" if today.month < 7 else "Jul_Dec"):
        halves.append((y, h))
        y, h = (y, "Jul_Dec") if h == "Jan_Jun" else (y + 1, "Jan_Jun")
    frames = [eia_mod.parse(eia_mod.download(y, h)) for y, h in halves]
    df = pd.concat(frames).drop_duplicates(["ba", "ts"], keep="last")
    df = df[df.ts >= pd.Timestamp(start, tz="UTC")]
    rt = eia_mod.realtime(list(REGIONS), today - dt.timedelta(days=4), today + dt.timedelta(days=1))
    df = df.merge(rt, on=["ba", "ts"], how="outer")
    df["from_rt"] = df.demand.isna() & df.demand_rt.notna()      # scored only once the bulk file has it
    df["demand"] = df.demand.fillna(df.demand_rt.astype(df.demand.dtype))
    df["official_fc"] = df.official_fc.fillna(df.official_fc_rt.astype(df.official_fc.dtype))
    return df.drop(columns=["demand_rt", "official_fc_rt"]).sort_values(["ba", "ts"], ignore_index=True)


def live_weather() -> pd.DataFrame:
    pts = [weather.live_point(n, la, lo) for n, (la, lo) in unique_points().items()]
    return weather.weight_regions(pd.concat(pts, ignore_index=True))


def issue(target: dt.date, eia: pd.DataFrame, wx: pd.DataFrame, now: pd.Timestamp | None = None) -> pd.DataFrame:
    now = now or pd.Timestamp.now(tz="UTC")
    path = FORECASTS / f"{target.isoformat()}.csv"
    if path.exists():
        print(f"{path.name} already issued; not overwriting")
        return pd.read_csv(path)
    # Never issue early: before 12:00 UTC on the day before, the newest demand the backtest allowed
    # (up to 06:00 UTC) may not be published yet, so some inputs would be blank. A run at another
    # hour (manual, or a schedule that fires early) just scores and refreshes the site.
    opens = pd.Timestamp(target, tz="UTC") - pd.Timedelta(days=1) + pd.Timedelta(hours=ISSUE_HOUR_UTC)
    if now < opens:
        print(f"Not issuing {path.name} yet: forecasts for {target} are issued from {opens:%Y-%m-%d %H:%M} UTC")
        return None
    models = model.load(FROZEN)
    rows, why = [], {}
    for ba in REGIONS:
        f = build_region(ba, eia[eia.ba == ba], wx[wx.ba == ba], target_days=pd.DatetimeIndex([pd.Timestamp(target)]))
        f = f[f.level168.notna()]
        if f.empty:
            continue
        p = model.predict(models, f)
        rows.append(pd.DataFrame({"ba": ba, "ts_utc": f.ts.dt.strftime("%Y-%m-%dT%H:%MZ").values,
                                  "local_hour": f.hour.values, **{c: p[c].round(0).values for c in p}}))
        why[ba] = explain(models, f, p)
    out = pd.concat(rows, ignore_index=True)
    first_hour = pd.to_datetime(out.ts_utc).min()
    if now >= first_hour - pd.Timedelta(hours=1):
        raise RuntimeError(f"Too late to issue a fair forecast for {target}: now={now}, first hour ends {first_hour}")
    out.insert(0, "issued_at_utc", now.strftime("%Y-%m-%dT%H:%MZ"))
    FORECASTS.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)
    path.with_suffix(".why.json").write_text(json.dumps({"target": target.isoformat(), "regions": _no_nan(why)}, indent=1))
    print(f"issued {path.name}: {out.ba.nunique()} regions")
    return out


def _no_nan(o):
    """JSON has no NaN; write missing numbers as null so browsers can parse the file."""
    if isinstance(o, dict):
        return {k: _no_nan(v) for k, v in o.items()}
    if isinstance(o, float) and o != o:
        return None
    return o


DRIVERS = {
    "Weather": ["temp", "dewpoint", "cloud", "wind", "solar", "temp_3h", "temp_day_mean", "temp_day_max",
                "temp_day_min", "hdd", "cdd", "temp_minus_lag7d", "temp_minus_last", "solar_day_sum"],
    "Day of week & holidays": ["dow", "is_weekend", "is_holiday", "near_holiday"],
    "Recent demand trend": ["r_lag2d", "r_lag3d", "r_lag7d", "r_last", "r_level24"],
    "Season": ["month", "doy_sin", "doy_cos", "level_vs_year"],
}


def explain(models: dict, f: pd.DataFrame, p: pd.DataFrame) -> dict:
    """Why tomorrow looks the way it does, from the point model's own SHAP contributions.

    The model predicts demand / (last week's mean), so each contribution is a share of last week's
    average demand. Averaged over the day, they say how much each kind of input pushed tomorrow's
    average up or down. 'hour' and 'ba_code' only shape the daily profile, so they're left out.
    """
    from .features import FEATURES
    contrib = pd.DataFrame(models[0.5].predict(f[FEATURES], pred_contrib=True)[:, :-1], columns=FEATURES)
    drivers = {k: float(contrib[cols].sum(axis=1).mean()) for k, cols in DRIVERS.items()}
    last_week = float(f.level168.iloc[0])
    return {
        "avg_mw": float(p.p50.mean()), "peak_mw": float(p.p50.max()),
        "peak_hour": int(f.hour.iloc[int(p.p50.to_numpy().argmax())]),
        "last_week_avg_mw": last_week, "vs_last_week": float(p.p50.mean() / last_week - 1),
        "max_temp_c": float(f.temp.max()), "temp_vs_last_week_c": float(f.temp_minus_lag7d.mean()),
        "drivers": dict(sorted(drivers.items(), key=lambda kv: -abs(kv[1]))),
    }


def score(eia: pd.DataFrame) -> pd.DataFrame:
    """Daily live score per region for every forecast file whose day is fully reported."""
    eia = eia[~eia.get("from_rt", False)] if "from_rt" in eia else eia
    actual = eia.assign(ts_utc=eia.ts.dt.strftime("%Y-%m-%dT%H:%MZ"))[["ba", "ts_utc", "demand", "official_fc"]]
    out = []
    for f in live_files(FORECASTS):
        fc = pd.read_csv(f).merge(actual, on=["ba", "ts_utc"], how="left")
        for ba, g in fc.groupby("ba"):
            ok = g[(g.demand > 0) & (g.official_fc > 0)]
            if len(ok) < 23:          # day not fully reported yet
                continue
            out.append({"date": f.stem, "ba": ba, "hours": len(ok),
                        "mape_ours": float(((ok.p50 - ok.demand).abs() / ok.demand).mean()),
                        "mape_official": float(((ok.official_fc - ok.demand).abs() / ok.demand).mean()),
                        "in_80": float(((ok.demand >= ok.p10) & (ok.demand <= ok.p90)).mean())})
    s = pd.DataFrame(out, columns=["date", "ba", "hours", "mape_ours", "mape_official", "in_80"])
    s.to_csv(FORECASTS / "live_scores.csv", index=False)
    return s


def main() -> None:
    from . import site_data
    eia = recent_eia()
    wx = live_weather()
    scores = score(eia)
    target = (pd.Timestamp.now(tz="UTC") + pd.Timedelta(days=1)).date()
    issue(target, eia, wx)
    site_data.build_live(eia, scores)
    try:                                   # the share image shows the latest live forecast; never let it block a forecast
        from . import og_image
        og_image.build()
    except Exception as e:  # noqa: BLE001
        print(f"share image not updated: {e}")


if __name__ == "__main__":
    main()
