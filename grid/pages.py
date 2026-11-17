"""Build the inner pages (privacy, terms, 404, thanks, changelog, write-up) from one shared template.

Privacy/terms/404/thanks keep their existing body text (read back from the current HTML); the changelog
is defined here; the write-up page is rendered from WRITEUP.md so the repo and site never disagree.
Run `python -m grid.pages`, then `python -m grid.assets` to refresh cache-busting stamps.
"""
import re

import markdown

from .config import ROOT, SITE_DATA

DOCS = SITE_DATA.parent
BASE = "/beat-the-grid/"
SITE = "https://maxliston.github.io/beat-the-grid/"

CHANGELOG = [
    ("live", "2026-11-16", [
        "First valid live forecast issued for 2026-11-17 (all 34 regions). GitHub started the scheduled job 2 h 43 min late; the 06:00 UTC data cutoff is the same whenever it runs.",
        "Reliability: two backup runs a day (13:30 and 16:00 UTC), exact package versions pinned so the frozen model gives identical forecasts, and an automatic GitHub issue if a run fails.",
        "Safeguard: a forecast can no longer be issued before 12:00 UTC on the day before. A manual test run started just after midnight UTC began building the next day's forecast too early; it was cancelled before anything was saved.",
        "Added 'Live vs the backtest' (each live day against the backtest's normal range) and an automatic weekly summary. Both appear once days are scored.",
    ]),
    ("site", "2026-11-16", [
        "New editorial design: Newsreader headlines with IBM Plex text and data labels (all self-hosted), numbered sections, and a live ticker of each region's forecast.",
        "Brand accent changed from yellow to the logo's violet; buttons and labels use the text face (mono is kept for data); the 'Better together' table shows 10 regions with 'Show all'.",
        "Engineering: the site's JavaScript is now ES modules, and every push runs ruff, ESLint, the Python tests and 12 browser tests in real Chrome.",
        "Easier to use: a section menu on phones, 'Find your grid' by state, links that open an exact explorer view, plain-language definitions for the jargon, keyboard play and score sharing in the game, an RSS feed of the live record, a reading-progress line, back-to-top and a sun/moon theme switch.",
        "New: 'Can you beat the model?', a game where you draw your own forecast for a real past day and get scored against my model and the grid operator.",
        "Charts now label their own key points (best and worst hours and months, the live forecast's peak), a short 'Why I built this' note, and a 404 page that has lost power.",
        "New logo in violet and black: two forecasts racing to one point. The violet line (my model) lands on the glowing dot, what actually happened; the dim one (the official forecast) ends just off it.",
        "One color scheme throughout: blue for my model, orange for the operators (the map and result tags used green and red).",
        "Shorter tables with 'Show all', readable dates, a larger hero chart, a dark band for the live record, and table rows that become cards on phones.",
        "Fixed menu links landing short of their section, and stale cache stamps on the site's scripts.",
        "On GitHub: tests now run on every push, a data dictionary (DATA.md), an analysis notebook, and a v1.0 release with the frozen model.",
    ]),
    ("live", "2026-11-15", [
        "Launch: first live forecast issued 12:01 UTC for 2026-11-16.",
        "Bug found within the hour: the live job read demand only from EIA's bulk files (over a day behind) and only 45 days of history, so four demand inputs the model always had in the backtest were blank. The 2026-11-16 forecast was voided before the day began, kept unchanged in the log, and is not scored.",
        "Fix: the live job now reads EIA's real-time Grid Monitor feed (about an hour behind, matching the backtest's 06:00 UTC data cutoff) plus a full year of history. A dry run confirmed live inputs now match the backtest. Scoring still uses EIA's cleaned bulk data only.",
    ]),
    ("v1", "2026-11-15", [
        "Model frozen for the live contest (trained through 2026-11-14).",
        "Walk-forward backtest July 2024 – November 2026 across 34 regions, with Diebold-Mariano tests and Holm correction.",
        "Added the 'Model + operator' blend, illustrative dollar value, worst-day analysis and per-forecast explanations.",
        "Tested five weather cities per region instead of three on the never-scored tuning window; no gain, not adopted.",
        "Fixed before launch: missing 2022–23 weather was averaged as zero; the unreliable-data rule used the mean instead of the median; added a symmetric glitch filter.",
    ]),
    ("site", "2026-11-15", [
        "Added the peak contest: who calls each day's highest hour better (the operators do, 19 regions to 10).",
        "Added a SQL console: DuckDB in the browser over every scored hour, region and daily peak, with example queries and CSV download.",
        "Storm-warning experiment (National Weather Service archive): helps hurricane days by 13–35% in the backtest; documented, not adopted until confirmed on new storms.",
        "Added a live track-record calendar that compares the live error with the backtest.",
        "Redesigned site: self-hosted Inter typeface, live hero chart, map labels and filters, monthly trend lines, 7/14/30-day explorer with region comparison and CSV download.",
        "Accessibility: skip link, keyboard-operable map, WCAG AA text contrast, screen-reader descriptions for every chart, reduced-motion support.",
        "Privacy policy, terms, contact form with validation and spam protection, printable write-up and PDF.",
    ]),
]

