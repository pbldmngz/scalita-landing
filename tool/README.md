# tool/

`build.py` writes every page of scalita.com from one content file per locale.

```bash
python3 tool/build.py
```

No dependencies, no node, no install. Python 3 and nothing else.

## What it writes

Twenty HTML files and the sitemap:

| | |
|---|---|
| `index.html`, `privacy.html`, `terms.html`, `support.html` | English, at the root |
| `es/`, `fr/`, `pt/`, `de/` | the same four pages each |
| `sitemap.xml` | all twenty URLs with the full hreflang set |

**The generated HTML is committed and is what GitHub Pages serves.** The site is
still plain static HTML: nothing runs at request time. Every file carries a
comment at the top saying it was generated, because the next build overwrites
it. Edit `tool/content/<locale>.json` instead.

## Why

Five locales times four pages is twenty files that have to agree on the
navigation, the footer, the language menu, and six hreflang links each. That is
120 cross-references kept in sync by hand, and they were already drifting: the
Spanish pages had lost their accents, the French support page still quoted
dollars, and the language switcher was three buttons after the app had shipped
five languages.

## Content files

`tool/content/en.json` is the reference. Every locale has exactly the same
keys; `build.py` will raise if one is missing.

Copy in an existing locale and translate it to add a sixth language, then add
one row to `LOCALES` at the top of `build.py`. That row carries the URL path,
the `<html lang>`, the hreflang, the Open Graph locale, and the name the
language calls itself.

A few fields hold raw HTML rather than text, because they contain links or
emphasis: `footer.madeBy`, `index.pricing.*.items`, and the `body` of the
privacy, terms and support pages. Everything else is escaped on the way out, so
write real accented characters, not `&eacute;`.

`currency` and `proPriceValue` feed the JSON-LD offer. Keep them matched to the
price strings in `index.pricing`, which are written the way that country writes
money: `$4.99`, `4,99 €`, `R$ 25,99`.

## Checks worth running after a build

```bash
# every page parses, every local asset resolves, no em dashes
python3 - <<'PY'
import glob, os, re
for f in sorted(glob.glob('*.html') + glob.glob('*/*.html')):
    src = open(f, encoding='utf-8').read()
    assert '\u2014' not in src, f
    assert src.count('hreflang=') >= 6, f
    base = os.path.dirname(f) or '.'
    for m in re.finditer(r'(?:src|href)="([^"#:]+?)"', src):
        u = m.group(1)
        p = u.lstrip('/') if u.startswith('/') else os.path.normpath(os.path.join(base, u))
        if u.endswith('/') or p == '':
            p = os.path.join(p, 'index.html')
        assert os.path.exists(p), (f, u)
print('ok')
PY
```
