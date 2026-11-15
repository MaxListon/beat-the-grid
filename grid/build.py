"""Full offline build, in order. Run locally once (and again whenever you choose to refreeze):

    python -m grid.build            # EIA -> weather -> features -> backtest -> website -> frozen model

The frozen model is trained on ALL data up to the build date and saved to models/frozen/.
From then on the daily GitHub Action only uses it to predict; it never retrains or retunes.
"""
import json

import pandas as pd

from . import assets, backtest, eia, model, og_image, pages, site_data, weather
from .config import MODELS, PROCESSED
from .live import FROZEN


def freeze(feats: pd.DataFrame) -> None:
    last = feats.loc[feats.demand.notna(), "local_date"].max()
    models = model.fit(feats[feats.local_date <= last])
    model.save(models, FROZEN)
    (FROZEN / "FROZEN.json").write_text(json.dumps({
        "frozen_at_utc": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%MZ"),
        "trained_through_local_date": str(last.date()), "rows": int(len(feats)),
    }, indent=2))
    print(f"frozen model saved (trained through {last.date()})")


def main() -> None:
    eia.build()
    weather.build()
    feats = backtest.load_inputs()
    backtest.run(feats)
    summary = site_data.build_from_backtest()
    site_data.update_readme(summary)
    og_image.build()
    pages.main()          # inner pages + write-up page from WRITEUP.md
    assets.stamp()        # cache-busting stamps on CSS/JS
    print(json.dumps(summary["headline"], indent=2, default=str))
    freeze(feats)


if __name__ == "__main__":
    main()