# The 404 page is a small joke: the page has "lost power". A flashlight follows the cursor over the dark page; the
# message and the "Restore power" button are always lit, so nothing depends on finding them. Touch screens and
# reduced-motion visitors get the page with the lights on.
BLACKOUT_HEAD = """<style>
body.blackout-page{background:#0b0a09}
.blackout{position:relative;min-height:68vh;display:grid;place-items:center;text-align:center;padding:72px 0;isolation:isolate}
.blackout .lit{position:relative;z-index:3}
.blackout .code{font-family:var(--mono);font-size:13px;letter-spacing:.04em;color:#b39cff;margin:0 0 14px}
.blackout h1{color:#f2ede3;max-width:none;margin:0 auto 14px;font-size:clamp(40px,7vw,84px)}
.blackout .lede{color:#cbc3b5;margin:0 auto 28px;max-width:46ch}
.blackout .power{display:inline-flex;align-items:center;gap:10px;background:#b39cff;color:#14120f;font-weight:600;padding:12px 22px;border-radius:2px;text-decoration:none;box-shadow:0 0 0 6px rgba(179,156,255,.15),0 0 40px rgba(179,156,255,.40)}
.blackout .power::before{content:"";width:10px;height:10px;border-radius:50%;background:#c9412f;box-shadow:0 0 8px #c9412f}
.blackout .hidden-room{position:absolute;inset:0;z-index:1;pointer-events:none;color:#efe9dc}
.blackout .hidden-room span{position:absolute;font-family:var(--serif);font-style:italic;font-size:19px;opacity:.9}
.blackout .hidden-room a{pointer-events:auto;color:#b39cff}
.blackout .mask{position:absolute;inset:-40px -100vw;z-index:2;pointer-events:none;
  background:radial-gradient(circle 150px at var(--x,50%) var(--y,40%),rgba(11,10,9,0) 0,rgba(11,10,9,.15) 55%,rgba(11,10,9,.97) 100%)}
.blackout.on .mask{opacity:0;transition:opacity .5s}
.blackout.on{animation:flicker .6s steps(1) 1}
@keyframes flicker{0%{filter:brightness(.4)}20%{filter:brightness(1.6)}35%{filter:brightness(.6)}55%{filter:brightness(1.3)}100%{filter:none}}
@media (hover:none),(prefers-reduced-motion:reduce){.blackout .mask{display:none}.blackout.on{animation:none}}
body.blackout-page .topnav{background:#0b0a09;border-bottom-color:#2b2620}
body.blackout-page .brand,body.blackout-page .navlinks a:not(.navcta){color:#cbc3b5}
body.blackout-page #themeBtn{display:none}
body.blackout-page footer{border-top-color:#2b2620;background:#0b0a09}
</style>
"""
BLACKOUT_BODY = """<div class="blackout" id="blackout">
  <div class="hidden-room" aria-hidden="true">
    <span style="left:6%;top:14%">the grid is fine</span>
    <span style="right:7%;top:20%">only this page is out</span>
    <span style="left:10%;bottom:16%">try <a href="{BASE}#game" tabindex="-1">the forecasting game</a></span>
    <span style="right:9%;bottom:12%">or <a href="{BASE}#live" tabindex="-1">tomorrow's forecast</a></span>
  </div>
  <div class="mask"></div>
  <div class="lit">
    <p class="code">ERROR 404 · OUTAGE REPORTED</p>
    <h1>This page lost power.</h1>
    <p class="lede">The page you're looking for doesn't exist or has moved. Everything else is still on the grid. Move your cursor to look around.</p>
    <a class="power" id="power" href="{BASE}">Restore power</a>
  </div>
</div>
<script>
(function () {
  document.body.classList.add("blackout-page");
  var el = document.getElementById("blackout"), mask = el.querySelector(".mask");
  el.addEventListener("pointermove", function (e) {
    var r = mask.getBoundingClientRect();
    mask.style.setProperty("--x", (e.clientX - r.left) + "px"); mask.style.setProperty("--y", (e.clientY - r.top) + "px");
  });
  document.getElementById("power").addEventListener("click", function (e) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault(); el.classList.add("on");
    var href = this.href; setTimeout(function () { location.href = href; }, 650);
  });
})();
</script>"""


