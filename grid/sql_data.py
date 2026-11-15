"""Tables for the website's "Query the data yourself" panel (DuckDB running in the visitor's browser).

Written as Parquet so the browser reads only the columns and row groups a query needs (HTTP range
requests), instead of downloading everything:

  hourly.parquet   every scored backtest hour (same rows as the headline numbers, glitch hours removed)
  regions.parquet  one row per region with its backtest result
  peaks.parquet    one row per region-day: actual vs forecast daily peak
"""
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import peaks
from .config import SITE_DATA
from .evaluate import STRICT_OFFICIAL_MEDIAN

OUT = SITE_DATA / "sql"


def _write(df: pd.DataFrame, name: str, dict_cols=("region",)) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(t, OUT / name, compression="zstd", compression_level=19,
                   use_dictionary=[c for c in dict_cols if c in df], row_group_size=50_000)


def build(d: pd.DataFrame, lb: pd.DataFrame) -> None:
    d = d.sort_values(["ba", "ts"])
    i32 = lambda s: s.round().astype("int32")  # noqa: E731
    _write(pd.DataFrame({
        "region": d.ba.astype(str).values, "hour_ending_utc": d.ts.values,
        "local_date": pd.to_datetime(d.local_date).dt.date.values, "local_hour": d.hour.astype("int8").values,
        "actual_mw": i32(d.demand).values, "official_mw": i32(d.official_fc).values, "ours_mw": i32(d.p50).values,
        "ours_low_mw": i32(d.p10).values, "ours_high_mw": i32(d.p90).values, "blend_mw": i32(d.blend).values,
    }), "hourly.parquet", dict_cols=("region", "local_date"))
    _write(pd.DataFrame({
        "region": lb.ba, "name": lb.name, "area": lb.area, "avg_demand_mw": lb.mean_mw.round(0),
        "in_headline": ~lb.suspect_official, "in_strict_check": lb.median_official <= STRICT_OFFICIAL_MEDIAN,
        "result": lb.verdict.where(~lb.suspect_official, "not scored"),
        "error_ours": lb.mape_ours, "error_official": lb.mape_official, "error_blend": lb.mape_blend,
        "p_value_holm": lb.p_holm, "hours": lb.hours,
    }), "regions.parquet")
    p = peaks.daily_peaks(d)
    _write(pd.DataFrame({
        "region": p.ba.astype(str), "local_date": pd.to_datetime(p.local_date).dt.date,
        "actual_peak_mw": p.a.round(0).astype("int32"), "actual_peak_hour": p.h_a.astype("int8"),
        "ours_peak_mw": p.ours.round(0).astype("int32"), "ours_peak_hour": p.h_ours.astype("int8"),
        "official_peak_mw": p.official.round(0).astype("int32"), "official_peak_hour": p.h_official.astype("int8"),
    }), "peaks.parquet")
    print("sql tables:", ", ".join(f"{f.name} {f.stat().st_size / 1e6:.1f} MB" for f in sorted(OUT.glob("*.parquet"))))
