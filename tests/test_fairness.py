"""The rules that make the contest fair. If any of these fail, no result can be trusted."""
import numpy as np
import pandas as pd
import pytest

from grid.backtest import folds
from grid.features import FEATURES, build_region

FEATURE_COLS = [c for c in FEATURES if c != "ba_code"]


def synthetic(ba="CISO", days=60, seed=0):
    rng = np.random.default_rng(seed)
    ts = pd.date_range("2025-01-01 01:00", periods=24 * days, freq="h", tz="UTC")
    hour = ts.hour.values
    demand = 20_000 + 4_000 * np.sin((hour - 8) / 24 * 2 * np.pi) + rng.normal(0, 300, len(ts))
    eia = pd.DataFrame({"ba": ba, "ts": ts, "demand": demand, "official_fc": demand * 1.02})
    wx = pd.DataFrame({"ba": ba, "ts": ts, "temp": 15 + 5 * np.sin(hour / 24 * 2 * np.pi),
                       "dewpoint": 8.0, "cloud": 40.0, "wind": 3.0, "solar": np.clip(hour - 6, 0, None) * 50.0})
    return eia, wx


@pytest.mark.parametrize("ba", ["CISO", "PJM", "ERCO", "AZPS"])   # Pacific, Eastern, Central, no-DST
def test_features_never_see_demand_after_cutoff(ba):
    eia, wx = synthetic(ba)
    target = pd.Timestamp("2025-02-10")
    base = build_region(ba, eia, wx, target_days=pd.DatetimeIndex([target]))
    cutoff = base.cutoff.iloc[0]
    assert cutoff == pd.Timestamp("2025-02-09 06:00", tz="UTC")

    # Scramble every demand value after the cutoff: features for day D must not change at all
    tampered = eia.copy()
    after = tampered.ts > cutoff
    tampered.loc[after, "demand"] = tampered.loc[after, "demand"] * 7 + 12345
    again = build_region(ba, tampered, wx, target_days=pd.DatetimeIndex([target]))
    pd.testing.assert_frame_equal(base[FEATURE_COLS].reset_index(drop=True),
                                  again[FEATURE_COLS].reset_index(drop=True))


def test_target_day_is_the_local_calendar_day():
    eia, wx = synthetic("CISO")
    rows = build_region("CISO", eia, wx, target_days=pd.DatetimeIndex([pd.Timestamp("2025-02-10")]))
    assert len(rows) == 24
    # Pacific standard time: local hour 0 ends at 09:00 UTC, local hour 23 ends at 08:00 UTC next day
    assert rows.ts.min() == pd.Timestamp("2025-02-10 09:00", tz="UTC")
    assert rows.ts.max() == pd.Timestamp("2025-02-11 08:00", tz="UTC")
    assert sorted(rows.hour) == list(range(24))


def test_cutoff_is_before_issue_time_and_target_day():
    eia, wx = synthetic("PJM")
    rows = build_region("PJM", eia, wx, target_days=pd.DatetimeIndex([pd.Timestamp("2025-02-10")]))
    issue = pd.Timestamp("2025-02-09 12:00", tz="UTC")
    assert (rows.cutoff < issue).all()
    assert (rows.ts > issue).all()            # every forecast hour is in the future at issue time


def test_backtest_folds_train_only_on_the_past():
    blocks = list(folds(pd.Timestamp("2026-10-31")))
    assert blocks[0][0] == pd.Timestamp("2024-07-01")
    for (_, e1), (s2, _) in zip(blocks, blocks[1:], strict=False):
        assert e1 == s2                          # contiguous, no gaps or overlaps
    assert blocks[-1][1] == pd.Timestamp("2026-11-01")
