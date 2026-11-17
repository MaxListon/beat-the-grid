"""Choose model settings on a window that is NEVER scored: train < 2024-04-01, validate Apr-Jun 2024.

The backtest starts 2024-07-01, so nothing here can leak into the reported results.
Prints validation MAPE for a small grid of settings; the winner goes into model.py by hand.
"""
import itertools

import pandas as pd

from . import model
from .config import PROCESSED

GRID = {
    "num_leaves": [63, 127],
    "learning_rate": [0.05],
    "min_data_in_leaf": [200],
}
ROUNDS = [400, 800, 1200, 1600]


def main() -> None:
    feats = pd.read_parquet(PROCESSED / "features.parquet")
    train = feats[feats.local_date <= pd.Timestamp("2024-03-30")]
    val = feats[(feats.local_date >= pd.Timestamp("2024-04-01")) & (feats.local_date < pd.Timestamp("2024-07-01"))]
    val = val[(val.demand > 0) & val.level168.notna()]
    tr = model.clean_train(train)
    import lightgbm as lgb

    from .features import FEATURES, TARGET
    ds = lgb.Dataset(tr[FEATURES], tr[TARGET], categorical_feature=["ba_code"], free_raw_data=False)
    results = []
    for nl, lr, md in itertools.product(*GRID.values()):
        p = {**model.BASE_PARAMS, "num_leaves": nl, "learning_rate": lr, "min_data_in_leaf": md, "objective": "l1"}
        booster = lgb.train(p, ds, num_boost_round=max(ROUNDS))
        for r in ROUNDS:
            pred = booster.predict(val[FEATURES], num_iteration=r) * val.level168
            mape = ((pred - val.demand).abs() / val.demand).groupby(val.ba).mean().mean()   # mean over regions
            results.append({"num_leaves": nl, "lr": lr, "min_leaf": md, "rounds": r, "val_mape": mape})
            print(results[-1], flush=True)
    res = pd.DataFrame(results).sort_values("val_mape")
    res.to_csv(PROCESSED / "tuning.csv", index=False)
    print(res.head(10).to_string())


if __name__ == "__main__":
    main()
