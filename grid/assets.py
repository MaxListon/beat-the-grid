"""Cache-busting: stamp every CSS/JS reference in docs/*.html with a short hash of the file's contents.

After any change to a stylesheet or script, run `python -m grid.assets`; browsers then fetch the new
file instead of a stale cached copy. Unchanged files keep the same stamp, so caching still works.

The page's JavaScript modules (docs/js/*.js) import each other, so they share one stamp: a hash of all of them
together, written into every `import ... from "./x.js"` and into the page's `js/main.js` tag. A deploy can then
never mix a new module with a cached old one.
"""
import hashlib
import re

from .config import SITE_DATA

DOCS = SITE_DATA.parent
ASSETS = ["style.css", "site.js", "contact.js", "config.js", "sql.js"]
MODULES = DOCS / "js"
IMPORT = re.compile(r'(from\s+"\./[\w-]+\.js)(\?v=[0-9a-f]+)?(")')


def stamp_modules() -> str:
    files = sorted(MODULES.glob("*.js"))
    if not files:
        return ""
    plain = {f: IMPORT.sub(r"\1\3", f.read_text()) for f in files}          # hash the code without old stamps
    version = hashlib.sha256("".join(f.name + plain[f] for f in files).encode()).hexdigest()[:10]
    for f in files:
        new = IMPORT.sub(lambda m: f"{m.group(1)}?v={version}{m.group(3)}", plain[f])
        if new != f.read_text():
            f.write_text(new)
    return version


def stamp() -> dict[str, str]:
    hashes = {a: hashlib.sha256((DOCS / a).read_bytes()).hexdigest()[:10] for a in ASSETS if (DOCS / a).exists()}
    modules = stamp_modules()
    if modules:
        hashes["js/main.js"] = modules
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
