#!/usr/bin/env python3
"""Check the built site and the content files it is built from.

    python3 tool/check.py                          # the repo root and tool/content
    python3 tool/check.py --site DIR               # a site built with build.py --out DIR
    python3 tool/check.py --content-only           # the content files alone
    python3 tool/check.py --content-only --locale es
    python3 tool/check.py --strict                 # warnings fail too: run it before publishing

Errors make the exit status 1. Warnings are things that are fine while the
site is being written (an English placeholder, a translation not there yet)
and wrong once it is published, which is what --strict is for. Notes never
fail. tool/README.md lists every check.
"""

import argparse
import datetime
import hashlib
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

sys.dont_write_bytecode = True   # tool/ is served: no __pycache__ in it
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import build as B  # noqa: E402  (the same locales, slug rule and helpers)

ROOT = B.ROOT
SITE = B.SITE
CODES = [l[0] for l in B.LOCALES]
LANG_OF = {l[0]: l[2] for l in B.LOCALES}
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
XHTML_NS = "{http://www.w3.org/1999/xhtml}"

# --------------------------------------------------------------------------
# what the content files must hold
# --------------------------------------------------------------------------

COMMON = ["slug", "label", "title", "description", "h1", "lead", "sections", "faq", "sources",
          "reviewed", "writtenAgainst"]
COMMON_FILLED = ["label", "title", "description", "h1", "lead", "reviewed"]

# Keys every page of a template has, and those that must not be empty.
TEMPLATE_KEYS = {
    "hub": ["intro", "children"],
    "tools_hub": ["intro", "children", "appBand", "referenceHeading"],
    "voice_types_hub": ["intro", "children"],
    "tool": ["toolId", "instructions", "sampleResult", "notClaimed", "tile", "oneLine", "appBand",
             "referenceHeading"],
    "routine": ["routineId", "whyOrder", "whatToFeel", "whenToStop", "next"],
    "exercise": ["syllables", "troubleshooting"],
    "pattern": ["scaleId", "localBox"],
    "concept": ["shortAnswer", "listenFor", "misconceptions", "seeProfessional"],
    "library": [],
}
FILLED = {
    "hub": ["intro", "children"],
    "tools_hub": ["intro", "children", "appBand", "referenceHeading"],
    "voice_types_hub": ["intro", "children", "sections", "sources"],
    "tool": ["toolId", "instructions", "sampleResult", "notClaimed", "faq", "sources", "tile", "oneLine",
             "appBand", "referenceHeading"],
    "routine": ["routineId", "whyOrder", "whatToFeel", "whenToStop", "next", "faq", "sources"],
    "exercise": ["syllables", "troubleshooting", "sources"],
    "pattern": ["scaleId", "sections", "sources"],
    "concept": ["shortAnswer", "listenFor", "misconceptions", "seeProfessional", "sections", "sources"],
    "library": ["sections", "sources"],
}

# Ceilings for the written words of an English page (section 4.2 of the
# plan): ceilings, not targets. A translation may run a third longer.
WORDS = {"routine": 900, "exercise": 800, "pattern": 800, "concept": 1200,
         "voice_types_hub": 1300, "library": 500}

# Fields that hold HTML; every other string is plain text and is escaped.
HTML_FIELDS = {"html", "a", "intro", "whyOrder", "whatToFeel", "whenToStop", "next", "troubleshooting",
               "localBox", "shortAnswer", "listenFor", "misconceptions", "seeProfessional",
               "instructions", "sampleResult", "notClaimed"}
# The site-wide strings written out as HTML (tool/README.md); every other
# one is escaped, so it must hold the character, never its entity.
SITE_HTML = re.compile(r"^(?:footer\.madeBy|index\.pricing\.\w+\.items\.\d+|(?:privacy|terms|support)\.body|credit\.piano)$")
ENTITY = re.compile(r"&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);")
# Fields that are ids or data, the same in every locale.
SAME_IN_EVERY_LOCALE = {"routineId", "scaleId", "toolId", "children", "syllables", "writtenAgainst", "voiceType"}
# "id" is a section's optional anchor slug ("keyboard"), the same in every locale.
NOT_PROSE = {"slug", "reviewed", "writtenAgainst", "routineId", "scaleId", "toolId", "children",
             "syllables", "url", "voiceType", "id"}

# The site-wide keys this wave added. Until a translator replaces them they
# hold the English, which a warning lists (an error with --strict).
NEW_SITE_KEYS = ["nav.tools", "nav.guides", "footer.toolsHeading", "footer.guidesHeading",
                 "sections.tools", "sections.guides", "langBar.text", "langBar.close",
                 "breadcrumb.home", "breadcrumb.label", "cta.heading", "cta.body", "cta.button",
                 "cta.ios", "credit.piano", "byline.name", "byline.line", "notFound.line",
                 "notFound.homes", "related.heading", "sources.heading", "faq.heading",
                 # the redesign's (scalita_app docs/specs/site-redesign-spec.md, 5.1); its lists,
                 # index.tools.items, index.trust.items and index.screens, cannot be: dig() reads objects
                 "nav.home", "nav.siteLabel", "nav.toolsLabel", "nav.getApp", "nav.closeMenu",
                 "nav.toolsHint", "nav.guidesHint", "nav.fullscreen", "nav.fullscreenHint",
                 "nav.exitFullscreen", "nav.tabLabels.vocal-range-test", "nav.tabLabels.sing-in-tune-test",
                 "nav.tabLabels.warm-up-piano", "nav.tabLabels.voice-break-finder", "cta.inApp",
                 "cta.hubHeading", "cta.free", "cta.iphone", "cta.comingSoon", "cta.iphoneLabel",
                 "index.stage.meta", "index.tools.kicker", "index.tools.title", "index.tools.lead",
                 "index.tools.open", "index.app.kicker", "index.app.title", "index.app.lead",
                 "index.trust.title", "index.pricing.pro.note", "index.download.cta"]
# Tops that hold only new keys: the generic "reads as English" pass skips them,
# since the loop over NEW_SITE_KEYS checks each one. nav, footer and index
# hold legacy keys too, so that pass still reads every string in them.
NEW_TOPS = {k.split(".")[0] for k in NEW_SITE_KEYS if k.split(".")[0] not in ("nav", "footer", "index")}
# Where the same words as English are right.
SAME_AS_ENGLISH_OK = {("*", "byline.name"), ("de", "sections.tools"), ("de", "nav.tools"),
                      # "Guides" and "Sources" are French words too
                      ("fr", "nav.guides"), ("fr", "footer.guidesHeading"), ("fr", "sections.guides"),
                      ("fr", "sources.heading"), ("fr", "nav.guidesHint"),
                      # a brand, and words these languages share with English
                      ("*", "cta.iphone"), ("fr", "nav.siteLabel"), ("pt", "nav.siteLabel"),
                      ("es", "nav.tabLabels.warm-up-piano"), ("fr", "nav.tabLabels.warm-up-piano"),
                      ("pt", "nav.tabLabels.warm-up-piano"), ("id", "nav.tabLabels.warm-up-piano"),
                      # Indonesian keeps "range" in English on purpose (KEPT_ENGLISH)
                      ("id", "nav.tabLabels.vocal-range-test")}

