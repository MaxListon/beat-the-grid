"""Score the backtest: per-region accuracy, significance, and where/when the model wins.

Rows are scored only where actual demand, the official forecast AND our forecast all exist,
so both sides are judged on exactly the same hours.

Glitch rule (symmetric): an hour where EITHER forecast is more than 50% off is treated as a data
glitch (a zero or a spike in the reported demand or forecast) and dropped for BOTH sides. These are
reporting errors, not forecasting skill. The share of hours dropped is reported per region.
"""
import numpy as np
import pandas as pd

from .regions import REGIONS
from .stats import diebold_mariano, holm

SUSPECT_OFFICIAL_MEDIAN = 0.10   # median official error above this = reporting mismatch, not a forecast (set before scoring)
STRICT_OFFICIAL_MEDIAN = 0.05    # robustness check: only regions whose official forecast is clearly a real one
GLITCH_APE = 0.50


def scoreable(bt: pd.DataFrame) -> pd.DataFrame:
    m = (bt.demand > 0) & (bt.official_fc > 0) & bt.p50.notna()
    d = bt[m].copy()
    d["ape_ours"] = (d.p50 - d.demand).abs() / d.demand
    d["ape_official"] = (d.official_fc - d.demand).abs() / d.demand
    d["ae_ours"] = (d.p50 - d.demand).abs()
    d["ae_official"] = (d.official_fc - d.demand).abs()
    d["combo"] = (d.p50 + d.official_fc) / 2
    d["ape_combo"] = (d.combo - d.demand).abs() / d.demand
    d["in_80"] = (d.demand >= d.p10) & (d.demand <= d.p90)
    if "naive" in d:
        d["ape_naive"] = (d.naive - d.demand).abs() / d.demand
    glitch = (d.ape_ours > GLITCH_APE) | (d.ape_official > GLITCH_APE)
    d.attrs["glitch_share"] = glitch.groupby(d.ba).mean().to_dict()
    d.attrs["glitch_hours"] = int(glitch.sum())
    return d[~glitch]


def leaderboard(d: pd.DataFrame) -> pd.DataFrame:
    rows, pvals = [], {}
    for ba, g in d.groupby("ba"):
        daily = g.groupby("local_date")[["ape_ours", "ape_official"]].mean()
        stat, p = diebold_mariano(daily.ape_ours.values, daily.ape_official.values)
        pvals[ba] = p
        rows.append({
            "ba": ba, "name": REGIONS[ba]["name"], "area": REGIONS[ba]["short"],
            "mean_mw": g.demand.mean(), "hours": len(g), "days": len(daily),
            "mape_ours": g.ape_ours.mean(), "mape_official": g.ape_official.mean(),
            "mape_combo": g.ape_combo.mean(),
            "mape_blend": g.ape_blend.mean() if "ape_blend" in g else float("nan"),
            "mape_naive": g.ape_naive.mean() if "ape_naive" in g else float("nan"),
            "mae_ours": g.ae_ours.mean(), "mae_official": g.ae_official.mean(),
            "coverage_80": g.in_80.mean(), "dm_stat": stat, "p_value": p,
            "win_days": float((daily.ape_ours < daily.ape_official).mean()),
            "median_official": g.ape_official.median(), "median_ours": g.ape_ours.median(),
            "glitch_share": d.attrs.get("glitch_share", {}).get(ba, 0.0),
        })
    lb = pd.DataFrame(rows)
    adj = holm(pvals)
    lb["p_holm"] = lb.ba.map(adj)
    lb["improvement"] = 1 - lb.mape_ours / lb.mape_official          # + = we are more accurate
    lb["suspect_official"] = lb.median_official > SUSPECT_OFFICIAL_MEDIAN
    lb["verdict"] = np.select(
        [(lb.p_holm < 0.05) & (lb.dm_stat < 0), (lb.p_holm < 0.05) & (lb.dm_stat > 0)],
        ["win", "loss"], "tie")
    return lb.sort_values("mean_mw", ascending=False, ignore_index=True)


def _summary(sub: pd.DataFrame) -> dict:
    w = sub.mean_mw / sub.mean_mw.sum()
    return {
        "regions": int(len(sub)),
        "wins": int((sub.verdict == "win").sum()),
        "losses": int((sub.verdict == "loss").sum()),
        "ties": int((sub.verdict == "tie").sum()),
        "lower_mape_count": int((sub.mape_ours < sub.mape_official).sum()),
        "load_weighted_mape_ours": float((sub.mape_ours * w).sum()),
        "load_weighted_mape_official": float((sub.mape_official * w).sum()),
        "load_weighted_mape_combo": float((sub.mape_combo * w).sum()),
        "load_weighted_mape_blend": float((sub.mape_blend * w).sum()),
        "blend_beats_official": int((sub.mape_blend < sub.mape_official).sum()),
        "share_of_demand": float(sub.mean_mw.sum()),
    }


def headline(lb: pd.DataFrame) -> dict:
    fair = lb[~lb.suspect_official]
    strict = lb[lb.median_official <= STRICT_OFFICIAL_MEDIAN]
    h = _summary(fair)
    total_mw = lb.mean_mw.sum()
    h.update({
        "regions_total": int(len(lb)),
        "regions_fair": h["regions"],
        "excluded_suspect": lb.loc[lb.suspect_official, "ba"].tolist(),
        "median_improvement": float(fair.improvement.median()),
        "coverage_80": float(fair.coverage_80.mean()),
        "fair_share_of_demand": h["share_of_demand"] / total_mw,
        "strict": {**_summary(strict), "share_of_demand": float(strict.mean_mw.sum() / total_mw),
                   "threshold": STRICT_OFFICIAL_MEDIAN},
    })
    return h


def breakdowns(d: pd.DataFrame, lb: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """When do we win? By local hour, by month, and on extreme-demand days.

    Uses the STRICT set (official median error <= 5%) so regions with weak official numbers can't
    tilt the averages in my favour.
    """
    fair = d[d.ba.isin(lb.loc[lb.median_official <= STRICT_OFFICIAL_MEDIAN, "ba"])]
    by_hour = fair.groupby("hour")[["ape_ours", "ape_official"]].mean().reset_index()
    by_month = (fair.assign(month=pd.to_datetime(fair.local_date).dt.to_period("M").astype(str))
                .groupby("month")[["ape_ours", "ape_official"]].mean().reset_index())
    # extreme days: each region's top/bottom 5% of daily demand
    daily = fair.groupby(["ba", "local_date"]).agg(dem=("demand", "mean"), ours=("ape_ours", "mean"),
                                                   off=("ape_official", "mean")).reset_index()
    q = daily.groupby("ba").dem.transform(lambda s: s.rank(pct=True))
    daily["day_type"] = np.select([q >= 0.95, q <= 0.05], ["Busiest 5% of days", "Quietest 5% of days"], "All other days")
    by_daytype = daily.groupby("day_type")[["ours", "off"]].mean().reset_index().rename(
        columns={"ours": "ape_ours", "off": "ape_official"})
    return {"by_hour": by_hour, "by_month": by_month, "by_daytype": by_daytype}
