"""Cache-busting: stamp every CSS/JS reference in docs/*.html with a short hash of the file's contents.

After any change to a stylesheet or script, run `python -m grid.assets`; browsers then fetch the new
file instead of a stale cached copy. Unchanged files keep the same stamp, so caching still works.
"""
import hashlib
import re

from .config import SITE_DATA

DOCS = SITE_DATA.parent
ASSETS = ["style.css", "app.js", "site.js", "contact.js", "config.js", "sql.js"]


def stamp() -> dict[str, str]:
    hashes = {a: hashlib.sha256((DOCS / a).read_bytes()).hexdigest()[:10] for a in ASSETS if (DOCS / a).exists()}
    pattern = re.compile(r'((?:/beat-the-grid/)?)(' + "|".join(re.escape(a) for a in hashes) + r')(\?v=[0-9a-f]+)?(")')
    for page in DOCS.glob("*.html"):
        text = page.read_text()
        new = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={hashes[m.group(2)]}{m.group(4)}", text)
        if new != text:
            page.write_text(new)
    return hashes


if __name__ == "__main__":
    for k, v in stamp().items():
        print(f"{k}: {v}")