# The ui files the first wave needs (A2 of the brief).
UI_FILES = ["common", "mic", "vocal-range-test", "sing-in-tune-test", "player", "voice-break-finder", "templates"]

# Words that are a verdict on a voice: beauty and percentiles. Never in what a
# tool says (ui files, sample results); a warning anywhere else, where a page
# may name the idea in order to say it does not judge it.
VERDICT = {
    "en": ["beautiful", "percentile"],
    "es": ["bonita", "bonito", "hermosa", "hermoso", "preciosa", "precioso", "percentil"],
    "fr": ["belle", "beau", "magnifique", "percentile", "centile"],
    "pt": ["bonita", "bonito", "linda", "lindo", "percentil"],
    "de": ["schön", "schöne", "schöner", "schönen", "wunderschön", "perzentil"],
    "tr": ["güzel", "yüzdelik"],
    "id": ["indah", "merdu", "persentil"],
}
# The tone-deaf words. Never in what a tool says either, but a page may ask the
# reader's question in them ("Am I tone deaf?"), so prose carries them freely
# (decision D2 of the plan): as a question or its answer, never as a result.
TONE_DEAF = {
    "en": ["tone deaf", "tone-deaf", "tone deafness"],
    "es": ["sordo musical", "sorda musical", "sordera musical", "sordo tonal", "sordera tonal"],
    "fr": ["sourd musical", "sourde musicale", "oreille de casserole", "amusique"],
    "pt": ["surdo musical", "surda musical", "surdez musical", "surdo tonal"],
    "de": ["tontaub", "tontaube", "tontaubheit", "unmusikalisch"],
    "tr": ["kulaksız"],
    "id": ["buta nada", "tuli nada"],
}

# Common English words that are not words in the six other languages (no
# "a", "on", "in", "die", "can", "will", "not", "do"...). A translated field
# where they are more than a few of the words still reads as English.
STOPWORDS = set("""the and of you your that for with this have from but what which their there
about would should could been they them then than these those while because into just only
also very each other where does after before through our any how who are were it's don't
can't isn't doesn't you're it is""".split())
STOPWORDS -= {"it", "is"}
# Terms a locale keeps in English on purpose (plan 4.5), taken out before counting.
KEPT_ENGLISH = {"id": ["head voice", "chest voice", "lip trill", "tongue trill", "mix voice", "range"]}

EM_DASH = re.compile("\u2014|&mdash;|&#8212;|&#x2014;", re.I)
# Decision 8 of the redesign: no price anywhere, Google Play shows the reader's
# own. A note, for the copy's owners: a legal text may need its wording first.
PRICE = re.compile(r"(?:US?\$|R\$|\$|\u20ac|\u00a3|\u20ba|\bRp\.?)\s?\d|\d[\d.,]*\s?(?:\u20ac|\u00a3|\u20ba|\bUSD\b|\bEUR\b|\bTL\b)")
NOTE_TOKEN = re.compile(r"\{\{note:([^{}:]+)(?::(local|intl))?\}\}")
ANY_TOKEN = re.compile(r"\{\{.*?\}\}")
PAGE_LINK = re.compile(r'href="page:([^"#]*)(#[^"]*)?"')
HREF = re.compile(r'\bhref="([^"]*)"')
PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_]+\}")


class Report:
    def __init__(self, strict):
        self.strict = strict
        self.errors, self.warnings, self.notes = [], [], []

    def error(self, where, msg):
        self.errors.append("%s: %s" % (where, msg))

    def warn(self, where, msg):
        (self.errors if self.strict else self.warnings).append("%s: %s" % (where, msg))

    def note(self, where, msg):
        self.notes.append("%s: %s" % (where, msg))

    def show(self):
        for title, items in (("notes", self.notes), ("warnings", self.warnings), ("errors", self.errors)):
            if items:
                print("%s (%d):" % (title, len(items)))
                for i in items:
                    print("  " + i)
        print("check: %d error(s), %d warning(s), %d note(s)" % (
            len(self.errors), len(self.warnings), len(self.notes)))
        return 1 if self.errors else 0


