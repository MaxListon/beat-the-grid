"""'Model + operator': how much should a grid operator trust my forecast next to its own?

forecast = w * mine + (1 - w) * official, with one weight w per (region, part of day).

Walk-forward like everything else: the weights used for backtest quarter k are learned only from
quarters < k (my forecasts there are themselves out-of-sample). Quarter 0 has no history and uses
w = 0.5, a plain average. Weights are chosen to minimise mean absolute percentage error.

This is not a contest entry (the operator's forecast may be published after my issue time); it
answers a different question: how much would an operator gain by adding this model to its own?
"""
import numpy as np
import pandas as pd

GRID = np.round(np.arange(0, 1.0001, 0.05), 2)
DAYPARTS = {0: "Night (12–6 am)", 1: "Morning (6 am–12 pm)", 2: "Afternoon (12–6 pm)", 3: "Evening (6 pm–12 am)"}
MIN_ROWS = 300


def daypart(hour: pd.Series) -> pd.Series:
    return (hour // 6).astype(int)


def best_weight(g: pd.DataFrame) -> float:
    a, m, o = g.demand.to_numpy(), g.p50.to_numpy(), g.official_fc.to_numpy()
    errs = [np.mean(np.abs(w * m + (1 - w) * o - a) / a) for w in GRID]
    return float(GRID[int(np.argmin(errs))])


def fit_weights(hist: pd.DataFrame) -> dict:
    """{(ba, daypart): w}, falling back to the region-wide weight, then 0.5, when data is thin."""
    hist = hist.assign(dp=daypart(hist.hour))
    out = {}
    region_w = {ba: best_weight(g) for ba, g in hist.groupby("ba") if len(g) >= MIN_ROWS}
    for (ba, dp), g in hist.groupby(["ba", "dp"]):
        out[(ba, dp)] = best_weight(g) if len(g) >= MIN_ROWS else region_w.get(ba, 0.5)
    for ba, w in region_w.items():
        for dp in DAYPARTS:
            out.setdefault((ba, dp), w)
    return out


def apply(d: pd.DataFrame, weights: dict) -> np.ndarray:
    w = np.array([weights.get((b, p), 0.5) for b, p in zip(d.ba, daypart(d.hour))])
    return w * d.p50.to_numpy() + (1 - w) * d.official_fc.to_numpy()


def walk_forward(d: pd.DataFrame) -> pd.DataFrame:
    """Add a 'blend' column, each quarter blended with weights learned only from earlier quarters."""
    d = d.copy()
    d["blend"] = np.nan
    for k in sorted(d.fold.unique()):
        cur = d.fold == k
        hist = d[d.fold < k]
        weights = fit_weights(hist) if len(hist) else {}
        d.loc[cur, "blend"] = apply(d[cur], weights)
    d["ape_blend"] = (d.blend - d.demand).abs() / d.demand
    return d


def latest_weights(d: pd.DataFrame) -> pd.DataFrame:
    """Weights learned from the whole backtest: what an operator would use today."""
    w = fit_weights(d)
    return pd.DataFrame([{"ba": b, "daypart": p, "w_mine": v} for (b, p), v in w.items()])
