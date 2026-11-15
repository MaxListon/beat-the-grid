"""Draw docs/og.png (1200x630), the image shown when the site is shared, from the real results."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .config import SITE_DATA

W, H = 1200, 630
BG, INK, INK2, BLUE, ORANGE, GOLD = "#0d0d0d", "#f0efec", "#c3c2b7", "#3987e5", "#d95926", "#fab219"
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(size: int, bold: bool = True):
    order = FONT_CANDIDATES if bold else FONT_CANDIDATES[1::2] + FONT_CANDIDATES[0::2]
    for p in order:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build() -> Path:
    s = json.loads((SITE_DATA / "summary.json").read_text())
    h = s["headline"]
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    # bolt mark
    k = 1.1
    d.rounded_rectangle([64, 60, 64 + 70 * k, 60 + 70 * k], radius=16, fill="#1c5cab")
    d.polygon([(64 + 40 * k, 60 + 7 * k), (64 + 15 * k, 60 + 40 * k), (64 + 31 * k, 60 + 40 * k),
               (64 + 26 * k, 60 + 64 * k), (64 + 55 * k, 60 + 29 * k), (64 + 40 * k, 60 + 29 * k), (64 + 44 * k, 60 + 7 * k)], fill=GOLD)
    d.text((160, 70), "Beat the Grid", font=font(44), fill=INK)
    d.text((160, 122), "An open model vs. US grid operators' day-ahead forecasts", font=font(26, False), fill=INK2)

    d.text((64, 210), f"{h['wins']} of {h['regions_fair']}", font=font(150), fill=INK)
    d.text((64, 385), "grid regions where my model beat the official forecast", font=font(34, False), fill=INK2)
    d.text((64, 428), f"Lost {h['losses']}, tied {h['ties']} · statistically tested, Holm-corrected", font=font(24, False), fill=INK2)

    y = 515
    d.line([(64, y - 20), (W - 64, y - 20)], fill="#2c2c2a", width=2)
    items = [("My error", f"{h['load_weighted_mape_ours'] * 100:.2f}%", BLUE),
             ("Official error", f"{h['load_weighted_mape_official'] * 100:.2f}%", ORANGE),
             ("Hours scored", f"{s['backtest']['hours_scored'] / 1e6:.2f}M", INK2)]
    x = 64
    for label, val, col in items:
        d.rounded_rectangle([x, y + 8, x + 14, y + 22], radius=7, fill=col)
        d.text((x + 24, y), label, font=font(22, False), fill=INK2)
        d.text((x + 24, y + 30), val, font=font(40), fill=INK)
        x += 360
    out = SITE_DATA.parent / "og.png"
    im = im.quantize(colors=64, method=Image.Quantize.MEDIANCUT)   # flat graphic -> small palette PNG
    im.save(out, optimize=True)
    return out


if __name__ == "__main__":
    p = build()
    print(p, p.stat().st_size, "bytes")
