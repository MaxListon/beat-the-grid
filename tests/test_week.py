"""The weekly summary and the backtest range the live chart is drawn against."""
import json

import pandas as pd

from grid import site_data


def _scores(n_days):
    rows = []
    for i in range(n_days):
        d = f"2026-12-{i + 1:02d}"
        rows += [{"date": d, "ba": "PJM", "hours": 24, "mape_ours": 0.02, "mape_official": 0.03, "in_80": 0.8},
                 {"date": d, "ba": "ERCO", "hours": 24, "mape_ours": 0.05 if i == 1 else 0.03, "mape_official": 0.02, "in_80": 0.8}]
    return pd.DataFrame(rows)


def _site(tmp_path, monkeypatch):
    (tmp_path / "leaderboard.json").write_text(json.dumps([
        {"ba": "PJM", "mean_mw": 90000, "suspect_official": False},
        {"ba": "ERCO", "mean_mw": 50000, "suspect_official": False},
        {"ba": "XXX", "mean_mw": 1000, "suspect_official": True}]))
    monkeypatch.setattr(site_data, "SITE_DATA", tmp_path)
    monkeypatch.setattr(site_data, "FORECASTS", tmp_path)


def test_no_summary_before_three_days(tmp_path, monkeypatch):
    _site(tmp_path, monkeypatch)
    assert site_data.weekly_summary(_scores(2)) is None


def test_summary_uses_last_seven_days_and_finds_the_worst_miss(tmp_path, monkeypatch):
    _site(tmp_path, monkeypatch)
    w = site_data.weekly_summary(_scores(10))
    assert (w["start"], w["end"], w["days"]) == ("2026-12-04", "2026-12-10", 7)
    assert w["regions_won"] == 1 and w["regions"] == 2 and w["best"]["ba"] == "PJM"
    assert w["worst"]["ba"] == "ERCO"            # the 5% miss on Dec 2 is outside the window
    assert w["worst"]["mape_ours"] == 0.03
    ours = (0.02 * 90000 + 0.03 * 50000) / 140000
    assert abs(w["mape_ours"] - ours) < 1e-12 and w["days_won"] == 7


def test_backtest_range_is_ordered(tmp_path, monkeypatch):
    _site(tmp_path, monkeypatch)
    (tmp_path / "sql").mkdir()
    rows = [{"region": r, "local_date": pd.Timestamp("2026-01-01") + pd.Timedelta(days=d), "actual_mw": 100.0,
             "official_mw": 103.0, "ours_mw": 100.0 + d % 5} for r in ("PJM", "ERCO") for d in range(20) for _ in range(24)]
    pd.DataFrame(rows).to_parquet(tmp_path / "sql" / "hourly.parquet")
    r = site_data.backtest_daily_range()
    assert r["days"] == 20 and r["ours"]["p10"] <= r["ours"]["p50"] <= r["ours"]["p90"]
    assert abs(r["official"]["p50"] - 0.03) < 1e-12 and r["share_days_won"] == 0.6
