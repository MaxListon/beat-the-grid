import numpy as np
import pandas as pd
import pytest

from grid.evaluate import leaderboard, scoreable
from grid.stats import diebold_mariano, holm, mape, newey_west_var


def test_newey_west_with_no_lags_is_the_variance():
    x = np.array([1.0, 3.0, 2.0, 5.0, 4.0])
    assert newey_west_var(x, 0) == pytest.approx(np.var(x))


def test_dm_detects_a_clearly_better_forecast():
    rng = np.random.default_rng(1)
    a = np.abs(rng.normal(0.02, 0.005, 400))
    b = a + 0.01
    stat, p = diebold_mariano(a, b)
    assert stat < 0 and p < 1e-6


def test_dm_finds_nothing_between_equal_forecasts():
    rng = np.random.default_rng(2)
    a, b = np.abs(rng.normal(0.03, 0.01, (2, 500)))
    _, p = diebold_mariano(a, b)
    assert p > 0.01


def test_dm_needs_enough_days():
    assert np.isnan(diebold_mariano(np.ones(10), np.zeros(10))[1])


def test_holm_matches_hand_calculation():
    adj = holm({"a": 0.01, "b": 0.04, "c": 0.03})
    # sorted 0.01, 0.03, 0.04 -> 3*0.01=0.03, 2*0.03=0.06, max(0.06, 1*0.04)=0.06
    assert adj == pytest.approx({"a": 0.03, "c": 0.06, "b": 0.06})


def test_mape():
    assert mape([100, 200], [110, 180]) == pytest.approx(0.10)


def _fake_backtest(ba, ours_err, off_err, days=200, seed=0):
    rng = np.random.default_rng(seed)
    n = days * 24
    dem = 1000 + rng.normal(0, 50, n)
    return pd.DataFrame({
        "ba": ba, "ts": pd.date_range("2025-01-01", periods=n, freq="h", tz="UTC"),
        "local_date": np.repeat(pd.date_range("2025-01-01", periods=days), 24), "hour": np.tile(range(24), days),
        "demand": dem,
        "p50": dem * (1 + rng.normal(0, ours_err, n)), "official_fc": dem * (1 + rng.normal(0, off_err, n)),
        "p10": dem * 0.95, "p90": dem * 1.05,
    })


def test_leaderboard_verdicts_and_suspect_flag():
    bt = pd.concat([_fake_backtest("PJM", 0.01, 0.03, seed=1),     # we are much better
                    _fake_backtest("MISO", 0.03, 0.01, seed=2),    # official much better
                    _fake_backtest("TVA", 0.02, 0.02, seed=3),     # equal
                    _fake_backtest("FPC", 0.02, 0.30, seed=4)])    # official broken
    lb = leaderboard(scoreable(bt)).set_index("ba")
    assert lb.loc["PJM", "verdict"] == "win"
    assert lb.loc["MISO", "verdict"] == "loss"
    assert lb.loc["TVA", "verdict"] == "tie"
    assert lb.loc["FPC", "suspect_official"] and not lb.loc["PJM", "suspect_official"]
    assert lb.loc["PJM", "coverage_80"] == pytest.approx(1.0, abs=0.05)


def test_hours_missing_either_forecast_are_not_scored():
    bt = _fake_backtest("PJM", 0.01, 0.02, days=40)
    bt.loc[:9, "official_fc"] = np.nan
    bt.loc[10:19, "p50"] = np.nan
    assert len(scoreable(bt)) == len(bt) - 20
