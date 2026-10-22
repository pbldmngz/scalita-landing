#!/usr/bin/env python3
"""Cut the site's Sora web fonts from the app's TTFs.

    python3 tool/subset_fonts.py            write fonts/sora-*.woff2 and the
                                            @font-face block in css/style.css
    python3 tool/subset_fonts.py --check    change nothing; exit 1 if either
                                            is stale or a file is over budget
    --src DIR   the app's font folder (default ../scalita_app/assets/fonts)
    --out DIR   the site root to write into (default: this repo)

The sources are Sora Light, Regular and Medium (SIL OFL 1.1), the three
weights the site uses. One file per weight covers every locale the site
ships: Latin, Latin-1, Latin Extended-A (Turkish ı ş ğ İ, French œ), the
Helmholtz marks (‚ ¹ ² ³ ⁴), typographic quotes and a few signs. Code points
Sora has no glyph for are asked for anyway and simply dropped (it draws no
arrows, ⁵ to ⁹ or ₺); the browser takes those from the fallback font. With
one file per weight the @font-face rules need no unicode-range.

The output is byte-stable: same sources, same files.
"""

import argparse
import hashlib
import io
import re
import sys
from pathlib import Path

from fontTools import subset

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO.parent / "scalita_app" / "assets" / "fonts"
WEIGHTS = {300: "Sora-Light.ttf", 400: "Sora-Regular.ttf", 500: "Sora-Medium.ttf"}
BUDGET = 25 * 1024
CSS = "css/style.css"
BEGIN, END = "/* fonts:begin", "/* fonts:end */"

UNICODES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1: accents, ° ¹ ² ³ « »
    (0x0100, 0x017F),  # Latin Extended-A
    (0x1E9E, 0x1E9E),  # capital sharp s
    (0x2013, 0x2014),  # dashes (the font has them; the copy rules are check.py's)
    (0x2018, 0x201E),  # quotes, and U+201A, the Helmholtz low comma
    (0x2020, 0x2022),  # daggers, bullet
    (0x2026, 0x2026),  # ellipsis
    (0x2032, 0x2033),  # primes
    (0x2039, 0x203A),  # single guillemets
    (0x2070, 0x2079),  # superscript digits, c⁴ and up
    (0x20AC, 0x20AC),  # euro
    (0x20BA, 0x20BA),  # lira
    (0x2122, 0x2122),  # trade mark
    (0x2190, 0x2193),  # arrows
    (0x2212, 0x2212),  # minus, for signed cents
]


def subset_one(path):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = opts.layout_features + ["tnum"]  # steady readouts
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]  # keep the OFL link
    opts.drop_tables = opts.drop_tables + ["STAT"]
    font = subset.load_font(str(path), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[c for a, b in UNICODES for c in range(a, b + 1)])
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return buf.getvalue(), sorted(font.getBestCmap())


def css_block(weights):
    out = [BEGIN + " (written by tool/subset_fonts.py) */"]
    for weight in weights:
        out += [
            "@font-face {",
            "  font-family: 'Sora';",
            "  font-weight: %d;" % weight,
            "  font-display: swap;",
            "  src: url('/fonts/sora-%d.woff2') format('woff2');" % weight,
            "}",
        ]
    out.append(END)
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=REPO)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    problems = []
    for weight, name in WEIGHTS.items():
        data, cps = subset_one(args.src / name)
        target = args.out / "fonts" / ("sora-%d.woff2" % weight)
        digest = hashlib.sha256(data).hexdigest()[:12]
        print("%s  %6d bytes  %d code points  sha256 %s" % (target.name, len(data), len(cps), digest))
        if len(data) > BUDGET:
            problems.append("%s is %d bytes, over the %d budget" % (target.name, len(data), BUDGET))
        if args.check:
            if not target.exists() or target.read_bytes() != data:
                problems.append("%s is stale: rerun without --check" % target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

    css_path = args.out / CSS
    css = css_path.read_text(encoding="utf-8")
    block = css_block(WEIGHTS)
    found = re.search(re.escape(BEGIN) + r".*?" + re.escape(END), css, re.S)
    if not found:
        problems.append("%s has no %s ... %s block" % (CSS, BEGIN, END))
    elif found.group(0) != block:
        if args.check:
            problems.append("%s @font-face block is stale: rerun without --check" % CSS)
        else:
            css_path.write_text(css[: found.start()] + block + css[found.end():], encoding="utf-8")
            print("updated the @font-face block in", CSS)

    for p in problems:
        print("error:", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