def load(path, r, where=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        r.error(where or B.rel(path), "not valid JSON: %s" % e)
    except OSError as e:
        r.error(where or B.rel(path), "cannot read: %s" % e)
    return None


def strings(obj, path=""):
    """(key path, last key, string) for every string in a JSON tree."""
    if isinstance(obj, str):
        yield path.rstrip("."), path.rstrip(".").split(".")[-1], obj
    elif isinstance(obj, list):
        for n, v in enumerate(obj):
            yield from strings(v, "%s%d." % (path, n))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from strings(v, "%s%s." % (path, k))


def field_of(path):
    """The content field a key path is in: "faq.0.a" is "a", "sections.1.html" is "html"."""
    parts = [p for p in path.split(".") if not p.isdigit()]
    return parts[-1] if parts else path


def plain(s):
    """Visible words of a string that may hold HTML."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = NOTE_TOKEN.sub(" ", s)
    return html.unescape(s)


def words(s):
    return re.findall(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)?", plain(s).lower())


def reads_english(text, code):
    t = plain(text).lower()
    for term in KEPT_ENGLISH.get(code, []):
        t = t.replace(term, " ")
    w = re.findall(r"[a-z]+(?:'[a-z]+)?", t)
    allw = words(t)
    if len(allw) < 8:
        return False
    hits = sum(1 for x in w if x in STOPWORDS)
    return hits >= 3 and hits / len(allw) >= 0.12


def verdicts(text, code, words=VERDICT):
    t = plain(text).lower()
    found = []
    for term in words.get(code, []) + (words["en"] if code != "en" else []):
        if re.search(r"(?<![^\W_])%s(?![^\W_])" % re.escape(term), t):
            found.append(term)
    return found


def check_html_fragment(s, where, r):
    """A field's HTML must close what it opens."""
    p = Parser(fragment=True)
    try:
        p.feed(s)
        p.close()
    except Exception as e:  # html.parser raises on very broken input
        r.error(where, "HTML does not parse: %s" % e)
        return
    for problem in p.problems + ["<%s> is not closed" % t for t in p.stack]:
        r.error(where, "HTML: %s" % problem)


def check_tokens(s, where, r, ids):
    for m in NOTE_TOKEN.finditer(s):
        if B.parse_note(m.group(1)) is None:
            r.error(where, "%s is not a key from A0 to C8" % m.group(0))
    left = ANY_TOKEN.search(NOTE_TOKEN.sub("", s))
    if left:
        r.error(where, "unknown token %s (only {{note:C4}} exists)" % left.group(0))
    for m in PAGE_LINK.finditer(s):
        if m.group(1) not in ids:
            r.error(where, "page:%s is not in tool/pages.json" % m.group(1))
    if re.search(r"href\s*=\s*'?page:|href\s+=|=\s+\"page:", s):
        r.error(where, 'a page link is written href="page:<id>", in double quotes')
    for m in HREF.finditer(s):
        h = m.group(1)
        if h.startswith("page:") or h.startswith(("https://", "http://", "mailto:", "#")):
            if h.startswith(("https://scalita.com", "http://scalita.com")):
                r.error(where, "link %s: link a page of the site as href=\"page:<id>\"" % h)
            continue
        r.error(where, "link %s: link a page of the site as href=\"page:<id>\", anything else in full" % h)


# --------------------------------------------------------------------------
# content checks
# --------------------------------------------------------------------------

def check_content(content, only, r, registry):
    ids = {p["id"] for p in registry}
    codes = [only] if only else CODES

    # site-wide strings
    site = {}
    for code in CODES:
        path = os.path.join(content, code + ".json")
        if os.path.exists(path):
            site[code] = load(path, r)
    if site.get("en") is None:
        r.error("tool/content/en.json", "missing")
        return
    for code in codes:
        c = site.get(code)
        where = "%s.json" % code
        if c is None:
            r.error(where, "missing")
            continue
        with open(os.path.join(content, code + ".json"), encoding="utf-8") as fh:
            raw = fh.read()
        if EM_DASH.search(raw):
            r.error(where, "has an em dash")
        for d in B.shape_diff(site["en"], c):
            r.error(where, d)
        for key in NEW_SITE_KEYS:
            v = dig(c, key)
            if not isinstance(v, str) or not v.strip():
                r.error(where, "%s is missing or empty" % key)
                continue
            if code != "en" and v == dig(site["en"], key) and ("*", key) not in SAME_AS_ENGLISH_OK \
                    and (code, key) not in SAME_AS_ENGLISH_OK:
                r.warn(where, "%s is still the English placeholder" % key)
            elif code != "en" and reads_english(v, code):
                r.error(where, "%s reads as English: %r" % (key, v[:80]))
            for term in verdicts(v, code) + verdicts(v, code, TONE_DEAF):
                r.error(where, "%s uses the verdict word %r" % (key, term))
        for path, _, s in strings(c):
            if PRICE.search(html.unescape(re.sub(r"<[^>]+>", " ", s))):
                r.note(where, "%s states a price: Google Play shows it, per country" % path)
            # escaped on the way out, so an entity would show as it is
            if not SITE_HTML.match(path) and ENTITY.search(s):
                r.error(where, "%s holds an HTML entity (%s), which shows as it is: write the character"
                        % (path, ENTITY.search(s).group(0)))
        if code != "en":
            ref = dict((p, s) for p, k, s in strings(site["en"]))
            for path, key, s in strings(c):
                if path.split(".")[0] not in NEW_TOPS and s != ref.get(path) and reads_english(s, code):
                    r.error(where, "%s reads as English: %r" % (path, plain(s)[:80]))
        for s in ("tools", "guides"):
            w = dig(c, "sections." + s)
            if isinstance(w, str) and not B.SLUG.match(w):
                r.error(where, "sections.%s %r is not lowercase ASCII words joined by hyphens" % (s, w))
        if isinstance(dig(c, "credit.piano"), str):
            check_html_fragment(c["credit"]["piano"], where + " credit.piano", r)

    # ui strings
    ui_en = os.path.join(content, "ui", "en")
    names = sorted(f[:-5] for f in os.listdir(ui_en) if f.endswith(".json")) if os.path.isdir(ui_en) else []
    for name in UI_FILES:
        if name not in names:
            r.warn("ui/en/%s.json" % name, "not written yet")
    for name in names:
        en = load(os.path.join(ui_en, name + ".json"), r)
        if en is None:
            continue
        for code in codes:
            path = os.path.join(content, "ui", code, name + ".json")
            where = "ui/%s/%s.json" % (code, name)
            if not os.path.exists(path):
                r.warn(where, "not translated yet")
                continue
            d = en if code == "en" else load(path, r)
            if d is None:
                continue
            check_strings_file(d, en, code, where, r, ids, ui=True)

    # page files
    for page in registry:
        if page["section"] == "legacy":
            continue
        check_page(page, content, codes, r, ids, registry)
    for code, seen in sorted(SLUGS.items()):
        for slug, pids in sorted(seen.items()):
            if len(pids) > 1:
                r.error("pages/%s" % code, "slug %r is used by %s" % (slug, ", ".join(sorted(pids))))
    # the privacy page's website section
    en = None
    for code in CODES:
        path = os.path.join(content, "pages", code, "privacy-web.json")
        where = "pages/%s/privacy-web.json" % code
        if not os.path.exists(path):
            if code in codes:
                r.warn(where, "not written yet")
            continue
        d = load(path, r)
        if d is None:
            continue
        if code == "en":
            en = d
        if code not in codes:
            continue
        for k in ("heading", "html"):
            if not isinstance(d.get(k), str) or not d[k].strip():
                r.error(where, "%r is missing or empty" % k)
        if en is not None:
            check_strings_file(d, en, code, where, r, ids)

    # similarity between the written pages of a locale
    for code in codes:
        texts = {}
        for page in registry:
            copy = PAGES.get((page["id"], code))
            if copy is not None:
                texts[page["id"]] = " ".join(plain(s) for p, k, s in strings(copy) if field_of(p) not in NOT_PROSE)
        similar(texts, "pages/%s" % code, r)


PAGES = {}


def dig(obj, dotted):
    for k in dotted.split("."):
        if not isinstance(obj, dict) or k not in obj:
            return None
        obj = obj[k]
    return obj


def check_strings_file(d, en, code, where, r, ids, ui=False):
    """Checks every content file shares: parity, em dashes, tokens, HTML,
    placeholders, verdict words, English left in a translation."""
    for diff in B.shape_diff(en, d):
        r.error(where, diff)
    raw = json.dumps(d, ensure_ascii=False)
    if EM_DASH.search(raw):
        r.error(where, "has an em dash")
    ref = dict((p, s) for p, k, s in strings(en))
    for path, key, s in strings(d):
        at = "%s %s" % (where, path)
        field = field_of(path)
        check_tokens(s, at, r, ids)
        if field in HTML_FIELDS or ui and "<" in s:
            check_html_fragment(s, at, r)
        elif "<" in s and field not in NOT_PROSE:
            r.warn(at, "plain text field holds markup, which will show as it is")
        elif ENTITY.search(s):
            r.error(at, "holds an HTML entity (%s), which shows as it is: write the character" % ENTITY.search(s).group(0))
        if ui and path in ref and set(PLACEHOLDER.findall(s)) != set(PLACEHOLDER.findall(ref[path])):
            r.error(at, "placeholders %s differ from the English %s"
                    % (sorted(set(PLACEHOLDER.findall(s))), sorted(set(PLACEHOLDER.findall(ref[path])))))
        if field in NOT_PROSE:
            continue
        if ui or field == "sampleResult":
            for term in verdicts(s, code) + verdicts(s, code, TONE_DEAF):
                r.error(at, "uses the verdict word %r" % term)
        else:
            for term in verdicts(s, code):
                r.warn(at, "uses %r: fine when the page says it does not judge that, never as a verdict" % term)
        if code == "en":
            continue
        # placeholders are not words: "{syllable}, {tempo} bpm" reads the same in every language
        if s == ref.get(path) and len(words(PLACEHOLDER.sub(" ", s))) >= 3 and "sources" not in path.split("."):
            r.warn(at, "is still the English")
        elif reads_english(s, code) and "sources" not in path.split("."):
            r.error(at, "reads as English: %r" % plain(s)[:80])


def check_page(page, content, codes, r, ids, registry):
    pid = page["id"]
    tpl = page["template"]
    en_path = os.path.join(content, "pages", "en", pid + ".json")
    if not os.path.exists(en_path):
        r.warn("pages/en/%s.json" % pid, "not written yet")
        return
    en = load(en_path, r)
    if en is None:
        return
    slugs = {}
    for code in codes:
        path = os.path.join(content, "pages", code, pid + ".json")
        where = "pages/%s/%s.json" % (code, pid)
        if not os.path.exists(path):
            r.warn(where, "not translated yet")
            continue
        copy = en if code == "en" else load(path, r)
        if copy is None:
            continue
        PAGES[(pid, code)] = copy
        check_strings_file(copy, en, code, where, r, ids)
        keys = [k for k in COMMON if not (k == "slug" and page.get("root"))] + TEMPLATE_KEYS.get(tpl, [])
        if tpl not in TEMPLATE_KEYS:
            r.warn(where, "template %r has no required fields in check.py" % tpl)
        for k in keys:
            if k not in copy:
                r.error(where, "%r is missing" % k)
        if code == "en":
            for k in copy:
                if k not in keys and k != "label":
                    r.note(where, "%r is not a field of the %s template's contract" % (k, tpl))
        for k in COMMON_FILLED + FILLED.get(tpl, []):
            v = copy.get(k)
            if v is None or (isinstance(v, (str, list)) and not (v.strip() if isinstance(v, str) else v)):
                r.error(where, "%r is empty" % k)
        check_types(copy, where, r, ids)
        # the slug
        if page.get("root"):
            if "slug" in copy:
                r.error(where, "the section's root page has no slug, its URL is the section word")
        else:
            slug = copy.get("slug")
            if not isinstance(slug, str) or not B.SLUG.match(slug):
                r.error(where, "slug %r is not lowercase ASCII words joined by hyphens" % slug)
            elif code == "en" and slug != pid:
                r.error(where, "the English slug is the page id, %r" % pid)
            SLUGS.setdefault(code, {}).setdefault(slug, []).append(pid)
        # ids and data
        for k in SAME_IN_EVERY_LOCALE:
            if k in copy and copy.get(k) != en.get(k):
                r.error(where, "%s must be the same as the English, %r" % (k, en.get(k)))
        # a section about one voice type (the voice types hub) names it by its export id
        if isinstance(copy.get("sections"), list) and isinstance(en.get("sections"), list):
            known = {e.get("id") for e in export_list("voice_types")}
            for n, (a, b) in enumerate(zip(copy["sections"], en["sections"])):
                # a section's anchor (id="keyboard"): a slug, the English one in every locale
                sid, en_sid = (a.get("id") if isinstance(a, dict) else None), (b.get("id") if isinstance(b, dict) else None)
                if sid is not None and (not isinstance(sid, str) or not B.SLUG.match(sid)):
                    r.error(where, "sections.%d id %r is not lowercase ASCII words joined by hyphens" % (n, sid))
                elif sid != en_sid:
                    r.error(where, "sections.%d id must be the same as the English, %r" % (n, en_sid))
                if not isinstance(a, dict) or "voiceType" not in a:
                    continue
                if known and a["voiceType"] not in known:
                    r.error(where, "sections.%d voiceType %r is not in tool/data/app/voice_types.json"
                            % (n, a["voiceType"]))
                if isinstance(b, dict) and a["voiceType"] != b.get("voiceType"):
                    r.error(where, "sections.%d voiceType must be the same as the English, %r" % (n, b.get("voiceType")))
        if isinstance(copy.get("sources"), list) and isinstance(en.get("sources"), list):
            for a, b in zip(copy["sources"], en["sources"]):
                if isinstance(a, dict) and isinstance(b, dict) and a.get("url") != b.get("url"):
                    r.error(where, "source URL %r must be the English one, %r" % (a.get("url"), b.get("url")))
        d = page.get("data") or {}
        for k in ("routineId", "scaleId", "toolId"):
            if k in copy and copy[k] != d.get(k):
                r.error(where, "%s %r is not the registry's %r" % (k, copy[k], d.get(k)))
        if "children" in copy and isinstance(copy["children"], list):
            for child in copy["children"]:
                if child not in ids:
                    r.error(where, "child %r is not in tool/pages.json" % child)
                elif code == "en" and next(p for p in registry if p["id"] == child)["parent"] != pid:
                    r.note(where, "child %r has another parent in tool/pages.json" % child)
        if code == "en":
            drift(page, copy, where, r)
        # words
        limit = WORDS.get(tpl)
        if limit:
            n = len(words(" ".join(s for p, k, s in strings(copy)
                                   if field_of(p) not in NOT_PROSE | {"label", "title", "description"}
                                   and "sources" not in p.split("."))))
            if code == "en" and n > limit:
                r.error(where, "%d written words, over the %s ceiling of %d" % (n, tpl, limit))
            elif code != "en" and n > limit * 1.35:
                r.warn(where, "%d written words, well over the %s ceiling of %d" % (n, tpl, limit))
        for k, lo, hi in (("title", 20, 65), ("description", 70, 160)):
            v = copy.get(k)
            if isinstance(v, str):
                v = rendered(v, code)   # measured as a reader sees it: Do3 (C4), not the token
            if isinstance(v, str) and not lo <= len(v) <= hi:
                r.note(where, "%s is %d characters (search shows about %d to %d)" % (k, len(v), lo, hi))


SLUGS = {}
NOTES = {}


def rendered(s, code):
    """A plain text field as the build writes it: every {{note:..}} token
    filled in from tool/data/app/notes.json, the way build.py's resolve() does."""
    if code not in NOTES:
        table = {}
        path = os.path.join(B.DATA, "notes.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                rows = json.load(fh).get(code)
            for row in rows if isinstance(rows, list) else []:
                table[int(row["midi"])] = (row["name"], row["intl"])
        NOTES[code] = table

    def note(m):
        midi = B.parse_note(m.group(1))
        if midi is None:
            return m.group(0)
        local, intl = NOTES[code].get(midi) or (B.intl_fallback(midi),) * 2
        if m.group(2):
            return local if m.group(2) == "local" else intl
        return local if local == intl else "%s (%s)" % (local, intl)
    return NOTE_TOKEN.sub(note, s)


def check_types(copy, where, r, ids):
    def text(k):
        v = copy.get(k)
        if k in copy and v is not None and not isinstance(v, str):
            r.error(where, "%r is not a string" % k)
    for k in ("slug", "label", "title", "description", "h1", "lead", "reviewed", "routineId", "scaleId",
              "toolId", "intro", "whyOrder", "whatToFeel", "whenToStop", "next", "troubleshooting",
              "shortAnswer", "listenFor", "misconceptions", "seeProfessional", "instructions",
              "sampleResult", "notClaimed", "tile", "oneLine", "appBand", "referenceHeading"):
        text(k)
    for k, fields in (("sections", ("heading", "html")), ("faq", ("q", "a")), ("sources", ("label", "url"))):
        v = copy.get(k)
        if k in copy and not isinstance(v, list):
            r.error(where, "%r is not a list" % k)
            continue
        for n, item in enumerate(v or []):
            if not isinstance(item, dict) or any(not isinstance(item.get(f), str) or not item[f].strip()
                                                 for f in fields):
                r.error(where, "%s.%d needs %s, each a non-empty string" % (k, n, " and ".join(fields)))
            elif k == "sources" and not item["url"].startswith(("https://", "http://")):
                r.error(where, "sources.%d url %r is not a full URL" % (n, item["url"]))
    for k in ("children", "syllables"):
        v = copy.get(k)
        if k in copy and (not isinstance(v, list) or not all(isinstance(x, str) for x in v)):
            r.error(where, "%r is not a list of ids" % k)
    if isinstance(copy.get("syllables"), list):
        known = {e.get("id") for e in export_list("syllables")}
        for s in copy["syllables"]:
            if known and s not in known:
                r.error(where, "syllable %r is not in tool/data/app/syllables.json" % s)
    rv = copy.get("reviewed")
    if isinstance(rv, str):
        try:
            datetime.date.fromisoformat(rv)
        except ValueError:
            r.error(where, "reviewed %r is not a date, YYYY-MM-DD" % rv)
    wa = copy.get("writtenAgainst")
    if "writtenAgainst" in copy and wa is not None and not isinstance(wa, str):
        r.error(where, "writtenAgainst is an export hash or null")


EXPORT = {}


def export_list(stem):
    if stem not in EXPORT:
        path = os.path.join(B.DATA, stem + ".json")
        d = []
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                d = json.load(fh)
        EXPORT[stem] = d if isinstance(d, list) else []
    return EXPORT[stem]


def drift(page, copy, where, r):
    """A page written against a routine or scale records the export hash it
    read; when the app has changed that routine or scale since, say so."""
    d = page.get("data") or {}
    wa = copy.get("writtenAgainst")
    if isinstance(wa, str) and not ("routineId" in d or "scaleId" in d):
        # written against a routine or scale its registry entry does not play
        # (the voice cracks page describes Bridge Builder's steps): the hash
        # must still be one the export has
        hashes = {e.get("hash") for stem in ("routines", "scales") for e in export_list(stem)}
        if hashes and wa not in hashes:
            r.warn(where, "written against %s, which no routine or scale in tool/data/app has now: "
                          "reread what the page describes and update it" % wa)
    for key, stem in (("routineId", "routines"), ("scaleId", "scales")):
        if key not in d:
            continue
        entry = next((e for e in export_list(stem) if e.get("id") == d[key]), None)
        if entry is None:
            r.warn(where, "%s %r is not in tool/data/app/%s.json" % (key, d[key], stem))
        elif copy.get("writtenAgainst") is None:
            r.warn(where, "writtenAgainst is not recorded: set it to %s's hash, %s" % (d[key], entry.get("hash")))
        elif copy["writtenAgainst"] != entry.get("hash"):
            r.warn(where, "written against %s, but %s is %s now: reread the routine and update the page"
                   % (copy["writtenAgainst"], d[key], entry.get("hash")))


def similar(texts, where, r, threshold=0.8):
    """Two pages of one locale sharing more than 80% of their main text."""
    grams = {}
    for pid, t in texts.items():
        w = re.findall(r"[^\W_]+", t.lower())
        g = {" ".join(w[i:i + 5]) for i in range(len(w) - 4)}
        if len(g) >= 10:
            grams[pid] = g
    ids = sorted(grams)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            share = len(grams[a] & grams[b]) / min(len(grams[a]), len(grams[b]))
            if share > threshold:
                r.error(where, "%s and %s share %d%% of their main text" % (a, b, round(share * 100)))


# --------------------------------------------------------------------------
# the built site
# --------------------------------------------------------------------------

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
        "track", "wbr"}
# All {n} guides (tool pages, the tools hub), the Guides row's hint (the phones'
# menu), and the cards of the page they lead to
GUIDE_LINK = re.compile(r'<a class="(?:tp-all|hub-allguides)" href="([^"]+)">([^<]*)<')
GUIDE_HINT = re.compile(r'<a class="site-menu__row" href="([^"]+)"[^>]*>(?:(?!</a>).)*?'
                        r'<span class="site-menu__hint">([^<]*\d[^<]*)</span>', re.S)
HUB_CARD = re.compile(r'<a class="hub-card" href="([^"]+)"')
# Not the page's own writing: left out of the main text the similarity check reads.
BOILERPLATE = {"breadcrumb", "band", "byline", "credit", "related", "sources", "hub-cards", "hub-aside", "tp-aside",
               "tp-next"}


class Parser(HTMLParser):
    """One pass over a page: well-formedness and everything the checks read."""

    def __init__(self, fragment=False):
        super().__init__(convert_charrefs=True)
        self.fragment = fragment
        self.stack, self.problems = [], []
        self.links, self.assets, self.alternates, self.canonical = [], [], [], []
        self.meta, self.ids, self.scripts = {}, [], []
        self.title, self.lang = None, None
        self._title = None
        self._script = None
        self.main = None          # stack depth of <main>
        self.skip = None          # stack depth of a boilerplate element inside it
        self.main_text = []
        self.headings = []        # the levels of h1 to h6, in order

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag not in VOID:
            self.stack.append(tag)
        if len(tag) == 2 and tag[0] == "h" and tag[1] in "123456":
            self.headings.append(int(tag[1]))
        if a.get("id"):
            self.ids.append(a["id"])
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "title":
            self._title = []
        elif tag == "a" and "href" in a:
            self.links.append(a["href"])
        elif tag == "link":
            rel_ = a.get("rel", "").split()
            if "canonical" in rel_:
                self.canonical.append(a.get("href", ""))
            elif "alternate" in rel_ and "hreflang" in a:
                self.alternates.append((a["hreflang"], a.get("href", "")))
            elif set(rel_) & {"stylesheet", "icon", "apple-touch-icon", "preload", "modulepreload", "manifest"}:
                self.assets.append(a.get("href", ""))
        elif tag == "meta":
            if a.get("name"):
                self.meta[a["name"].lower()] = a.get("content", "")
            if a.get("http-equiv", "").lower() == "refresh":
                self.meta["refresh"] = a.get("content", "")
        elif tag in ("img", "source", "audio", "video") and a.get("src"):
            self.assets.append(a["src"])
        elif tag == "script":
            if a.get("src"):
                self.assets.append(a["src"])
            self._script = {"type": a.get("type", ""), "id": a.get("id"), "text": []}
        if tag == "main" and self.main is None:
            self.main = len(self.stack)
        elif self.main is not None and self.skip is None and (
                tag in ("script", "style", "svg", "nav", "template")
                or set(a.get("class", "").split()) & BOILERPLATE):
            self.skip = len(self.stack)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1] == tag:
            self.end(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag not in self.stack:
            self.problems.append("</%s> closes nothing" % tag)
            return
        while self.stack[-1] != tag:
            self.problems.append("<%s> is not closed before </%s>" % (self.stack[-1], tag))
            self.end(self.stack[-1])
        self.end(tag)

    def end(self, tag):
        depth = len(self.stack)
        if self.skip == depth:
            self.skip = None
        if self.main == depth:
            self.main = -1
        if tag == "title" and self._title is not None:
            self.title = "".join(self._title).strip()
            self._title = None
        if tag == "script" and self._script is not None:
            self._script["text"] = "".join(self._script["text"])
            self.scripts.append(self._script)
            self._script = None
        self.stack.pop()

    def handle_data(self, data):
        if self._title is not None:
            self._title.append(data)
        if self._script is not None:
            self._script["text"].append(data)
        elif self.main is not None and self.main > 0 and self.skip is None:
            self.main_text.append(data)


def url_of(rel_path):
    """The URL a file in the site answers at."""
    p = "/" + rel_path.replace(os.sep, "/")
    if p.endswith("/index.html"):
        p = p[:-len("index.html")]
    return SITE + p


def file_of(site, path):
    """The file a site path is served from, or None."""
    p = path.lstrip("/")
    if p == "" or p.endswith("/"):
        p += "index.html"
    full = os.path.join(site, p)
    return full if os.path.isfile(full) else None


def read_sitemaps(site, r):
    """{loc: (alternates {(hreflang, href)}, lastmod)} from the sitemap index."""
    out = {}
    index = os.path.join(site, "sitemap.xml")
    if not os.path.exists(index):
        r.error("sitemap.xml", "missing")
        return out
    root = ET.parse(index).getroot()
    if root.tag != SITEMAP_NS + "sitemapindex":
        r.error("sitemap.xml", "is not a sitemap index")
        return out
    children = []
    for sm in root.findall(SITEMAP_NS + "sitemap"):
        loc = sm.findtext(SITEMAP_NS + "loc", "")
        last = sm.findtext(SITEMAP_NS + "lastmod", "")
        children.append((loc, last))
    if not children:
        r.error("sitemap.xml", "indexes no sitemap")
    for loc, last in children:
        name = loc[len(SITE) + 1:] if loc.startswith(SITE + "/") else None
        path = os.path.join(site, name) if name else None
        if not path or not os.path.exists(path):
            r.error("sitemap.xml", "%s does not exist" % loc)
            continue
        urlset = ET.parse(path).getroot()
        newest = ""
        for u in urlset.findall(SITEMAP_NS + "url"):
            loc_ = u.findtext(SITEMAP_NS + "loc", "")
            lm = u.findtext(SITEMAP_NS + "lastmod", "")
            if u.find(SITEMAP_NS + "priority") is not None or u.find(SITEMAP_NS + "changefreq") is not None:
                r.error(name, "%s still has priority or changefreq" % loc_)
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", lm):
                r.error(name, "%s has lastmod %r" % (loc_, lm))
            newest = max(newest, lm)
            alts = {(x.get("hreflang"), x.get("href")) for x in u.findall(XHTML_NS + "link")}
            if loc_ in out:
                r.error(name, "%s is listed twice" % loc_)
            out[loc_] = (alts, lm)
        if newest and last != newest:
            r.error("sitemap.xml", "%s has lastmod %s, its newest page %s" % (name, last, newest))
    return out


def check_site(site, r, registry):
    site = os.path.realpath(site)
    for name in (".nojekyll", "robots.txt", "404.html"):
        if not os.path.exists(os.path.join(site, name)):
            r.error(name, "missing")
    robots = os.path.join(site, "robots.txt")
    if os.path.exists(robots):
        t = open(robots, encoding="utf-8").read()
        if not re.search(r"(?m)^Disallow: /tool/$", t):
            r.error("robots.txt", "does not disallow /tool/")
        if "Sitemap: %s/sitemap.xml" % SITE not in t:
            r.error("robots.txt", "does not point at the sitemap index")

    sitemap = read_sitemaps(site, r)
    pages, stubs, pids = {}, {}, {}
    for dirpath, dirnames, filenames in os.walk(site):
        if dirpath == site:
            dirnames[:] = [d for d in dirnames if d not in (".git", "tool", "node_modules") + B.STATIC]
        for f in filenames:
            full = os.path.join(dirpath, f)
            relp = os.path.relpath(full, site)
            if f.endswith((".html", ".xml", ".txt")):
                text = open(full, encoding="utf-8", errors="replace").read()
                if EM_DASH.search(text):
                    r.error(relp, "has an em dash")
            if not f.endswith(".html"):
                continue
            p = Parser()
            try:
                p.feed(text)
                p.close()
            except Exception as e:
                r.error(relp, "does not parse: %s" % e)
                continue
            for problem in p.problems + ["<%s> is not closed" % t for t in p.stack]:
                r.error(relp, problem)
            dup = sorted({i for i in p.ids if p.ids.count(i) > 1})
            if dup:
                r.error(relp, "repeats id %s" % ", ".join(dup))
            u = url_of(relp)
            if relp == "404.html":
                check_404(p, relp, r)
            elif "refresh" in p.meta:
                stubs[u] = (relp, p)
            else:
                pages[u] = (relp, p)
                pids[u] = page_id_of(u, text)

    canonical = set(sitemap)
    for u in canonical:
        if u not in pages:
            r.error("sitemap", "%s is listed, but no page answers there" % u)
    titles, descriptions = {}, {}
    inbound = {u: set() for u in pages}
    edges = {u: set() for u in pages}
    lastmods = load_lastmod(site)
    for u, (relp, p) in sorted(pages.items()):
        check_page_html(u, relp, p, pages, sitemap, canonical, site, r, inbound, edges)
        code = code_of(u)
        titles.setdefault((code, p.title), []).append(relp)
        descriptions.setdefault((code, p.meta.get("description")), []).append(relp)
        if lastmods is not None and u in sitemap and lastmods.get(u, {}).get("lastmod") != sitemap[u][1]:
            r.error(relp, "lastmod in the sitemap is not the one tool/lastmod.json holds")
    for u, (relp, p) in sorted(pages.items()):
        check_play_links(u, relp, p, pids[u], r)
    for (code, t), files in sorted(titles.items(), key=str):
        if len(files) > 1:
            r.error("titles", "%s share the title %r" % (", ".join(files), t))
    for (code, d), files in sorted(descriptions.items(), key=str):
        if len(files) > 1:
            r.error("descriptions", "%s share the description %r" % (", ".join(files), d))
    for u, (relp, p) in sorted(stubs.items()):
        m = re.match(r"\s*0\s*;\s*url=(.+)$", p.meta["refresh"])
        target = urljoin(u, m.group(1).strip()) if m else None
        if target not in canonical:
            r.error(relp, "is a stub to %s, which is not a page" % target)
        if p.canonical != [target]:
            r.error(relp, "a stub's canonical is its target")

    # the link graph
    alts_of = {u: {h for _, h in p.alternates} for u, (_, p) in pages.items()}
    for u, (relp, p) in sorted(pages.items()):
        others = inbound[u] - alts_of[u] - {u}
        if not others:
            r.error(relp, "is an orphan: no other page links to it")
    homes = {code: SITE + B.LOC[code][1] for code in CODES}
    for code, home in homes.items():
        if home not in pages:
            continue
        depth = {home: 0}
        todo = [home]
        while todo:
            nxt = []
            for v in todo:
                for w in edges.get(v, ()):
                    if w not in depth:
                        depth[w] = depth[v] + 1
                        nxt.append(w)
            todo = nxt
        for u, (relp, p) in sorted(pages.items()):
            if code_of(u) != code:
                continue
            if u not in depth:
                r.error(relp, "cannot be reached from %s" % home)
            elif depth[u] > 3:
                r.error(relp, "is %d clicks from %s, more than 3" % (depth[u], home))

    # All {n} guides and the Guides hint promise as many guides as the page they lead to lists
    listed = {}
    for u, (relp, p) in sorted(pages.items()):
        text = open(os.path.join(site, relp), encoding="utf-8").read()
        for href, said in GUIDE_LINK.findall(text) + GUIDE_HINT.findall(text):
            target = urljoin(u, href)
            if target not in listed:
                there = pages.get(target)
                listed[target] = len(set(HUB_CARD.findall(
                    open(os.path.join(site, there[0]), encoding="utf-8").read()))) if there else None
            n = re.search(r"\d+", said)
            if listed[target] is not None and (not n or int(n.group(0)) != listed[target]):
                r.error(relp, "%r leads to %s, which lists %d guides" % (said.strip(), href, listed[target]))

    # similarity of the written main text, per locale
    for code in CODES:
        texts = {relp: " ".join(p.main_text) for u, (relp, p) in pages.items() if code_of(u) == code and p.main_text}
        similar(texts, "site %s" % code, r)

    # every URL ever published still answers
    published = os.path.join(B.TOOL, "published-urls.txt")
    if os.path.exists(published):
        for line in open(published, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#"):
                path = s.split()[0]
                if SITE + path not in pages and SITE + path not in stubs:
                    r.error("tool/published-urls.txt", "%s was published and is gone" % path)


def check_sources(r):
    """No em dash in the site's own code either: scripts, styles, the tool."""
    for top in ("js", "css", "tool"):
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, top)):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__pycache__")]
            for f in filenames:
                if f.endswith((".js", ".mjs", ".css", ".py", ".md", ".dart", ".txt", ".json")):
                    full = os.path.join(dirpath, f)
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        if "\u2014" in fh.read():
                            r.error(B.rel(full), "has an em dash")


