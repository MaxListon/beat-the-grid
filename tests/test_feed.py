"""The RSS feed of the live record must be valid XML with one item per forecast and per scored day."""
import json
import xml.etree.ElementTree as ET

from grid import site_data


def test_feed_lists_forecasts_and_scores(tmp_path, monkeypatch):
    data, fc = tmp_path / "data", tmp_path / "forecasts"
    data.mkdir(); fc.mkdir()
    (data / "leaderboard.json").write_text(json.dumps([{"ba": "PJM", "name": "PJM Interconnection", "mean_mw": 90000, "suspect_official": False}]))
    (fc / "2026-11-17.csv").write_text("issued_at_utc,ba,ts_utc,local_hour,p10,p50,p90\n2026-11-16T14:50Z,PJM,2026-11-17T06:00Z,0,1,2,3\n")
    (fc / "2026-11-17.why.json").write_text(json.dumps({"target": "2026-11-17", "regions": {"PJM": {
        "avg_mw": 97917.0, "peak_mw": 108790.0, "peak_hour": 7, "vs_last_week": 0.08}}}))
    monkeypatch.setattr(site_data, "SITE_DATA", data)
    monkeypatch.setattr(site_data, "FORECASTS", fc)
    site_data.write_feed({"by_day": [{"date": "2026-11-17", "regions": 31, "regions_won": 20, "mape_ours": 0.03, "mape_official": 0.035}]})
    root = ET.parse(tmp_path / "feed.xml").getroot()
    items = root.findall("./channel/item")
    assert [i.findtext("guid") for i in items] == ["score-2026-11-17", "forecast-2026-11-17"]
    assert "PJM peak 109 GW around 7:00" in items[1].findtext("title")
    assert "my model closer" in items[0].findtext("title")
