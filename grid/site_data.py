"""Write the JSON files the website reads (docs/data/).

build_from_backtest(): after a full backtest (local). Writes summary, leaderboard, breakdowns,
                       and forecasts/backtest_tail.csv (our backtest forecasts for the last weeks,
                       so the live chart has history on day one).
build_live(eia, scores): every day in GitHub Actions. Refreshes the 14-day chart series,
                       tomorrow's forecast and the live scoreboard.
"""
import json

import numpy as np
import pandas as pd

from .config import BACKTEST_START, FORECASTS, PROCESSED, SITE_DATA
from . import blend, misses, peaks, sql_data, value
from .evaluate import breakdowns, headline, leaderboard, scoreable
from .regions import REGIONS, region_points
from .stats import diebold_mariano

SERIES_DAYS = 30   # explorer offers 7 / 14 / 30-day views


def _dump(name: str, obj) -> None:
    (SITE_DATA / name).parent.mkdir(parents=True, exist_ok=True)

    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, (np.floating, float)):
            return None if not np.isfinite(o) else round(float(o), 6)
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return o
    (SITE_DATA / name).write_text(json.dumps(clean(obj), separators=(",", ":")))


def build_from_backtest() -> dict:
    bt = pd.read_parquet(PROCESSED / "backtest.parquet")
    d = blend.walk_forward(scoreable(bt))
    lb = leaderboard(d)
    head = headline(lb)
    head["excluded_suspect"] = lb.loc[lb.suspect_official, "ba"].tolist()
    br = breakdowns(d, lb)

    # Monthly error per region, for the leaderboard's mini trend lines
    monthly = (d.assign(m=pd.to_datetime(d.local_date).dt.to_period("M").astype(str))
                 .groupby(["ba", "m"])[["ape_ours", "ape_official"]].mean().reset_index())
    spark = {ba: [[r.m, round(r.ape_ours, 5), round(r.ape_official, 5)] for r in g.itertuples()]
             for ba, g in monthly.groupby("ba")}

    rows = []
    for r in lb.itertuples():
        pts = region_points(r.ba)                     # dot = population-weighted centre of its load centres
        wsum = sum(p[3] for p in pts)
        lat = sum(p[1] * p[3] for p in pts) / wsum
        lon = sum(p[2] * p[3] for p in pts) / wsum
        rows.append({**{k: getattr(r, k) for k in lb.columns}, "city": f"{lat:.1f},{lon:.1f}", "lat": lat, "lon": lon,
                     "monthly": spark.get(r.ba, [])})
    _dump("leaderboard.json", rows)
    _dump("regions_tz.json", {ba: r["tz"] for ba, r in REGIONS.items()})
    _dump("breakdowns.json", {k: v.to_dict(orient="records") for k, v in br.items()})
    fair_regions = lb.loc[~lb.suspect_official, "ba"]
    try:
        val = value.annual_value(d, fair_regions)
        tot = val[[c for c in val.columns if c.startswith(("gwh_", "usd_"))]].sum().to_dict()
        _dump("value.json", {"totals": tot, "regions": val.to_dict(orient="records"),
                             "price_source": "EIA wholesale market data (ICE), average 2026 on-peak price at the nearest hub"})
        head["value"] = tot
    except Exception as e:  # prices are a nice-to-have; never block the build on them
        print("value step skipped:", e)
    try:
        _dump("misses.json", misses.build(d, lb))
    except Exception as e:
        print("misses step skipped:", e)
    pk = peaks.contest(d, lb)
    _dump("peaks.json", pk)
    head["peaks"] = pk["headline"]
    sql_data.build(d, lb)
    lw = blend.latest_weights(d)
    _dump("blend.json", {"dayparts": blend.DAYPARTS,
                         "weights": {ba: {int(r.daypart): r.w_mine for r in g.itertuples()} for ba, g in lw.groupby("ba")}})

    summary = {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d %H:%M UTC"),
        "backtest": {"start": BACKTEST_START, "end": str(d.local_date.max().date()),
                     "days": int(d.local_date.nunique()), "hours_scored": int(len(d))},
        "headline": head,
        "model": model_info(),
    }
    _dump("summary.json", summary)

    # Our backtest forecasts for the recent past: chart history before the live log fills in
    tail_start = d.local_date.max() - pd.Timedelta(days=SERIES_DAYS + 7)
    tail = bt[bt.local_date >= tail_start][["ba", "ts", "p10", "p50", "p90"]].copy()
    tail["ts_utc"] = tail.pop("ts").dt.strftime("%Y-%m-%dT%H:%MZ")
    FORECASTS.mkdir(parents=True, exist_ok=True)
    tail.round(0).to_csv(FORECASTS / "backtest_tail.csv", index=False)
    return summary