def load_lastmod(site):
    path = os.path.join(site, "tool", "lastmod.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def code_of(u):
    path = u[len(SITE):]
    first = path.strip("/").split("/")[0]
    return first if first in CODES and first != "en" else "en"


def is_legacy(u):
    path = u[len(SITE):]
    return path.endswith(".html") or path in ["/"] + ["/%s/" % c for c in CODES]


def check_page_html(u, relp, p, pages, sitemap, canonical, site, r, inbound, edges):
    code = code_of(u)
    if p.lang != LANG_OF[code]:
        r.error(relp, "<html lang=%r>, the locale's is %r" % (p.lang, LANG_OF[code]))
    if p.canonical != [u]:
        r.error(relp, "canonical %s is not the page itself, %s" % (p.canonical, u))
    if u not in sitemap:
        r.error(relp, "is not in any sitemap")
    elif set(p.alternates) != sitemap[u][0]:
        r.error(relp, "its hreflang links and the sitemap's differ")
    if not p.title:
        r.error(relp, "has no <title>")
    # one h1, and an outline that skips no level on the way down
    if p.headings.count(1) != 1:
        r.error(relp, "has %d h1 elements, not one" % p.headings.count(1))
    skips = sorted({"h%d after h%d" % (b, a) for a, b in zip(p.headings, p.headings[1:]) if b > a + 1})
    if skips:
        r.note(relp, "its headings skip a level: %s" % ", ".join(skips))
    if not p.meta.get("description"):
        r.error(relp, "has no meta description")
    if "keywords" in p.meta:
        r.error(relp, "has a keywords meta")
    # hreflang: reciprocal, complete, pt beside pt-BR, x-default English
    langs = dict(p.alternates)
    if len(langs) != len(p.alternates):
        r.error(relp, "repeats an hreflang")
    own = B.hreflangs(code)
    for hl in own:
        if langs.get(hl) != u:
            r.error(relp, "does not list itself as %s" % hl)
    if "pt-BR" in langs and langs.get("pt") != langs["pt-BR"]:
        r.error(relp, "lists pt-BR without pt beside it")
    if langs.get("x-default") is None:
        r.error(relp, "has no x-default")
    for hl, href in p.alternates:
        if href not in pages:
            r.error(relp, "hreflang %s points at %s, which is not a page" % (hl, href))
            continue
        back = dict(pages[href][1].alternates)
        if hl != "x-default" and any(back.get(x) != u for x in own):
            r.error(relp, "hreflang %s -> %s does not link back" % (hl, href))
    # JSON in the page
    types = []
    for s in p.scripts:
        t = s["text"]
        if s["type"] in ("application/ld+json", "application/json", "importmap"):
            if "<" in t:
                r.error(relp, "a %s script holds a raw '<'" % s["type"])
            try:
                obj = json.loads(t)
            except ValueError as e:
                r.error(relp, "a %s script is not valid JSON: %s" % (s["type"], e))
                continue
            if s["type"] == "application/ld+json":
                for item in obj if isinstance(obj, list) else [obj]:
                    types.append(item.get("@type"))
                    for offer in walk_offers(item):
                        if str(offer.get("price")) not in ("0", "0.0", "0.00"):
                            r.error(relp, "an Offer with price %r: the app's only Offer is free" % offer.get("price"))
            elif s["type"] == "importmap":
                for k, v in (obj.get("imports") or {}).items():
                    check_asset(v, u, relp, site, r)
            elif s.get("id") == "page-data":
                for k in ("locale", "pageId", "strings", "notes", "voiceTypes", "registers", "playLink",
                          "androidOnlyLine", "iphone", "piano", "players"):
                    if k not in obj:
                        r.error(relp, "page data has no %r" % k)
                if obj.get("locale") != code:
                    r.error(relp, "page data says locale %r" % obj.get("locale"))
    for t in types:
        if t in ("FAQPage", "HowTo"):
            r.error(relp, "has %s structured data, which Google no longer shows" % t)
    if "WebSite" in types and u != SITE + "/":
        r.error(relp, "has WebSite structured data, which belongs on the root home only")
    if not is_legacy(u) and "BreadcrumbList" not in types:
        r.error(relp, "has no BreadcrumbList")
    # assets
    for a in p.assets:
        check_asset(a, u, relp, site, r)
    # links
    for href in p.links:
        if href.startswith("page:"):
            r.error(relp, "has an unresolved link %s" % href)
            continue
        if href.startswith(("mailto:", "tel:", "#")) or href == "":
            continue
        absu = urljoin(u, href)
        parts = urlsplit(absu)
        if parts.netloc != "scalita.com":
            continue
        if "index.html" in parts.path:
            r.error(relp, "links to %s: never to index.html" % href)
        target = "%s://%s%s" % (parts.scheme, parts.netloc, parts.path)
        if target in canonical:
            inbound.setdefault(target, set()).add(u)
            edges[u].add(target)
            if parts.fragment and target in pages and parts.fragment not in pages[target][1].ids:
                r.warn(relp, "links to %s, and that page has no id %r" % (href, parts.fragment))
        elif parts.path.endswith((".html", "/")) or "." not in parts.path.rsplit("/", 1)[-1]:
            r.error(relp, "links to %s, which is not a page's canonical URL" % href)
        elif not file_of(site, parts.path):
            r.error(relp, "links to %s, which does not exist" % href)


PLAY_PREFIX = "https://play.google.com/store/apps/details"
BANNER_PAGE = re.compile(r"Generated by tool/build\.py from tool/content/pages/[a-z]+/([a-z0-9-]+)\.json")


def page_id_of(u, text):
    """The registry id a built page was made for: from its banner, or for the
    four legacy pages (whose banner names only the locale), from the file."""
    m = BANNER_PAGE.search(text[:400])
    if m:
        return m.group(1)
    name = u[len(SITE):].rstrip("/").rsplit("/", 1)[-1]
    return name[:-5] if name.endswith(".html") else "index"


def walk_keys(obj, keys):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, str):
                yield k, v
            else:
                yield from walk_keys(v, keys)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_keys(v, keys)


