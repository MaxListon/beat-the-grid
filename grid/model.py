"""One global LightGBM model across all regions, plus quantile models for an 80% interval.

Objective is L1 on the demand ratio, i.e. the model minimises *relative* absolute error, so
small regions count as much as PJM.
"""
import json

import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import QUANTILES
from .features import FEATURES, TARGET

BASE_PARAMS = dict(
    learning_rate=0.05, num_leaves=127, min_data_in_leaf=200, feature_fraction=0.8,
    bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, max_bin=255, verbose=-1, seed=7,
    num_threads=0,
)
N_ROUNDS = 800           # chosen on the never-scored Apr-Jun 2024 window (grid/tune.py, data/processed/tuning.csv)


def clean_train(df: pd.DataFrame) -> pd.DataFrame:
    """Drop rows whose target is missing or clearly a reporting glitch."""
    ok = df[TARGET].between(0.2, 3.0) & df["r_lag7d"].notna()
    return df[ok]


QUANTILE_PARAMS = dict(num_leaves=31, min_data_in_leaf=1000)   # interval models: deliberately simpler
CALIB_DAYS = 91
INTERVAL = 0.8


def fit(df: pd.DataFrame, n_rounds: int = N_ROUNDS, params: dict | None = None) -> dict:
    """Point model on all training data + conformalized quantile regression (CQR) for the 80% range.

    The quantile models are fitted on all but the last CALIB_DAYS of training data; on those held-out
    days we measure how far actual demand falls outside the raw range and widen it per region by the
    amount that achieves 80% coverage (Romano, Patterson & Candes 2019).
    """
    df = clean_train(df)
    p = {**BASE_PARAMS, **(params or {})}
    ds = lgb.Dataset(df[FEATURES], df[TARGET], categorical_feature=["ba_code"], free_raw_data=False)
    models = {0.5: lgb.train({**p, "objective": "l1"}, ds, num_boost_round=n_rounds)}

    split = df.local_date.max() - pd.Timedelta(days=CALIB_DAYS)
    fit_q, cal = df[df.local_date <= split], df[df.local_date > split]
    dq = lgb.Dataset(fit_q[FEATURES], fit_q[TARGET], categorical_feature=["ba_code"], free_raw_data=False)
    for q in (0.1, 0.9):
        models[q] = lgb.train({**p, **QUANTILE_PARAMS, "objective": "quantile", "alpha": q}, dq,
                              num_boost_round=max(300, n_rounds // 3))
    lo, hi = models[0.1].predict(cal[FEATURES]), models[0.9].predict(cal[FEATURES])
    score = np.maximum(lo - cal[TARGET].values, cal[TARGET].values - hi)
    s = pd.Series(score, index=cal.ba_code.values)
    level = lambda x: np.quantile(x, min(1.0, np.ceil((len(x) + 1) * INTERVAL) / len(x)))  # noqa: E731
    models["cqr"] = {int(k): float(level(v.values)) for k, v in s.groupby(level=0)}
    models["cqr_default"] = float(level(score))
    return models


def predict(models: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Forecast in MW. Quantiles are sorted so p10 <= p50 <= p90 always holds."""
    X = df[FEATURES]
    adj = df["ba_code"].map(models.get("cqr", {})).fillna(models.get("cqr_default", 0.0)).values
    raw = np.column_stack([models[0.1].predict(X) - adj, models[0.5].predict(X), models[0.9].predict(X) + adj])
    raw = raw * df["level168"].values[:, None]
    raw.sort(axis=1)
    return pd.DataFrame(raw, columns=["p10", "p50", "p90"], index=df.index)


def save(models: dict, folder) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for q in QUANTILES:
        models[q].save_model(str(folder / f"q{int(q * 100):02d}.txt"))
    (folder / "cqr.json").write_text(json.dumps({"by_region": models["cqr"], "default": models["cqr_default"]}))


def load(folder) -> dict:
    m = {q: lgb.Booster(model_file=str(folder / f"q{int(q * 100):02d}.txt")) for q in QUANTILES}
    c = json.loads((folder / "cqr.json").read_text())
    m["cqr"] = {int(k): v for k, v in c["by_region"].items()}
    m["cqr_default"] = c["default"]
    return m