def update_readme(summary: dict) -> None:
    """Write the headline + leaderboard into README.md between the RESULTS markers."""
    from .config import ROOT
    h, b = summary["headline"], summary["backtest"]
    lb = pd.DataFrame(json.loads((SITE_DATA / "leaderboard.json").read_text()))
    icon = {"win": "✅ Win", "loss": "❌ Loss", "tie": "➖ Tie"}
    rows = []
    for r in lb.sort_values("mean_mw", ascending=False).itertuples():
        verdict = "⚠️ Not scored (official data unreliable)" if r.suspect_official else icon[r.verdict]
        p = "<0.001" if r.p_holm < 0.001 else f"{r.p_holm:.3f}"
        rows.append(f"| {r.name} ({r.ba}) | {r.mean_mw / 1000:.1f} | {r.mape_ours * 100:.2f}% | {r.mape_official * 100:.2f}% | "
                    f"{r.mape_naive * 100:.2f}% | {p} | {verdict} |")
    block = "\n".join([
        f"## Results (backtest {b['start']} → {b['end']}, {b['hours_scored']:,} region-hours)",
        "",
        f"**My model beat the official day-ahead forecast in {h['wins']} of {h['regions_fair']} regions** "
        f"(Diebold-Mariano, Holm-corrected p < 0.05). {h['ties']} showed no significant difference and "
        f"{h['losses']} went to the official forecast. My error was lower in {h['lower_mape_count']} of {h['regions_fair']}.",
        "",
        f"| | Load-weighted hourly error (MAPE) |\n|---|---|\n| My model | **{h['load_weighted_mape_ours'] * 100:.2f}%** |"
        f"\n| Official forecasts | {h['load_weighted_mape_official'] * 100:.2f}% |\n| Average of both | {h['load_weighted_mape_combo'] * 100:.2f}% |",
        "",
        f"80% prediction interval coverage: {h['coverage_80'] * 100:.0f}%.",
        "",
        f"**Model + operator.** Blending my forecast with the official one, with weights learned walk-forward per region and time of day, "
        f"gives **{h['load_weighted_mape_blend'] * 100:.2f}%** error and beats the official forecast alone in "
        f"**{h['blend_beats_official']} of {h['regions_fair']}** regions"
        + (f" (strict set: {h['strict']['load_weighted_mape_blend'] * 100:.2f}% vs {h['strict']['load_weighted_mape_official'] * 100:.2f}%, "
           f"{h['strict']['blend_beats_official']} of {h['strict']['regions']})." if 'strict' in h else ".")
        + (f" Annualised, that is {h['value']['gwh_official'] / 1000:.0f} TWh of mis-forecast electricity for the official forecasts vs "
           f"{h['value']['gwh_blend'] / 1000:.0f} TWh blended, worth roughly ${(h['value']['usd_official'] - h['value']['usd_blend']) / 1e9:.1f} billion "
           f"a year at 2026 wholesale prices (an illustration of scale, not a cost estimate)." if 'value' in h else ""),
        "",
        f"**Strict check.** Limited to the {h['strict']['regions']} regions whose official forecast is clearly genuine "
        f"(median error ≤ {h['strict']['threshold'] * 100:.0f}%, {h['strict']['share_of_demand'] * 100:.0f}% of demand): "
        f"{h['strict']['wins']} wins, {h['strict']['losses']} losses, {h['strict']['ties']} ties; load-weighted error "
        f"{h['strict']['load_weighted_mape_ours'] * 100:.2f}% (mine) vs {h['strict']['load_weighted_mape_official'] * 100:.2f}% (official) "
        f"vs {h['strict']['load_weighted_mape_combo'] * 100:.2f}% (average of both).",
        "",
        "**Takeaway.** The operators win more regions (their best forecasts are within 1–2%). My model wins PJM, the largest "
        "US grid, and California, and has the lower demand-weighted error. Averaging the two beats either one: they make different mistakes.",
        "",
        "| Region | Avg GW | My MAPE | Official MAPE | Naive (last week) | p (Holm) | Result |",
        "|---|---:|---:|---:|---:|---:|---|",
        *rows,
    ])
    path = ROOT / "README.md"
    text = path.read_text()
    start, end = "<!-- RESULTS:START -->", "<!-- RESULTS:END -->"
    path.write_text(text.split(start)[0] + start + "\n" + block + "\n" + end + text.split(end)[1])


def model_info() -> dict:
    from .config import MODELS
    f = MODELS / "frozen" / "FROZEN.json"
    info = json.loads(f.read_text()) if f.exists() else {}
    return {"version": "v1", **info}


