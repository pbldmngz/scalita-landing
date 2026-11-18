#!/usr/bin/env python3
"""Cut the site's web fonts: Sora from the app's TTFs, Onest for Cyrillic.

    python3 tool/subset_fonts.py            write fonts/sora-*.woff2,
                                            fonts/onest-*.woff2,
                                            fonts/signs.woff2 and the
                                            @font-face block in css/style.css
    python3 tool/subset_fonts.py --check    change nothing; exit 1 if either
                                            is stale or a file is over budget
    --src DIR   the app's font folder (default ../scalita_app/assets/fonts)
    --onest F   Onest's variable TTF (default tool/fonts-src/Onest[wght].ttf)
    --signs F   the sharp and flat face (default tool/fonts-src/ScalitaSigns-Regular.ttf)
    --out DIR   the site root to write into (default: this repo)

The sources are Sora Light, Regular and Medium (SIL OFL 1.1), the three
weights the site uses. One file per weight covers every locale the site
ships: Latin, Latin-1, Latin Extended-A (Turkish ı ş ğ İ, French œ), the
Helmholtz marks (‚ ¹ ² ³ ⁴), typographic quotes and a few signs. Code points
Sora has no glyph for are asked for anyway and simply dropped (it draws no
arrows, ⁵ to ⁹ or ₺); the browser takes those from the fallback font. With
one file per weight the @font-face rules need no unicode-range.

Sora draws no Cyrillic, so Russian takes its letters from Onest (SIL OFL
1.1, Dmitri Voloshin and Andrey Kudryavtsev, from the Google Fonts
repository, github.com/google/fonts ofl/onest; tool/fonts-src holds the
variable TTF and its OFL.txt). It is instanced at the four weights the site
draws (200 is the share images', which share-card.js loads itself), cut to
the Russian alphabet and the numero sign, and declared as more faces of the
family 'Sora' with that unicode-range: Latin, digits and punctuation stay
Sora's everywhere, and a browser fetches an Onest file only for a page that
shows Cyrillic, so the seven other languages never download one (opening
the language menu, where Русский is written, fetches the 400). The Russian
pages preload them (tool/templates/_chrome.py, font_preload).

Neither face draws the sharp and the flat the Russian note names are
written with (До♯, Си♭, never # or a Latin b). They come from Scalita Signs,
the app's own cut of Noto Music (SIL OFL 1.1; tool/fonts-src holds the TTF,
copied from the app's assets/fonts, and its OFL.txt): the sharp, the flat
and the natural, with Sora's line metrics. One file for every weight,
declared as more faces of 'Sora', one per weight, over that unicode-range only, so a
browser fetches its few KB only for a page that shows a sign, which no page
but a Russian one does. Not preloaded.

The output is byte-stable: same sources, same files.
"""

import argparse
import hashlib
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.varLib import instancer

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO.parent / "scalita_app" / "assets" / "fonts"
WEIGHTS = {300: "Sora-Light.ttf", 400: "Sora-Regular.ttf", 500: "Sora-Medium.ttf"}
BUDGET = 25 * 1024
ONEST = REPO / "tool" / "fonts-src" / "Onest[wght].ttf"
ONEST_WEIGHTS = (200, 300, 400, 500)
CYRILLIC = [
    (0x0400, 0x045F),  # Cyrillic: А to я, Ё ё, and the other letters of the block's first part
    (0x2116, 0x2116),  # numero sign
]
SIGNS = REPO / "tool" / "fonts-src" / "ScalitaSigns-Regular.ttf"
SIGN_CHARS = [(0x266D, 0x266F)]  # flat, natural, sharp
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


def subset_one(path, unicodes=UNICODES, weight=None):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = opts.layout_features + ["tnum"]  # steady readouts
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]  # keep the OFL link
    opts.drop_tables = opts.drop_tables + ["STAT"]
    font = subset.load_font(str(path), opts)
    if weight is not None:  # a variable font: one static instance per weight
        font = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=False)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[c for a, b in unicodes for c in range(a, b + 1)])
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return buf.getvalue(), sorted(font.getBestCmap())


def unicode_range(ranges):
    return ", ".join("U+%04X" % a if a == b else "U+%04X-%04X" % (a, b) for a, b in ranges)


def css_block(weights, onest=()):
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
    # Onest's Cyrillic, declared after Sora so it wins the letters it covers
    for weight in onest:
        out += [
            "@font-face {",
            "  font-family: 'Sora';",
            "  font-weight: %d;" % weight,
            "  font-display: swap;",
            "  src: url('/fonts/onest-%d.woff2') format('woff2');" % weight,
            "  unicode-range: %s;" % unicode_range(CYRILLIC),
            "}",
        ]
    # The signs, one file declared at each weight: a face whose weight is a
    # range loses to the exact-weight Sora face, which then claims the sign
    # it has no glyph for and leaves it to a system font
    for weight in weights:
        out += [
            "@font-face {",
            "  font-family: 'Sora';",
            "  font-weight: %d;" % weight,
            "  font-display: swap;",
            "  src: url('/fonts/signs.woff2') format('woff2');",
            "  unicode-range: %s;" % unicode_range(SIGN_CHARS),
            "}",
        ]
    out.append(END)
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--onest", type=Path, default=ONEST)
    ap.add_argument("--signs", type=Path, default=SIGNS)
    ap.add_argument("--out", type=Path, default=REPO)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    problems = []
    jobs = [(args.src / name, UNICODES, None, "sora-%d.woff2" % weight) for weight, name in WEIGHTS.items()]
    jobs += [(args.onest, CYRILLIC, weight, "onest-%d.woff2" % weight) for weight in ONEST_WEIGHTS]
    jobs.append((args.signs, SIGN_CHARS, None, "signs.woff2"))
    for src, unicodes, instance, name in jobs:
        data, cps = subset_one(src, unicodes, instance)
        target = args.out / "fonts" / name
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
    # 200 is not in style.css: only share-card.js draws it, and loads it itself
    block = css_block(WEIGHTS, [w for w in ONEST_WEIGHTS if w in WEIGHTS])
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