def check_play_links(u, relp, p, pid, r):
    """Every Play link a page carries (its links, the app's installUrl, the
    page data's playLink) opens the app's listing, in the page's language
    except in English, and tags the install with the locale and the page id
    (plan 6.1): utm_source=scalita_<code>, utm_medium=web, utm_campaign=<id>."""
    code = code_of(u)
    found = [("link", h) for h in p.links if h.startswith(PLAY_PREFIX)]
    for s in p.scripts:
        if s["type"] in ("application/ld+json", "application/json"):
            try:
                found += list(walk_keys(json.loads(s["text"]), ("installUrl", "playLink")))
            except ValueError:
                pass   # reported with the page's other JSON
    want = "utm_source=scalita_%s&utm_medium=web&utm_campaign=%s" % (code, pid)
    for what, href in found:
        q = parse_qs(urlsplit(href).query)
        if not href.startswith(PLAY_PREFIX) or q.get("id") != ["com.scalita.app"]:
            r.error(relp, "Play %s %s is not the app's listing" % (what, href))
        if code == "en" and "hl" in q:
            r.error(relp, "Play %s sets hl on an English page: Play picks the reader's language" % what)
        elif code != "en" and q.get("hl") != [LANG_OF[code]]:
            r.error(relp, "Play %s has hl %s, the page's language is %s" % (what, q.get("hl"), LANG_OF[code]))
        if q.get("referrer") != [want]:
            r.error(relp, "Play %s referrer is %s, not %s" % (what, q.get("referrer"), want))


