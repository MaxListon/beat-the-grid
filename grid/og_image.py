"""Draw the share images from the real results and the latest live forecast, in the site's own style:

  docs/og.png                 1200x630, shown when the site link is shared
  .github/media/social.png    1280x640, for GitHub's repository social preview (uploaded by hand in Settings)

Left: the question and the headline numbers. Right: the site's hero chart (PJM, the largest US grid: the last
three days plus the live forecast). Drawn at 2x and scaled down so lines and text are smooth.

Fonts are the site's own (docs/fonts), converted to TTF on first use; that needs `pip install fonttools brotli`
(local build only). Without it, system fonts are used.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

from .config import CACHE, SITE_DATA

ROOT = SITE_DATA.parent.parent
FONT_DIR = SITE_DATA.parent / "fonts"
PAPER, SURFACE, INK, INK2, MUTED, GRID, RULE = "#f4f0e6", "#faf8f2", "#191612", "#48423a", "#655e53", "#dcd4c3", "#ece6d8"
BLUE, BAND, ORANGE, LIVE, VOLT, HL = "#2a6fd0", "#d3dff0", "#e2612a", "#e6ebf2", "#f5c518", "#f8de86"
FALLBACK = {"serif": "/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "serif-italic": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
            "sans": "/System/Library/Fonts/Supplemental/Arial.ttf", "mono": "/System/Library/Fonts/Menlo.ttc"}


def _site_fonts() -> dict:
    """TTF copies of the site's fonts (PIL can't read WOFF2), cached; {} if fontTools isn't installed."""
    out = CACHE / "fonts"
    want = {"serif": ("newsreader-latin-wght-normal.woff2", 600), "serif-italic": ("newsreader-latin-wght-italic.woff2", 500),
            "sans": ("ibm-plex-sans-latin-400-normal.woff2", None), "mono": ("ibm-plex-mono-latin-500-normal.woff2", None)}
    paths = {k: out / f"{k}.ttf" for k in want}
    if all(p.exists() for p in paths.values()):
        return paths
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError:
        return {}
    out.mkdir(parents=True, exist_ok=True)
    for k, (src, wght) in want.items():
        f = TTFont(FONT_DIR / src)
        f.flavor = None
        if wght:
            f = instantiateVariableFont(f, {"wght": wght})
        f.save(paths[k])
    return paths


FONTS = {}


def font(kind: str, size: float):
    if not FONTS:
        FONTS.update({k: str(v) for k, v in _site_fonts().items()} or FALLBACK)
    try:
        return ImageFont.truetype(FONTS[kind], round(size))
    except OSError:
        return ImageFont.load_default()


