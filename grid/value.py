"""Illustrative dollar value of forecast error.

Exact part:  energy mis-forecast = sum over scored hours of |forecast - actual| (MWh), annualised.
Illustrative part: x average 2026 on-peak wholesale price at the region's nearest trading hub
(EIA, ICE daily prices). Regions without a nearby hub use the all-hub average. This is the
*wholesale value of the energy mis-forecast*, not a full cost model (real costs depend on reserves,
balancing markets and timing), so the site labels it as an illustration.
"""
from pathlib import Path

import pandas as pd

from .config import CACHE

PRICE_FILE = CACHE / "prices" / "ice_electric-2026.xlsx"
PRICE_URL = "https://www.eia.gov/electricity/wholesale/xls/ice_electric-2026.xlsx"
HUB = {
    "PJM": "PJM WH Real Time Peak",
    "MISO": "Indiana Hub RT Peak",
    "ISNE": "Nepool MH DA LMP Peak",
    "CISO": ("SP15 EZ Gen DA LMP Peak", "NP15 EZ Gen DA LMP Peak"), "LDWP": "SP15 EZ Gen DA LMP Peak",
    "BANC": "NP15 EZ Gen DA LMP Peak",
    **{b: "Mid C Peak" for b in ("BPAT", "PGE", "PACW", "PSEI", "IPCO", "AVA")},
    **{b: "Palo Verde Peak" for b in ("AZPS", "SRP", "TEPC", "PNM", "NEVP")},
}


def hub_prices(path: Path = PRICE_FILE) -> tuple[dict, float]:
    if not path.exists():
        import subprocess
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sSfL", "--retry", "4", "--max-time", "300", "-o", str(path), PRICE_URL], check=True)
    x = pd.read_excel(path)
    col = [c for c in x.columns if "Wtd avg" in c][0]
    by_hub = x.groupby("Price hub")[col].mean().to_dict()
    return by_hub, float(x[col].mean())


def region_price(ba: str, by_hub: dict, fallback: float) -> tuple[float, str]:
    h = HUB.get(ba)
    if h is None:
        return fallback, "all-hub average"
    hubs = h if isinstance(h, tuple) else (h,)
    vals = [by_hub[x] for x in hubs if x in by_hub]
    return (sum(vals) / len(vals), " / ".join(hubs)) if vals else (fallback, "all-hub average")


def annual_value(d: pd.DataFrame, regions) -> pd.DataFrame:
    by_hub, fallback = hub_prices()
    rows = []
    for ba, g in d[d.ba.isin(regions)].groupby("ba"):
        price, src = region_price(ba, by_hub, fallback)
        scale = 8760 / len(g)                         # annualise from the hours actually scored
        e = {k: float((g[c] - g.demand).abs().sum()) * scale
             for k, c in (("mine", "p50"), ("official", "official_fc"), ("blend", "blend"))}
        rows.append({"ba": ba, "price": price, "hub": src,
                     **{f"gwh_{k}": v / 1000 for k, v in e.items()},
                     **{f"usd_{k}": v * price for k, v in e.items()}})
    return pd.DataFrame(rows)
