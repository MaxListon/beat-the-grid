"""Storm signal: archived National Weather Service warnings, as an outage-risk input.

The model's worst backtest days were hurricanes: the weather forecast was right, but power was cut,
so demand collapsed. Warnings for hurricanes, tropical storms, storm surge, extreme wind and ice
storms are public before the storm hits, so they can be used without breaking the issue-time rule.

Fairness: for a forecast issued at T (12:00 UTC on D-1) only warnings whose event had begun by T
are used (a warning that begins later may have been published after T). Two features per region,
each a population-weighted share of the region's cities:
  storm_now     a qualifying warning is in effect at T (the storm is arriving or overhead)
  storm_recent  a qualifying warning ended in the 72 hours before T (the storm just passed:
                outages and restoration typically last days)

EXPERIMENT ONLY: not an input to the frozen live model (see grid/storm_experiment.py and the write-up).
History: Iowa Environmental Mesonet VTEC archive (by point).
"""
import json
import subprocess
import time

import numpy as np
import pandas as pd

from .config import CACHE, ISSUE_HOUR_UTC, PROCESSED
from .regions import REGIONS

IEM = "https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat={lat}&lon={lon}&sdate={s}&edate={e}"
PHENOMENA = {"HU", "TR", "SS", "EW", "IS"}      # hurricane, tropical storm, storm surge, extreme wind, ice storm
RECENT_H = 72
STORM_FEATURES = ["storm_now", "storm_recent"]


def all_points() -> dict[str, tuple[float, float]]:
    pts = {}
    for r in REGIONS.values():
        for name, lat, lon, _ in r["points"]:
            pts.setdefault(name, (lat, lon))
    return pts


def _get(url: str) -> dict:
    for attempt in range(4):
        r = subprocess.run(["curl", "-s", "--max-time", "120", url], capture_output=True, text=True)
        try:
            return json.loads(r.stdout)
        except json.JSONDecodeError:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def download(start="2022-01-01", end=None) -> pd.DataFrame:
    end = end or pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d")
    folder = CACHE / "storms"
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, (lat, lon) in all_points().items():
        f = folder / f"{name.replace(' ', '_').replace('.', '')}_{start}_{end}.json"
        if not f.exists():
            f.write_text(json.dumps(_get(IEM.format(lat=lat, lon=lon, s=start, e=end))))
            time.sleep(1.0)
        for e in json.loads(f.read_text())["events"]:
            if e["phenomena"] in PHENOMENA and e["significance"] == "W":
                rows.append({"point": name, "kind": e["phenomena"], "begin": e["issue"], "end": e["expire"]})
    ev = pd.DataFrame(rows)
    ev["begin"] = pd.to_datetime(ev.begin, utc=True)
    ev["end"] = pd.to_datetime(ev.end, utc=True)
    return ev


def region_features(ev: pd.DataFrame, target_days: pd.DatetimeIndex) -> pd.DataFrame:
    """One row per (ba, local_date): population-weighted share of cities under each signal."""
    out = []
    issue = pd.DatetimeIndex(target_days - pd.Timedelta(days=1)).tz_localize("UTC") + pd.Timedelta(hours=ISSUE_HOUR_UTC)
    for ba, r in REGIONS.items():
        w = np.array([p[3] for p in r["points"]], float)
        w = w / w.sum()
        now = np.zeros(len(issue))
        recent = np.zeros(len(issue))
        for (name, *_), wt in zip(r["points"], w, strict=True):
            e = ev[ev.point == name]
            if e.empty:
                continue
            b, en = e.begin.dt.tz_convert(None).to_numpy()[None, :], e.end.dt.tz_convert(None).to_numpy()[None, :]
            T = issue.tz_convert(None).to_numpy()[:, None]
            now += wt * ((b <= T) & (en > T)).any(axis=1)
            recent += wt * ((b <= T) & (en <= T) & (en > T - np.timedelta64(RECENT_H, "h"))).any(axis=1)
        out.append(pd.DataFrame({"ba": ba, "local_date": target_days, "storm_now": now, "storm_recent": recent}))
    return pd.concat(out, ignore_index=True)


def build() -> pd.DataFrame:
    ev = download()
    days = pd.date_range("2022-01-01", pd.Timestamp.now().normalize() + pd.Timedelta(days=2), freq="D")
    f = region_features(ev, days)
    f.to_parquet(PROCESSED / "storms.parquet", index=False)
    print(f"storm features: {len(ev)} warnings, {(f.storm_now > 0).sum()} region-days with a storm in effect, "
          f"{(f.storm_recent > 0).sum()} just after one")
    return f


if __name__ == "__main__":
    build()
