"""Forecast-comparison statistics.

Diebold-Mariano test on *daily* loss differentials (one value per day = mean absolute
percentage error ours minus official). Daily aggregation removes intraday correlation; the
Newey-West variance handles the remaining day-to-day correlation. Harvey, Leybourne & Newbold
(1997) small-sample correction, Student-t reference distribution. Holm correction across regions.
"""
from math import erf, sqrt

import numpy as np


def _t_sf(t: float, df: int) -> float:
    """Two-sided p-value for Student t (df large here, so use a normal approx beyond df>200)."""
    if df > 200:
        return 2 * (1 - 0.5 * (1 + erf(abs(t) / sqrt(2))))
    from scipy.stats import t as tdist  # only needed for short samples
    return float(2 * tdist.sf(abs(t), df))


def newey_west_var(d: np.ndarray, lags: int) -> float:
    d = d - d.mean()
    n = len(d)
    v = np.dot(d, d) / n
    for k in range(1, lags + 1):
        w = 1 - k / (lags + 1)
        v += 2 * w * np.dot(d[k:], d[:-k]) / n
    return v


def diebold_mariano(loss_a: np.ndarray, loss_b: np.ndarray, lags: int = 7) -> tuple[float, float]:
    """Test H0: equal expected loss. Returns (DM statistic, two-sided p). Negative stat = A better."""
    d = np.asarray(loss_a, float) - np.asarray(loss_b, float)
    d = d[~np.isnan(d)]
    n = len(d)
    if n < 30:
        return float("nan"), float("nan")
    var = newey_west_var(d, lags) / n
    if var <= 0:
        return float("nan"), float("nan")
    dm = d.mean() / sqrt(var)
    h = 1  # one-step (one day) ahead
    hln = sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    stat = dm * hln
    return float(stat), _t_sf(stat, n - 1)


def holm(pvals: dict[str, float]) -> dict[str, float]:
    """Holm-Bonferroni adjusted p-values (family-wise error control across regions)."""
    items = sorted(((p, k) for k, p in pvals.items() if p == p), key=lambda x: x[0])
    m, out, running = len(items), {}, 0.0
    for i, (p, k) in enumerate(items):
        running = max(running, min(1.0, (m - i) * p))
        out[k] = running
    for k in pvals:
        out.setdefault(k, float("nan"))
    return out


def mape(actual, pred) -> float:
    a, p = np.asarray(actual, float), np.asarray(pred, float)
    m = (a > 0) & ~np.isnan(p)
    return float(np.mean(np.abs(p[m] - a[m]) / a[m]))
