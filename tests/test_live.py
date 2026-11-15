"""The live record's guarantees: forecasts are issued on time, never overwritten, and scored fairly."""
import json

import numpy as np
import pandas as pd
import pytest

from grid import live, model
from grid.features import FEATURES

from .test_fairness import synthetic


class FakeBooster:
    """Predicts a constant ratio, so the test checks plumbing, not model quality."""
    def __init__(self, r): self.r = r

    def predict(self, X, pred_contrib=False):
        if pred_contrib:   # SHAP-style output: one column per feature + bias, rows sum to the prediction
            out = np.zeros((len(X), X.shape[1] + 1))
            out[:, -1] = self.r
            return out
        return np.full(len(X), self.r)


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(live, "FORECASTS", tmp_path)
    monkeypatch.setattr(model, "load", lambda _: {0.1: FakeBooster(0.9), 0.5: FakeBooster(1.0), 0.9: FakeBooster(1.1)})
    monkeypatch.setattr(live, "REGIONS", {"CISO": {"tz": "America/Los_Angeles"}})
    return tmp_path


def test_issue_writes_24_hours_with_ordered_quantiles(isolated):
    eia, wx = synthetic("CISO", days=60)
    out = live.issue(pd.Timestamp("2025-02-20").date(), eia, wx, now=pd.Timestamp("2025-02-19 12:05", tz="UTC"))
    assert len(out) == 24
    assert (out.p10 <= out.p50).all() and (out.p50 <= out.p90).all()
    assert (isolated / "2025-02-20.csv").exists()
    why = json.loads((isolated / "2025-02-20.why.json").read_text())["regions"]["CISO"]
    assert set(why["drivers"]) == {"Weather", "Day of week & holidays", "Recent demand trend", "Season"}
    assert why["avg_mw"] > 0 and 0 <= why["peak_hour"] <= 23


def test_issued_forecast_is_never_overwritten(isolated):
    eia, wx = synthetic("CISO", days=60)
    target = pd.Timestamp("2025-02-20").date()
    live.issue(target, eia, wx, now=pd.Timestamp("2025-02-19 12:05", tz="UTC"))
    before = (isolated / "2025-02-20.csv").read_text()
    eia2 = eia.assign(demand=eia.demand * 2)
    live.issue(target, eia2, wx, now=pd.Timestamp("2025-02-19 13:00", tz="UTC"))
    assert (isolated / "2025-02-20.csv").read_text() == before


def test_refuses_to_issue_after_the_day_has_started(isolated):
    eia, wx = synthetic("CISO", days=60)
    with pytest.raises(RuntimeError, match="Too late"):
        live.issue(pd.Timestamp("2025-02-20").date(), eia, wx, now=pd.Timestamp("2025-02-20 09:30", tz="UTC"))


def test_scoring_waits_for_a_fully_reported_day(isolated):
    eia, wx = synthetic("CISO", days=60)
    live.issue(pd.Timestamp("2025-02-20").date(), eia, wx, now=pd.Timestamp("2025-02-19 12:05", tz="UTC"))
    partial = eia[eia.ts < pd.Timestamp("2025-02-21 00:00", tz="UTC")]       # day not finished in EIA data
    assert live.score(partial).empty
    s = live.score(eia)
    assert len(s) == 1 and s.iloc[0].hours == 24
    assert 0 <= s.iloc[0].mape_ours < 1
