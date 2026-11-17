"""Storm-warning experiment (not used by the live model). Run: python -m grid.storms, then python -m grid.storm_experiment.

Part 1 reruns the walk-forward backtest (point model only) with the two storm inputs added.
Part 2 compares it with the main backtest: overall, on storm hours, and on the hurricane days.
"""
import time

import lightgbm as lgb
import pandas as pd

from . import model
from .backtest import folds
from .evaluate import headline, leaderboard, scoreable
from .features import FEATURES, TARGET

F2 = FEATURES + ["storm_now", "storm_recent"]
feats = pd.read_parquet("data/processed/features.parquet")
st = pd.read_parquet("data/processed/storms.parquet")
feats = feats.merge(st, on=["ba", "local_date"], how="left")
feats[["storm_now", "storm_recent"]] = feats[["storm_now", "storm_recent"]].fillna(0)
last = feats.loc[feats.demand.notna(), "local_date"].max()
out = []
for i, (s, e) in enumerate(folds(last)):
    t0 = time.time()
    tr = model.clean_train(feats[feats.local_date <= s - pd.Timedelta(days=2)])
    te = feats[(feats.local_date >= s) & (feats.local_date < e)].copy()
    m = lgb.train({**model.BASE_PARAMS, "objective": "l1"}, lgb.Dataset(tr[F2], tr[TARGET], categorical_feature=["ba_code"]), model.N_ROUNDS)
    te["p50_storm"] = m.predict(te[F2]) * te.level168
    out.append(te[["ba", "ts", "p50_storm"]])
    print(i, round(time.time() - t0), flush=True)
pd.concat(out).to_parquet("data/processed/backtest_storm.parquet", index=False)

# ---- Part 2: compare
bt = pd.read_parquet("data/processed/backtest.parquet")
s = pd.read_parquet("data/processed/backtest_storm.parquet")
st = pd.read_parquet("data/processed/storms.parquet")
b2 = bt.merge(s, on=["ba", "ts"])
base = leaderboard(scoreable(b2))
h0 = headline(base)
b3 = b2.assign(p50=b2.p50_storm)
new = leaderboard(scoreable(b3))
h1 = headline(new)
for k in ["wins", "losses", "ties", "load_weighted_mape_ours", "load_weighted_mape_official"]:
    print(k, h0[k], "->", h1[k])
fair = base.loc[~base.suspect_official, "ba"]
m = base.set_index("ba").mape_ours.reindex(fair)
n = new.set_index("ba").mape_ours.reindex(fair)
print("regions improved:", (n < m).sum(), "of", len(fair))
# storm days only
d = b2.merge(st, on=["ba", "local_date"], how="left")
d = d[(d.demand > 0)]
storm = (d.storm_now > 0) | (d.storm_recent > 0)
for name, mask in [("storm days", storm), ("other days", ~storm)]:
    x = d[mask]
    e0 = (x.p50 - x.demand).abs() / x.demand
    e1 = (x.p50_storm - x.demand).abs() / x.demand
    print(name, len(x), "hours: before", round(e0.mean() * 100, 2), "after", round(e1.mean() * 100, 2))
# worst days
WORST = [("FPL", "2024-10-10"), ("DUK", "2024-09-28"), ("SCEG", "2024-09-27"), ("ERCO", "2024-07-08"), ("ERCO", "2024-07-09"),
         ("FPL", "2024-10-11"), ("TEC", "2024-10-10")]
for ba, day in WORST:
    x = d[(d.ba == ba) & (d.local_date == day)]
    if len(x):
        err = lambda col: round(((x[col] - x.demand).abs() / x.demand).mean() * 100, 1)  # noqa: E731, B023
        print(ba, day, "before", err("p50"), "after", err("p50_storm"), "official", err("official_fc"))