def _series(hours_before: int = 72) -> dict:
    s = json.loads((SITE_DATA / "series" / "PJM.json").read_text())
    t0 = datetime.strptime(s["t0"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    live = s["live_from"] if s["live_from"] is not None else len(s["actual"])
    a = max(0, live - hours_before)
    return {"t": [t0 + timedelta(hours=a + i) for i in range(len(s["actual"]) - a)], "live": live - a,
            **{k: s[k][a:] for k in ("actual", "official", "p10", "p50", "p90")}}


def _chart(d: ImageDraw.ImageDraw, box, k: float) -> None:
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=SURFACE, outline=GRID, width=round(1.5 * k))
    d.rectangle([x0, y0, x1, y0 + 3 * k], fill=INK)                      # the site's ink rule on top of every card
    d.text((x0 + 26 * k, y0 + 22 * k), "PJM Interconnection", font=font("serif", 25 * k), fill=INK)
    d.text((x0 + 26 * k, y0 + 56 * k), "Largest US grid · last 3 days + the live forecast", font=font("sans", 15 * k), fill=MUTED)
    s = _series()
    n = len(s["t"])
    vals = [v for key in ("actual", "official", "p10", "p90") for v in s[key] if v is not None]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad, hi + pad
    px0, px1, py0, py1 = x0 + 26 * k, x1 - 26 * k, y0 + 112 * k, y1 - 46 * k
    X = lambda i: px0 + (px1 - px0) * i / (n - 1)  # noqa: E731
    Y = lambda v: py1 - (py1 - py0) * (v - lo) / (hi - lo)  # noqa: E731
    d.rectangle([X(s["live"]), py0, px1, py1], fill=LIVE)
    d.text((px1, py0 - 8 * k), "live forecast", font=font("serif-italic", 17 * k), fill=INK, anchor="rb")
    for g in range(0, 5):
        y = py0 + (py1 - py0) * g / 4
        d.line([(px0, y), (px1, y)], fill=RULE if g < 4 else GRID, width=max(1, round(k)))
    for i, t in enumerate(s["t"]):                                       # day labels at Eastern midnight (timestamps end the hour)
        local = (t - timedelta(hours=1)).astimezone(ZoneInfo("America/New_York"))
        if local.hour == 0:
            d.text((X(i), py1 + 12 * k), local.strftime("%b %-d"), font=font("mono", 13 * k), fill=MUTED, anchor="mt")
    idx = [i for i in range(n) if s["p10"][i] is not None and s["p90"][i] is not None]
    runs, cur = [], []
    for i in idx:                                                        # 80% range, one polygon per unbroken stretch
        if cur and i != cur[-1] + 1:
            runs.append(cur)
            cur = []
        cur.append(i)
    runs.append(cur)
    for r in runs:
        if len(r) > 1:
            d.polygon([(X(i), Y(s["p90"][i])) for i in r] + [(X(i), Y(s["p10"][i])) for i in reversed(r)], fill=BAND)

    def line(key, color, width):
        seg = []
        for i, v in enumerate(s[key] + [None]):
            if v is None:
                if len(seg) > 1:
                    d.line(seg, fill=color, width=round(width * k), joint="curve")
                seg = []
            else:
                seg.append((X(i), Y(v)))
    line("official", ORANGE, 2.5)
    line("actual", INK, 2.5)
    line("p50", BLUE, 3)
    # legend along the bottom-left of the plot
    lx, ly = px0, y0 + 84 * k
    for label, col in (("Actual", INK), ("My forecast", BLUE), ("Official", ORANGE)):
        d.line([(lx, ly + 8 * k), (lx + 18 * k, ly + 8 * k)], fill=col, width=round(3 * k))
        d.text((lx + 24 * k, ly), label, font=font("sans", 14 * k), fill=INK2)
        lx += 24 * k + d.textlength(label, font=font("sans", 14 * k)) + 22 * k


def _bezier(p0, p1, p2, p3, n=40):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b_ + 3 * (1 - t) * t ** 2 * c + t ** 3 * e
                  for a, b_, c, e in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def _mark(d: ImageDraw.ImageDraw, x: float, y: float, size: float) -> None:
    """The logo (docs/favicon.svg): two forecasts racing to one point. The ink line lands on the dot (what
    actually happened); the orange one, the official forecast, ends just off it. Same 64-unit coordinates."""
    u = size / 64
    P = lambda pts: [(x + px * u, y + py * u) for px, py in pts]  # noqa: E731
    d.rounded_rectangle([x, y, x + size, y + size], radius=12 * u, fill=VOLT)
    official = _bezier((9, 47), (18, 47), (22, 23), (30, 23)) + _bezier((30, 23), (38, 23), (39, 41), (49, 44))
    mine = _bezier((9, 41), (18, 41), (22, 16), (31, 16)) + _bezier((31, 16), (40, 16), (40, 33), (50, 33))
    for pts, col, wdt in ((official, ORANGE, 5), (mine, INK, 5.5)):
        d.line(P(pts), fill=col, width=round(wdt * u), joint="curve")
        for cx, cy in (P(pts)[0], P(pts)[-1]):                        # round caps
            r = wdt * u / 2
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    cx, cy = P([(51, 33)])[0]
    d.ellipse([cx - 6.5 * u, cy - 6.5 * u, cx + 6.5 * u, cy + 6.5 * u], fill=INK)


def draw(w: int, h: int) -> Image.Image:
    hd = json.loads((SITE_DATA / "summary.json").read_text())["headline"]
    k = 2 * w / 1200                      # draw at 2x, scale down at the end
    W, H = round(w * 2), round(h * 2)
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    for x in range(0, W, round(28 * k)):  # faint graph paper, like the site's hero
        d.line([(x, 0), (x, H)], fill="#ebe6da", width=1)
    for y in range(0, H, round(28 * k)):
        d.line([(0, y), (W, y)], fill="#ebe6da", width=1)
    m = 58 * k
    # brand + eyebrow
    b = 40 * k
    _mark(d, m, m, b)
    d.text((m + b + 14 * k, m + 4 * k), "Beat the Grid", font=font("serif", 28 * k), fill=INK)
    d.text((m, m + b + 30 * k), "OPEN FORECASTING CONTEST · 34 US GRID REGIONS", font=font("mono", 14 * k), fill=INK2)
    # the question, with the site's highlighted italic
    y, size = m + b + 62 * k, 52 * k
    lh = 58 * k
    d.text((m, y), "Can an open model", font=font("serif", size), fill=INK)
    y += lh
    it = font("serif-italic", size)
    wd = d.textlength("out-forecast", font=it)
    d.rectangle([m - 4 * k, y + size * 0.62, m + wd + 4 * k, y + size * 0.95], fill=HL)
    d.text((m, y), "out-forecast", font=it, fill=INK)
    d.text((m + wd + 14 * k, y), "America's", font=font("serif", size), fill=INK)
    y += lh
    d.text((m, y), "grid operators?", font=font("serif", size), fill=INK)
    # numbers, ruled like the site's tiles
    y += lh + 30 * k
    d.line([(m, y), (m + 470 * k, y)], fill=INK, width=round(2 * k))
    y += 16 * k
    for val, label, col, x in ((f"{hd['load_weighted_mape_ours'] * 100:.2f}%", "my error", BLUE, m),
                               (f"{hd['load_weighted_mape_official'] * 100:.2f}%", "official error", ORANGE, m + 200 * k)):
        d.text((x, y), val, font=font("serif", 40 * k), fill=INK)
        d.ellipse([x, y + 58 * k, x + 11 * k, y + 69 * k], fill=col)
        d.text((x + 18 * k, y + 52 * k), label, font=font("sans", 17 * k), fill=INK2)
    d.text((m, y + 92 * k), f"Weighted by demand · {hd['wins']} wins, {hd['losses']} losses, {hd['ties']} ties · live daily",
           font=font("mono", 13.5 * k), fill=MUTED)
    _chart(d, (W * 0.54, m, W - m, H - m), k)
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
