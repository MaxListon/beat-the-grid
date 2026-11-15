"""Walk-forward backtest: retrain every quarter on the past only, forecast the next quarter.

For a test block starting on day F, the model trains on target days <= F-2. Day F-1 is not
fully observed when the forecast for F is issued (12:00 UTC on F-1), so it is excluded.

Output: data/processed/backtest.parquet  (ba, ts, local_date, hour, demand, official_fc, p10, p50, p90, fold)
"""
import time

import pandas as pd

from . import model
from .config import BACKTEST_START, PROCESSED, RETRAIN_EVERY_MONTHS
from .features import build_all


def load_inputs() -> pd.DataFrame:
    eia = pd.read_parquet(PROCESSED / "eia.parquet")
    wx = pd.read_parquet(PROCESSED / "weather.parquet")
    feats = build_all(eia, wx)
    feats.to_parquet(PROCESSED / "features.parquet", index=False)
    return feats


def folds(last_day: pd.Timestamp):
    start = pd.Timestamp(BACKTEST_START)
    while start <= last_day:
        end = start + pd.DateOffset(months=RETRAIN_EVERY_MONTHS)
        yield start, min(end, last_day + pd.Timedelta(days=1))
        start = end


def run(feats: pd.DataFrame | None = None) -> pd.DataFrame:
    feats = load_inputs() if feats is None else feats
    last_day = feats.loc[feats.demand.notna(), "local_date"].max()
    out = []
    for i, (start, end) in enumerate(folds(last_day)):
        t0 = time.time()
        train = feats[feats.local_date <= start - pd.Timedelta(days=2)]
        test = feats[(feats.local_date >= start) & (feats.local_date < end)].copy()
        models = model.fit(train)
        test[["p10", "p50", "p90"]] = model.predict(models, test)
        test["naive"] = test.r_lag7d * test.level168           # "same hour last week" baseline
        test["fold"] = i
        out.append(test[["ba", "ts", "local_date", "hour", "demand", "official_fc", "p10", "p50", "p90", "naive", "fold"]])
        print(f"fold {i}: train <= {(start - pd.Timedelta(days=2)).date()} ({len(train):,} rows), "
              f"test {start.date()}..{(end - pd.Timedelta(days=1)).date()} ({len(test):,}) "
              f"in {time.time() - t0:.0f}s", flush=True)
    bt = pd.concat(out, ignore_index=True)
    bt.to_parquet(PROCESSED / "backtest.parquet", index=False)
    return bt


if __name__ == "__main__":
    run()
