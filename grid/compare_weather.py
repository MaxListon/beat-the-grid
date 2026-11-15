"""Decide between weather built from 3 vs 5 cities per region, on the never-scored tuning window.

Same model settings, same rows; only the weather inputs differ. Train on target days <= 2024-03-30,
score Apr-Jun 2024 (the backtest starts 2024-07-01, so this choice can't leak into reported results).
"""
import pandas as pd

from . import model
from .config import PROCESSED
from .features import build_all


def score(weather_file: str, eia: pd.DataFrame) -> pd.Series:
    feats = build_all(eia, pd.read_parquet(PROCESSED / weather_file))
    train = feats[feats.local_date <= pd.Timestamp("2024-03-30")]
    val = feats[(feats.local_date >= pd.Timestamp("2024-04-01")) & (feats.local_date < pd.Timestamp("2024-07-01"))]
    val = val[(val.demand > 0) & val.level168.notna()]
    m = model.fit(train)
    pred = model.predict(m, val).p50
    ape = (pred - val.demand).abs() / val.demand
    return ape.groupby(val.ba).mean()


def main() -> None:
    eia = pd.read_parquet(PROCESSED / "eia.parquet")
    a, b = score("weather.parquet", eia), score("weather_5pts.parquet", eia)
    r = pd.DataFrame({"3_cities": a, "5_cities": b})
    r["better"] = r["5_cities"] < r["3_cities"]
    print(r.round(4).to_string())
    print(f"\nmean over regions: 3 cities {a.mean():.4f}, 5 cities {b.mean():.4f}; "
          f"5 cities better in {int(r.better.sum())} of {len(r)} regions")


if __name__ == "__main__":
    main()
