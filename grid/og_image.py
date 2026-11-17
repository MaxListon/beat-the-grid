"""Draw the share images from the real results and the latest live forecast:

  docs/og.png                 1200x630, shown when the site link is shared
  .github/media/social.png    1280x640, for GitHub's repository social preview (uploaded by hand in Settings)

Left: the question and the headline numbers. Right: the site's hero chart (PJM, the largest US grid: the last
three days plus tomorrow's live forecast). Drawn at 2x and scaled down so lines and text are smooth.
"""
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .config import SITE_DATA

ROOT = SITE_DATA.parent.parent
BG, PANEL, GRID, INK, INK2, MUTED = "#0e1520", "#151e2b", "#253043", "#f0efec", "#c0c6cf", "#9aa3ae"
BLUE, BAND, ORANGE, LIVE, GOLD = "#3f8deb", "#22416a", "#e5662f", "#16243a", "#fab219"
FONTS = [  # (path, index) for bold, then regular
    [("/System/Library/Fonts/HelveticaNeue.ttc", 1), ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
     ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0)],
    [("/System/Library/Fonts/HelveticaNeue.ttc", 0), ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
     ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0)],
]


def font(size: float, bold: bool = True):
    for path, idx in FONTS[0 if bold else 1]:
        if Path(path).exists():
            return ImageFont.truetype(path, round(size), index=idx)
    return ImageFont.load_default()


def _series(hours_before: int = 72) -> dict:
    s = json.loads((SITE_DATA / "series" / "PJM.json").read_text())
    t0 = datetime.strptime(s["t0"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    live = s["live_from"] if s["live_from"] is not None else len(s["actual"])
    a = max(0, live - hours_before)
    pick = lambda k: s[k][a:]  # noqa: E731
    return {"t": [t0 + timedelta(hours=a + i) for i in range(len(s["actual"]) - a)], "live": live - a,
            **{k: pick(k) for k in ("actual", "official", "p10", "p50", "p90")}}


def _chart(d: ImageDraw.ImageDraw, box, k: float) -> None:
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=18 * k, fill=PANEL, outline=GRID, width=round(2 * k))
    d.text((x0 + 28 * k, y0 + 22 * k), "PJM Interconnection", font=font(24 * k), fill=INK)
    d.text((x0 + 28 * k, y0 + 54 * k), "Largest US grid · last 3 days + tomorrow's live forecast", font=font(16 * k, False), fill=MUTED)
    s = _series()
    n = len(s["t"])
    vals = [v for key in ("actual", "official", "p10", "p90") for v in s[key] if v is not None]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad, hi + pad
    px0, px1, py0, py1 = x0 + 28 * k, x1 - 28 * k, y0 + 96 * k, y1 - 50 * k
    X = lambda i: px0 + (px1 - px0) * i / (n - 1)  # noqa: E731
    Y = lambda v: py1 - (py1 - py0) * (v - lo) / (hi - lo)  # noqa: E731
    # tomorrow's shading + label
    d.rectangle([X(s["live"]), py0, px1, py1], fill=LIVE)
    d.text((X(s["live"]) + 10 * k, py0 + 6 * k), "Tomorrow (live)", font=font(15 * k, False), fill=INK2)
    for g in range(1, 4):
        y = py0 + (py1 - py0) * g / 4
        d.line([(px0, y), (px1, y)], fill=GRID, width=max(1, round(k)))
    # day labels at local (Eastern) midnight; series timestamps mark the END of each hour
    for i, t in enumerate(s["t"]):
        local = (t - timedelta(hours=1)).astimezone(ZoneInfo("America/New_York"))
        if local.hour == 0:
            d.text((X(i), py1 + 12 * k), local.strftime("%b %-d"), font=font(14 * k, False), fill=MUTED, anchor="mt")
    # 80% range: one polygon per unbroken stretch, so a gap (e.g. a voided day) stays empty
    idx = [i for i in range(n) if s["p10"][i] is not None and s["p90"][i] is not None]
    runs, cur = [], []
    for i in idx:
        if cur and i != cur[-1] + 1:
            runs.append(cur); cur = []
        cur.append(i)
    runs.append(cur)
    for r in runs:
        if len(r) > 1:
            d.polygon([(X(i), Y(s["p90"][i])) for i in r] + [(X(i), Y(s["p10"][i])) for i in reversed(r)], fill=BAND)

    def line(key, color, width):
        seg = []
        for i, v in enumerate(s[key]):
            if v is None:
                if len(seg) > 1:
                    d.line(seg, fill=color, width=round(width * k), joint="curve")
                seg = []
            else:
                seg.append((X(i), Y(v)))
        if len(seg) > 1:
            d.line(seg, fill=color, width=round(width * k), joint="curve")
    line("official", ORANGE, 2.5)
    line("actual", INK, 2.5)
    line("p50", BLUE, 3)


def draw(w: int, h: int) -> Image.Image:
    s = json.loads((SITE_DATA / "summary.json").read_text())
    hd = s["headline"]
    k = 2 * w / 1200                      # draw at 2x, scale down at the end
    W, H = round(w * 2), round(h * 2)
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    m = 60 * k
    # brand
    b = 52 * k
    d.rounded_rectangle([m, m, m + b, m + b], radius=12 * k, fill="#1c5cab")
    pts = [(.57, .10), (.21, .57), (.44, .57), (.37, .91), (.79, .41), (.57, .41), (.63, .10)]
    d.polygon([(m + x * b, m + y * b) for x, y in pts], fill=GOLD)
    d.text((m + b + 16 * k, m + 8 * k), "Beat the Grid", font=font(30 * k), fill=INK)
    # the question
    y = m + b + 44 * k
    for line_ in ("Can an open model", "out-forecast America's", "grid operators?"):
        d.text((m, y), line_, font=font(46 * k), fill=INK)
        y += 56 * k
    # numbers
    y += 26 * k
    stats = [(f"{hd['load_weighted_mape_ours'] * 100:.2f}%", "my error", BLUE),
             (f"{hd['load_weighted_mape_official'] * 100:.2f}%", "official error", ORANGE)]
    x = m
    for val, label, col in stats:
        d.text((x, y), val, font=font(40 * k), fill=INK)
        d.ellipse([x, y + 58 * k, x + 12 * k, y + 70 * k], fill=col)
        d.text((x + 20 * k, y + 54 * k), label, font=font(18 * k, False), fill=INK2)
        x += 200 * k
    y += 96 * k
    d.text((m, y), f"Weighted by demand · {hd['wins']} wins, {hd['losses']} losses, {hd['ties']} ties in {hd['regions_fair']} regions",
           font=font(17 * k, False), fill=MUTED)
    d.text((m, y + 28 * k), "Live: a new forecast every day, published before the day begins", font=font(17 * k, False), fill=MUTED)
    # chart panel on the right
    _chart(d, (W * 0.535, m - 4 * k, W - m, H - m), k)
    return im.resize((w, h), Image.LANCZOS)


def build() -> list[Path]:
    out = []
    for size, path in (((1200, 630), SITE_DATA.parent / "og.png"), ((1280, 640), ROOT / ".github" / "media" / "social.png")):
        path.parent.mkdir(parents=True, exist_ok=True)
        draw(*size).quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
        out.append(path)
    return out


if __name__ == "__main__":
    for p in build():
        print(p, p.stat().st_size // 1024, "KB")
