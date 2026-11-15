import numpy as np
import pandas as pd

from grid import blend


def _bt(folds=3, n=400, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(folds):
        dem = 1000 + rng.normal(0, 30, n)
        rows.append(pd.DataFrame({"ba": "PJM", "fold": k, "hour": np.tile(range(24), n // 24 + 1)[:n], "demand": dem,
                                  "p50": dem * (1 + rng.normal(0, 0.01, n)),           # mine: accurate
                                  "official_fc": dem * (1 + rng.normal(0, 0.05, n))}))  # official: noisy
    return pd.concat(rows, ignore_index=True)


def test_first_quarter_is_a_plain_average():
    d = blend.walk_forward(_bt())
    f0 = d[d.fold == 0]
    np.testing.assert_allclose(f0.blend, (f0.p50 + f0.official_fc) / 2)


def test_learns_to_trust_the_better_forecast():
    w = blend.fit_weights(_bt())
    assert all(v >= 0.8 for v in w.values())


def test_weights_never_use_the_quarter_being_scored():
    d = _bt()
    # Make quarter 2 the opposite (official perfect, mine noisy): its own weights would favour official,
    # but quarter 2 must be blended with weights learned from quarters 0-1, which favour mine.
    q2 = d.fold == 2
    d.loc[q2, "official_fc"] = d.loc[q2, "demand"]
    out = blend.walk_forward(d)
    q = out[out.fold == 2]
    w_used = (q.blend - q.official_fc) / (q.p50 - q.official_fc)
    assert w_used.dropna().median() >= 0.8