def walk_offers(obj):
    if isinstance(obj, dict):
        if obj.get("@type") == "Offer":
            yield obj
        for v in obj.values():
            yield from walk_offers(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_offers(v)


def check_asset(a, u, relp, site, r):
    if a.startswith(("data:", "https://", "http://")):
        if a.startswith(("https://fonts.", "http://")):
            r.error(relp, "loads %s from outside the site" % a)
        return
    if not a.startswith("/"):
        r.error(relp, "asset %s is not root-absolute" % a)
    parts = urlsplit(urljoin(u, a))
    full = file_of(site, parts.path)
    if full is None:
        r.error(relp, "asset %s does not exist" % a)
        return
    m = re.search(r"(?:^|&)v=([0-9a-f]+)", parts.query)
    if m:
        with open(full, "rb") as fh:
            h = hashlib.sha256(fh.read()).hexdigest()[:len(m.group(1))]
        if h != m.group(1):
            r.warn(relp, "asset %s is versioned with an old hash: rebuild" % a)


def check_404(p, relp, r):
    if p.meta.get("robots", "").lower() != "noindex":
        r.warn(relp, "has no noindex")
    for href in p.links + p.assets:
        if not href.startswith(("/", "https://", "mailto:", "#")):
            r.error(relp, "%s is not root-absolute, and the 404 answers at every depth" % href)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check scalita.com and its content files.")
    ap.add_argument("--site", default=ROOT, help="the built site (default: the repo root)")
    ap.add_argument("--content", default=os.path.join(B.TOOL, "content"),
                    help="the content directory (default: tool/content)")
    ap.add_argument("--content-only", action="store_true", help="check the content files only")
    ap.add_argument("--locale", choices=CODES, help="with --content-only: one locale's files")
    ap.add_argument("--strict", action="store_true", help="warnings fail too (before publishing)")
    args = ap.parse_args(argv)
    if args.locale and not args.content_only:
        ap.error("--locale goes with --content-only")
    r = Report(args.strict)
    registry = load(os.path.join(B.TOOL, "pages.json"), r) or []
    check_content(os.path.realpath(args.content), args.locale, r, registry)
    if not args.content_only:
        check_site(args.site, r, registry)
        check_sources(r)
    return r.show()


if __name__ == "__main__":
    sys.exit(main())
