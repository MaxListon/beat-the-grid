import numpy as np
import pandas as pd

from grid import peaks, storms


def _ev(point, begin, end):
    return pd.DataFrame({"point": [point], "kind": ["HU"], "begin": [pd.Timestamp(begin, tz="UTC")],
                         "end": [pd.Timestamp(end, tz="UTC")]})


def _erco(ev, day):
    f = storms.region_features(ev, pd.DatetimeIndex([pd.Timestamp(day)]))
    return f[f.ba == "ERCO"].iloc[0]


def test_warning_beginning_after_issue_time_is_not_used():
    # Forecast for Jul 9 is issued at 12:00 UTC Jul 8; a warning that begins at 12:01 must be invisible.
    r = _erco(_ev("Houston", "2024-07-08 12:01", "2024-07-09 12:00"), "2024-07-09")
    assert r.storm_now == 0 and r.storm_recent == 0


def test_warning_in_effect_at_issue_time_is_used_and_weighted():
    r = _erco(_ev("Houston", "2024-07-07 06:00", "2024-07-09 00:00"), "2024-07-09")
    assert 0 < r.storm_now < 1          # one of four ERCOT cities, population-weighted
    assert r.storm_recent == 0


def test_recent_window():
    assert _erco(_ev("Houston", "2024-07-06 00:00", "2024-07-07 00:00"), "2024-07-09").storm_recent > 0   # ended 36 h before
    assert _erco(_ev("Houston", "2024-07-01 00:00", "2024-07-02 00:00"), "2024-07-09").storm_recent == 0  # ended > 72 h before


def test_daily_peaks():
    hours = np.arange(24)
    d = pd.DataFrame({"ba": "X", "local_date": pd.Timestamp("2025-01-01"), "hour": hours,
                      "demand": 100 + hours, "p50": 100 + hours * 0.5, "official_fc": 100 + (hours == 20) * 50.0,
                      "blend": 100.0 + hours})
    p = peaks.daily_peaks(d).iloc[0]
    assert p.a == 123 and p.h_a == 23
    assert p.h_ours == 23 and p.hit_ours
    assert p.h_official == 20 and not p.hit_official
    assert abs(p.e_official - abs(150 - 123) / 123) < 1e-9


def test_days_with_missing_hours_are_skipped():
    d = pd.DataFrame({"ba": "X", "local_date": pd.Timestamp("2025-01-01"), "hour": range(20),
                      "demand": 100.0, "p50": 100.0, "official_fc": 100.0, "blend": 100.0})
    assert peaks.daily_peaks(d).empty
