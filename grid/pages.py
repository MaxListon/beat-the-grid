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
<link rel="preload" href="{BASE}fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
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
        label = "Model " + ver if ver.startswith("v") else "Website"
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
        ("404.html", "Page not found", "This page doesn't exist.", {"index": False, "canonical": False}),
        ("thanks.html", "Message sent", "Thanks for getting in touch.", {"index": False}),
    ]:
        page(fname, title, desc, existing_body(fname), **kw)
    page("changelog.html", "Changelog", "Every change to the Beat the Grid model, method and website.", changelog_body())
    page("writeup.html", "Write-up", "The full Beat the Grid write-up: question, data, rules, method, results, failures and limits.", writeup_body())
    print("pages built")


if __name__ == "__main__":
    main()
