import numpy as np
import pandas as pd

from grid.weather import weight_regions


def test_missing_weather_stays_missing_not_zero():
    ts = pd.date_range("2023-06-01", periods=3, freq="h", tz="UTC")
    pts = pd.concat([
        pd.DataFrame({"ts": ts, "point": "Tampa", "temp": [30.0, 31.0, 32.0], "dewpoint": np.nan,
                      "cloud": np.nan, "wind": np.nan, "solar": np.nan}),
    ])
    out = weight_regions(pts)
    tec = out[out.ba == "TEC"].set_index("ts")
    assert tec.temp.tolist() == [30.0, 31.0, 32.0]
    assert tec[["dewpoint", "cloud", "wind", "solar"]].isna().all().all()


def test_weighted_average_uses_population_weights():
    ts = pd.date_range("2025-06-01", periods=1, freq="h", tz="UTC")
    # NEVP = Las Vegas only; ERCO = Dallas 7.9, Houston 7.3, San Antonio 2.6 (top 3)
    rows = [("Dallas", 30.0), ("Houston", 20.0), ("San Antonio", 10.0)]
    pts = pd.DataFrame([{"ts": ts[0], "point": p, "temp": t, "dewpoint": 1.0, "cloud": 0.0, "wind": 0.0, "solar": 0.0}
                        for p, t in rows])
    erco = weight_regions(pts).query("ba == 'ERCO'").iloc[0]
    expected = (30 * 7.9 + 20 * 7.3 + 10 * 2.6) / (7.9 + 7.3 + 2.6)
    assert abs(erco.temp - expected) < 1e-4
