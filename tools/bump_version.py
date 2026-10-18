"""Set the app version everywhere: python tools/bump_version.py 1.2.0

Every module import, the script/style tags and the service worker carry ?v=<version>.
A deploy then never mixes old and new files (GitHub's CDN caches each URL on its own),
and the service worker keeps one complete, consistent set per version for offline use.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sub(path, pattern, repl, expect=1):
    text = path.read_text(encoding="utf-8")
    new, n = re.subn(pattern, repl, text)
    if n < expect:
        sys.exit(f"{path.name}: pattern {pattern!r} matched {n}x, expected >= {expect}")
    path.write_text(new, encoding="utf-8")
    return n


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        sys.exit(__doc__)
    v = sys.argv[1]
    for js in sorted((ROOT / "js").glob("*.js")):
        text = js.read_text(encoding="utf-8")
        if "from './" in text:
            sub(js, r"from '\./([a-z]+)\.js(?:\?v=[\d.]+)?'", rf"from './\1.js?v={v}'")
    sub(ROOT / "index.html", r'src="js/app\.js(?:\?v=[\d.]+)?"', f'src="js/app.js?v={v}"')
    sub(ROOT / "index.html", r'href="styles\.css(?:\?v=[\d.]+)?"', f'href="styles.css?v={v}"')
    sub(ROOT / "js" / "app.js", r"const VERSION = '[\d.]+';", f"const VERSION = '{v}';")
    sub(ROOT / "sw.js", r"const VERSION = '[\d.]+';", f"const VERSION = '{v}';")
    print("Version", v)


if __name__ == "__main__":
    main()