def _our_forecasts() -> pd.DataFrame:
    parts = []
    tail = FORECASTS / "backtest_tail.csv"
    if tail.exists():
        parts.append(pd.read_csv(tail).assign(source="backtest"))
    for f in sorted(FORECASTS.glob("20??-??-??.csv")):
        parts.append(pd.read_csv(f).assign(source="live"))
    df = pd.concat(parts, ignore_index=True)
    return df.sort_values("source").drop_duplicates(["ba", "ts_utc"], keep="last")   # live wins over backtest


def build_live(eia: pd.DataFrame, scores: pd.DataFrame) -> None:
    ours = _our_forecasts()
    now = pd.Timestamp.now(tz="UTC")
    start = now.floor("D") - pd.Timedelta(days=SERIES_DAYS)
    act = eia[eia.ts >= start].assign(ts_utc=lambda x: x.ts.dt.strftime("%Y-%m-%dT%H:%MZ"))
    # Compact format: one start time per region + evenly spaced hourly arrays (ints, null = missing)
    series = {}
    for ba in REGIONS:
        a = act[act.ba == ba][["ts_utc", "demand", "official_fc"]]
        o = ours[(ours.ba == ba) & (pd.to_datetime(ours.ts_utc) >= start)][["ts_utc", "p10", "p50", "p90", "source"]]
        m = a.merge(o, on="ts_utc", how="outer")
        if m.empty:
            continue
        m.index = pd.to_datetime(m.pop("ts_utc"))
        m = m.sort_index()
        m = m.reindex(pd.date_range(m.index.min(), m.index.max(), freq="h"))
        ints = lambda s: [None if pd.isna(v) else int(round(v)) for v in s]  # noqa: E731
        live_idx = np.flatnonzero((m.source == "live").to_numpy())
        series[ba] = {
            "t0": m.index[0].strftime("%Y-%m-%dT%H:%MZ"),
            "actual": ints(m.demand), "official": ints(m.official_fc),
            "p10": ints(m.p10), "p50": ints(m.p50), "p90": ints(m.p90),
            "live_from": int(live_idx[0]) if len(live_idx) else None,
        }
    # One small file per region, fetched only when a visitor opens that region
    for ba, obj in series.items():
        _dump(f"series/{ba}.json", obj)

    live = {"start_date": None, "days": 0, "regions": []}
    if len(scores):
        live["start_date"] = scores.date.min()
        live["days"] = int(scores.date.nunique())
        for ba, g in scores.groupby("ba"):
            stat, p = diebold_mariano(g.mape_ours.values, g.mape_official.values)
            live["regions"].append({"ba": ba, "days": len(g), "mape_ours": g.mape_ours.mean(),
                                    "mape_official": g.mape_official.mean(),
                                    "days_won": int((g.mape_ours < g.mape_official).sum()),
                                    "coverage_80": g.in_80.mean(), "p_value": p})
        live["by_day"] = daily_record(scores)
    issued = sorted(FORECASTS.glob("20??-??-??.csv"))
    live["latest_issued"] = issued[-1].stem if issued else None
    why = sorted(FORECASTS.glob("20??-??-??.why.json"))
    (SITE_DATA / "why.json").write_text(why[-1].read_text() if why else '{"target":null,"regions":{}}')
    live["forecasts_issued"] = len(issued)
    live["updated_at"] = now.strftime("%Y-%m-%d %H:%M UTC")
    _dump("live.json", live)
    write_sitemap(now.strftime("%Y-%m-%d"))


def daily_record(scores: pd.DataFrame) -> list[dict]:
    """One row per live day for the track-record calendar: demand-weighted error of both sides over the
    regions in the headline contest (same weights and exclusions as the backtest headline)."""
    lb = pd.DataFrame(json.loads((SITE_DATA / "leaderboard.json").read_text()))
    fair = lb[~lb.suspect_official].set_index("ba").mean_mw
    s = scores[scores.ba.isin(fair.index)].assign(w=lambda x: x.ba.map(fair))
    out = []
    for date, g in s.groupby("date"):
        w = g.w / g.w.sum()
        out.append({"date": date, "regions": int(len(g)), "regions_won": int((g.mape_ours < g.mape_official).sum()),
                    "mape_ours": float((g.mape_ours * w).sum()), "mape_official": float((g.mape_official * w).sum())})
    return out


SITE = "https://maxliston.github.io/beat-the-grid/"
LEGAL_UPDATED = "2026-11-15"


def write_sitemap(today: str) -> None:
    """The home page changes every day (new forecast); the legal pages rarely do."""
    urls = [(SITE, today, "daily", "1.0"), (SITE + "privacy.html", LEGAL_UPDATED, "yearly", "0.3"),
            (SITE + "terms.html", LEGAL_UPDATED, "yearly", "0.3")]
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{d}</lastmod><changefreq>{c}</changefreq><priority>{p}</priority></url>\n"
                   for u, d, c, p in urls)
    (SITE_DATA.parent / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")
