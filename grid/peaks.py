"""The peak contest: who calls each day's highest hour better?

Operators care most about the daily peak, because that's when the last, most expensive plants run.
For each region-day with at least 23 scored hours we compare:
  * peak size:  |forecast daily max - actual daily max| / actual daily max
  * peak timing: does the forecast's highest hour fall within 1 hour of the actual highest hour?

Our peak is simply the highest hour of the hourly forecast. A dedicated daily-peak model was tried
(walk-forward, tuned on the never-scored Apr-Jun 2024 window) and was less accurate (3.60% vs 3.26%
load-weighted), so it was not adopted.
"""
import numpy as np
import pandas as pd

from .stats import diebold_mariano, holm

MIN_HOURS = 23


def daily_peaks(d: pd.DataFrame) -> pd.DataFrame:
    n = d.groupby(["ba", "local_date"]).size()
    keep = n[n >= MIN_HOURS].index
    d = d.set_index(["ba", "local_date"]).loc[keep].reset_index()
    out = None
    for col, name in [("demand", "a"), ("p50", "ours"), ("official_fc", "official"), ("blend", "blend")]:
        if col not in d:
            continue
        idx = d.groupby(["ba", "local_date"])[col].idxmax()
        part = d.loc[idx, ["ba", "local_date", col, "hour"]].rename(columns={col: name, "hour": "h_" + name})
        out = part if out is None else out.merge(part, on=["ba", "local_date"])
    for s in ("ours", "official", "blend"):
        if s in out:
            out["e_" + s] = (out[s] - out.a).abs() / out.a
            out["hit_" + s] = (out["h_" + s] - out.h_a).abs() <= 1
    return out


def contest(d: pd.DataFrame, lb: pd.DataFrame) -> dict:
    p = daily_peaks(d)
    rows, pv = [], {}
    for ba, g in p.groupby("ba"):
        stat, pval = diebold_mariano(g.e_ours.values, g.e_official.values)
        pv[ba] = pval
        rows.append({"ba": ba, "days": len(g), "peak_ours": g.e_ours.mean(), "peak_official": g.e_official.mean(),
                     "peak_blend": g.e_blend.mean() if "e_blend" in g else None,
                     "hit_ours": g.hit_ours.mean(), "hit_official": g.hit_official.mean(), "dm": stat})
    r = pd.DataFrame(rows)
    r["p_holm"] = r.ba.map(holm(pv))
    r["verdict"] = np.select([(r.p_holm < 0.05) & (r.dm < 0), (r.p_holm < 0.05) & (r.dm > 0)], ["win", "loss"], "tie")
    meta = lb.set_index("ba")[["name", "area", "mean_mw", "suspect_official"]]
    r = r.join(meta, on="ba").sort_values("mean_mw", ascending=False)
    fair = r[~r.suspect_official]
    w = fair.mean_mw / fair.mean_mw.sum()
    head = {
        "regions": int(len(fair)), "wins": int((fair.verdict == "win").sum()),
        "losses": int((fair.verdict == "loss").sum()), "ties": int((fair.verdict == "tie").sum()),
        "peak_ours": float((fair.peak_ours * w).sum()), "peak_official": float((fair.peak_official * w).sum()),
        "peak_blend": float((fair.peak_blend * w).sum()),
        "hit_ours": float((fair.hit_ours * w).sum()), "hit_official": float((fair.hit_official * w).sum()),
        "blend_beats_official": int((fair.peak_blend < fair.peak_official).sum()),
        "days": int(fair.days.sum()),
        "peak_model_tried": {"peak_model": 0.0360, "hourly_max": 0.0326,
                             "note": "Dedicated daily-peak model, walk-forward; less accurate, not adopted."},
    }
    return {"headline": head, "regions": r.drop(columns=["dm"]).to_dict(orient="records")}