def page(fname: str, title: str, desc: str, body: str, index: bool = True, canonical: bool = True, extra_head: str = "") -> None:
    robots = "" if index else '<meta name="robots" content="noindex">\n'
    canon = f'<link rel="canonical" href="{SITE}{fname}">\n' if canonical else ""
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Beat the Grid</title>
<meta name="description" content="{desc}">
{robots}{canon}<meta name="theme-color" content="#1c5cab">
<meta property="og:title" content="{title} · Beat the Grid">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{BASE}favicon.svg" type="image/svg+xml">
<link rel="icon" href="{BASE}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="{BASE}apple-touch-icon.png">
<link rel="preload" href="{BASE}fonts/newsreader-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{BASE}fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{BASE}style.css">
{extra_head}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<nav class="topnav" aria-label="Main"><div class="wrap navrow">
  <a class="brand" href="{BASE}"><img src="{BASE}favicon.svg" width="22" height="22" alt=""> Beat the Grid</a>
  <div class="navlinks"><a href="{BASE}#scoreboard">Results</a><a href="{BASE}#explore">Explore</a><a href="{BASE}writeup.html">Write-up</a><a class="navcta" href="{BASE}#contact">Contact</a></div>
  <button id="themeBtn" class="ghost" aria-label="Switch between light and dark theme">Theme</button>
</div></nav>
<main class="page" id="main"><div class="wrap">
{body.strip()}
</div></main>
<footer><div class="wrap"><span>Built by Maxwell Liston</span>
  <nav aria-label="Footer"><a href="{BASE}writeup.html">Write-up</a><a href="{BASE}changelog.html">Changelog</a><a href="{BASE}privacy.html">Privacy</a><a href="{BASE}terms.html">Terms</a><a href="https://github.com/MaxListon/beat-the-grid">Code</a></nav></div></footer>
<script src="{BASE}config.js"></script>
<script src="{BASE}site.js"></script>
</body>
</html>
"""
    (DOCS / fname).write_text(html)


def existing_body(fname: str) -> str:
    text = (DOCS / fname).read_text()
    m = re.search(r'<main class="page"[^>]*><div class="wrap">(.*?)</div></main>', text, re.S)
    if not m:
        raise ValueError(f"no page body in {fname}")
    return m.group(1)


def changelog_body() -> str:
    parts = ['<div class="log"><h1>Changelog</h1><p class="lede">Every change to the model or the method is listed here. '
             'The live record always says which model version made each forecast.</p>']
    for ver, date, items in CHANGELOG:
        label = "Model " + ver if ver.startswith("v") else ("Live system" if ver == "live" else "Website")
        parts.append(f"<h2>{label} <small>{date}</small></h2><ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>")
    parts.append("</div>")
    return "\n".join(parts)


def writeup_body() -> str:
    md = (ROOT / "WRITEUP.md").read_text()
    html = markdown.markdown(md, extensions=["tables"])
    return (f'<p class="cta-row" style="margin:0 0 24px"><a class="btn small" href="{BASE}beat-the-grid-writeup.pdf" download>Download PDF</a>'
            f'<a class="secondary" href="{BASE}">Back to the live results</a></p>\n' + html)


def main() -> None:
    for fname, title, desc, kw in [
        ("privacy.html", "Privacy Policy", "What Beat the Grid collects (almost nothing), why, and your choices.", {}),
        ("terms.html", "Terms of Use", "Terms for using Beat the Grid, its forecasts and its code.", {}),
        ("thanks.html", "Message sent", "Thanks for getting in touch.", {"index": False}),
    ]:
        page(fname, title, desc, existing_body(fname), **kw)
    page("404.html", "Page not found", "This page doesn't exist.", BLACKOUT_BODY.replace("{BASE}", BASE),
         index=False, canonical=False, extra_head=BLACKOUT_HEAD)
    page("changelog.html", "Changelog", "Every change to the Beat the Grid model, method and website.", changelog_body())
    page("writeup.html", "Write-up", "The full Beat the Grid write-up: question, data, rules, method, results, failures and limits.", writeup_body())
    print("pages built")


if __name__ == "__main__":
    main()
