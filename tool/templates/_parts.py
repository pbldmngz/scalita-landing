"""Pieces the page templates share.

Every function returns HTML that is escaped where it needs to be: copy fields
that hold HTML (tool/README.md, "Page files") go in as they are, plain text
and the app's data go through ctx.esc().

Layout (what css/style.css expects): build.py writes the breadcrumb inside
<main>; a template's body is one <div class="container"><article
class="prose"> holding the H1, the lead and the blocks below. A block that
needs styled <h2>, <p> and <ul> children is a plain <section> (no class).

Words a template prints around the copy come from three places, never from
this file: the copy itself, the app's own strings (tool/data/app/strings.json,
intake.json, the localized names in the export), and
tool/content/ui/<loc>/templates.json for the few labels the app has no
string for. Note names come from the export, always paired with the
international name ("Do3 (C4)").
"""

import re

BLACK = {1, 3, 6, 8, 10}

# --------------------------------------------------------------------------
# icons
# --------------------------------------------------------------------------

# The site's one icon set (docs/specs/site-redesign-spec.md, section 7): 24 x
# 24, outlined, drawn in currentColor. Sizes: 18 in the nav, 22 in the tab bar
# and on tiles, 16 small, 14 in pills. A name in FILLED is a solid shape.
ICONS = {
    "home": '<path d="M4 11.5l8-7 8 7V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    "range": '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    "tune": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    "piano": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 13v7M15 13v7"/>'
             '<rect x="7.5" y="4" width="3" height="9" rx=".5"/><rect x="13.5" y="4" width="3" height="9" rx=".5"/>',
    "break": '<path d="M3 20h5v-5h4v-5h4V5h5"/>',
    "globe": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    "download": '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
    "iphone": '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    "fullscreen": '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
    "exit": '<path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M20 15h-4a1 1 0 0 0-1 1v4M4 15h4a1 1 0 0 1 1 1v4"/>',
    "chevron-down": '<path d="M5 9l7 7 7-7"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "mic": '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    "headphones": '<path d="M4 12a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-1v-6h3M4 12h3v7H6a2 2 0 0 1-2-2z"/>',
    "lock": '<rect x="5" y="10.5" width="14" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5M12 17h.01"/>',
    "play": '<path d="M7 4.5v15l12.5-7.5z"/>',
    "stop": '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    "redo": '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    "image": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    "share": '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "close": '<path d="M6 6l12 12M18 6L6 18"/>',
    "features": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    "pricing": '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    "tools": '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/>'
             '<rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    "guides": '<path d="M3 5c3 0 6 .6 9 2 3-1.4 6-2 9-2v13c-3 0-6 .6-9 2-3-1.4-6-2-9-2zM12 7v13"/>',
    "support": '<path d="M4 5h16v11H9l-5 4z"/>',
    "wifi-off": '<path d="M5 10.5a10 10 0 0 1 14 0M8.5 14a5 5 0 0 1 7 0M12 17.5h.01M4 4l16 16"/>',
    "no-ads": '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    "user-off": '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0M4 4l16 16"/>',
}
# the names the spec gives in brackets
for _alias, _name in (("sparkle", "features"), ("tag", "pricing"), ("grid", "tools"), ("book", "guides"),
                      ("chat", "support"), ("keyboard", "piano"), ("no-mic", "headphones")):
    ICONS[_alias] = ICONS[_name]
FILLED = {"play", "stop"}

# Each tool's icon, by page id: the switcher, the tab bar, the hub's tiles.
TOOL_ICONS = {"vocal-range-test": "range", "sing-in-tune-test": "tune", "warm-up-piano": "piano",
              "voice-break-finder": "break"}

# The mark: four bars, the colours of --logo-a and --logo-b.
LOGO = ('<rect x="214" y="480" width="104" height="352" rx="32" fill="#549296"/>'
        '<rect x="378" y="288" width="104" height="352" rx="32" fill="#6FAAA9"/>'
        '<rect x="542" y="384" width="104" height="352" rx="32" fill="#549296"/>'
        '<rect x="706" y="192" width="104" height="352" rx="32" fill="#6FAAA9"/>')


def icon(name, size=24, cls=""):
    """An icon of the set as inline SVG, hidden from assistive technology:
    the text beside it, or its control's label, says what it means.
    "logo" is the four-bar mark."""
    c = ' class="%s"' % cls if cls else ""
    if name == "logo":
        return '<svg%s width="%d" height="%d" viewBox="0 0 1024 1024" aria-hidden="true">%s</svg>' % (c, size, size, LOGO)
    paint = ('fill="currentColor"' if name in FILLED else
             'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"')
    return '<svg%s width="%d" height="%d" viewBox="0 0 24 24" %s aria-hidden="true">%s</svg>' % (
        c, size, size, paint, ICONS[name])


# --------------------------------------------------------------------------
# strings and data
# --------------------------------------------------------------------------

_LOCAL = {}


def local(ctx, stem):
    """An export file localized to the page's locale, worked out once per
    build and locale (the cache holds the file it was made from)."""
    raw = ctx.data[stem]
    hit = _LOCAL.get((stem, ctx.code))
    if hit is None or hit[0] is not raw:
        hit = (raw, ctx.localize(raw))
        _LOCAL[(stem, ctx.code)] = hit
    return hit[1]


def find(items, item_id):
    for e in items:
        if e.get("id") == item_id:
            return e
    return None


def app(ctx):
    """The locale's app strings (strings.json)."""
    return local(ctx, "strings")


def label(ctx, path, **values):
    """A label from ui/<loc>/templates.json with its {placeholders} filled
    in, not escaped. Empty when the file is not written yet (an
    --allow-missing build; a strict one has already failed on it)."""
    d = ctx.ui["templates"]
    if not d:
        return ""
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    if not isinstance(d, str):
        raise KeyError("tool/content/ui/en/templates.json has no %s" % path)
    for k, v in values.items():
        d = d.replace("{%s}" % k, str(v))
    return d


def L(ctx, path, **values):
    """label(), escaped."""
    return ctx.esc(label(ctx, path, **values))


def note(ctx, midi):
    """A key as the page writes it, "Do3 (C4)", or "C4" where the two names
    are the same. Not escaped."""
    loc, intl = ctx.note(midi)
    return loc if loc == intl else "%s (%s)" % (loc, intl)


def from_to(ctx, low, high):
    return L(ctx, "voices.fromTo", low=note(ctx, low), high=note(ctx, high))


def date_text(ctx, iso):
    """A YYYY-MM-DD date as the locale writes it, from templates.json's
    dates (months and pattern): "25 October 2026". Not escaped. The date
    as it is when the file is not written yet (an --allow-missing build)."""
    y, m, d = (int(x) for x in iso.split("-"))
    dates = (ctx.ui["templates"] or {}).get("dates") or {}
    months = dates.get("months") or []
    if len(months) != 12 or not dates.get("pattern"):
        return iso
    # French writes the first of a month as an ordinal: "1er octobre"
    day = "1er" if ctx.code == "fr" and d == 1 else str(d)
    return dates["pattern"].replace("{d}", day).replace("{month}", months[m - 1]).replace("{y}", str(y))


# --------------------------------------------------------------------------
# page frame
# --------------------------------------------------------------------------

def article(blocks):
    """The page body: the blocks in the article the stylesheet styles."""
    inner = "\n\n".join(b.strip("\n") for b in blocks if b and b.strip())
    return '    <div class="container">\n      <article class="prose">\n%s\n      </article>\n    </div>' % inner


def page_head(ctx):
    c = ctx.copy
    return "<h1>%s</h1>\n<p class=\"lead\">%s</p>" % (ctx.esc(c["h1"]), ctx.esc(c["lead"]))


HEADING = re.compile(r"^\s*(<h[23]\b[^>]*>.*?</h[23]>)(.*)$", re.S | re.I)


def split_heading(html):
    """(the heading a copy field opens with, the rest), or (None, html)."""
    m = HEADING.match(html or "")
    return (m.group(1), m.group(2)) if m else (None, html or "")


LIST = re.compile(r"<(ul|ol)\b", re.I)


def boxed(html):
    """Copy HTML for inside a box (a callout, a result card). The stylesheet
    styles lists only as direct children of the article or of a plain
    section, so HTML with a list goes in a plain section of its own."""
    html = (html or "").strip("\n")
    return "<section>\n%s\n</section>" % html if LIST.search(html) else html


def section(heading, inner, sid=None):
    """A plain <section> with an <h2>; heading is escaped text or ""."""
    attr = ' id="%s"' % sid if sid else ""
    h = "<h2>%s</h2>\n" % heading if heading else ""
    return "<section%s>\n%s%s\n</section>" % (attr, h, inner.strip("\n"))


def field(ctx, key, heading_path, sid=None):
    """A copy field holding HTML, under the template's heading unless the
    field opens with its own."""
    html = ctx.copy.get(key)
    if not html:
        return ""
    own, rest = split_heading(html)
    if own:
        return "<section%s>\n%s\n%s\n</section>" % (' id="%s"' % sid if sid else "", own, rest.strip("\n"))
    return section(L(ctx, heading_path), html, sid)


def box(html, heading=None, caution=False, level=3):
    """Copy HTML as a boxed aside (.callout). A heading the copy opens with
    becomes the box's heading, an <h3> (level 2 for a box that follows the
    page's h1, so no level is skipped); else heading (escaped text), if any."""
    own, rest = split_heading(html)
    tag = "h%d" % level
    if own:
        head = re.sub(r"^<h[23]\b", "<" + tag, re.sub(r"</h[23]>$", "</%s>" % tag, own, flags=re.I), flags=re.I)
    else:
        head = "<%s>%s</%s>" % (tag, heading, tag) if heading else ""
    cls = "callout callout--caution" if caution else "callout"
    return '<aside class="%s">\n%s%s\n</aside>' % (cls, head + "\n" if head else "", boxed(rest))


def callout(ctx, key, heading_path, caution=False, level=3):
    """A copy field as a boxed aside, under its own heading or the template's."""
    html = ctx.copy.get(key)
    return box(html, L(ctx, heading_path), caution, level) if html else ""


def prose(ctx, sections):
    """The copy's sections: a heading and its HTML each."""
    return "\n\n".join(section(ctx.esc(s["heading"]), s["html"]) for s in sections or [])


def intro(ctx):
    return ctx.copy.get("intro") or ""


def cards(ctx, ids, level=2):
    """One card per page: its label (an h2: on a hub the cards follow the h1
    directly; level 3 for cards under a section's h2) and its description.
    Pages this build does not have in the locale are left out."""
    items = []
    for pid in ids:
        other = ctx.copy_of(pid) if ctx.has(pid) else None
        if other is None:
            continue
        items.append('  <li><a class="hub-card" href="%s"><h%d>%s</h%d><p>%s</p></a></li>'
                     % (ctx.url(pid), level, ctx.esc(other["label"]), level, ctx.esc(other["description"])))
    return '<ul class="hub-cards">\n%s\n</ul>' % "\n".join(items) if items else ""


def accordion(head, body, open_=False, face="list", cls="", attrs=""):
    """A disclosure the stylesheet draws as .acc (spec 2.6): head is the
    summary's HTML (on the list face a real heading, never a link or a
    button: a summary holds nothing interactive), body the HTML it opens on.
    face "list" is a row of a reference or FAQ list, "pill" the How it works
    button. attrs: more attributes for the <details>, written as they go."""
    return '<details %sclass="acc acc--%s%s"%s>\n<summary class="acc__head">%s%s</summary>\n' \
           '<div class="acc__body">\n%s\n</div>\n</details>' % (
               attrs + " " if attrs else "", face, " " + cls if cls else "", " open" if open_ else "", head,
               icon("chevron-down", 16 if face == "pill" else 20, "acc__chev"), (body or "").strip("\n"))


def faq(ctx, items, level=2, heading=True):
    """The copy's FAQ as closed .acc--list accordions (no FAQPage markup):
    the section's heading at <h{level}>, each question an <h{level+1}> in
    its summary, the answer in the body. heading=False leaves the section's
    own heading out, for a template that prints it elsewhere."""
    if not items:
        return ""
    q = level + 1
    rows = "\n".join(accordion("<h%d>%s</h%d>" % (q, ctx.esc(i["q"]), q), i["a"]) for i in items)
    head = "<h%d>%s</h%d>\n" % (level, ctx.esc(ctx.site["faq"]["heading"]), level) if heading else ""
    return '<section class="faq">\n%s%s\n</section>' % (head, rows)


def sources(ctx, items):
    """The copy's sources, numbered, each a link out."""
    if not items:
        return ""
    li = "\n".join('  <li><a href="%s" target="_blank" rel="noopener">%s</a></li>'
                   % (ctx.esc(s["url"]), ctx.esc(s["label"])) for s in items)
    return '<section class="sources">\n<h2>%s</h2>\n<ol>\n%s\n</ol>\n</section>' % (
        ctx.esc(ctx.site["sources"]["heading"]), li)


def finish(ctx, blocks, related_ids):
    """The blocks every page ends with, then the whole body: FAQ, the call to
    action, 3 to 5 related pages, the sources and the byline."""
    c = ctx.copy
    tail = [faq(ctx, c.get("faq")), ctx.cta(), ctx.related(pick(ctx, related_ids)),
            sources(ctx, c.get("sources")), ctx.byline()]
    return article([page_head(ctx)] + list(blocks) + tail)


def pick(ctx, ids, most=5):
    """Related page ids: built in this locale, not this page, no repeats."""
    out = []
    for i in ids:
        if i and i not in out and i != ctx.page["id"] and ctx.has(i):
            out.append(i)
    return out[:most]


def result(body, players=None):
    """render()'s return value. build.py adds BreadcrumbList and Article or
    WebApplication itself, so jsonld stays empty; players go into the page
    data (build.py merges them by key)."""
    return {"body": body, "jsonld": [], "head_extra": "", "page_data": {"players": players} if players else {}}


# --------------------------------------------------------------------------
# the registry, read through the data
# --------------------------------------------------------------------------

def entry(ctx, page_id):
    """A page's registry entry."""
    return next(e for e in ctx.registry if e["id"] == page_id)


def page_for(ctx, kind, item_id):
    """The page about a routine or scale, when this locale has one."""
    key = kind + "Id"
    for p in ctx.registry:
        if (p.get("data") or {}).get(key) == item_id and ctx.has(p["id"]):
            return p["id"]
    return None


def pages_of(ctx, template):
    return [p["id"] for p in ctx.registry if p["template"] == template and ctx.has(p["id"])]


def exercise_pages_for(ctx, syllables):
    """Exercise pages about any of these syllable ids."""
    out = []
    for pid in pages_of(ctx, "exercise"):
        if set((ctx.copy_of(pid) or {}).get("syllables") or []) & set(syllables):
            out.append(pid)
    return out


def link(ctx, pid, text):
    """text, linked to the page pid when this locale has it."""
    if pid and ctx.has(pid):
        return '<a href="%s">%s</a>' % (ctx.url(pid), ctx.esc(text))
    return ctx.esc(text)


def routine_name(ctx, routine_id):
    r = ctx.data.entry("routines", routine_id)
    return ctx.localize(r["names"]) if r else routine_id


def scale_name(ctx, scale_id):
    s = ctx.data.entry("scales", scale_id)
    return ctx.localize(s["names"]) if s else scale_id


# --------------------------------------------------------------------------
# mount points and page data
# --------------------------------------------------------------------------

def noscript(ctx, cls):
    return '<noscript><p class="%s">%s</p></noscript>' % (cls, ctx.esc(ctx.ui["common"].get("noScript", "")))


# The height a tool's panel reserves before its script runs is the
# stylesheet's --panel-min (460px by default). The two tools that listen keep
# more, per width, so that starting a run does not push the page down: each
# value is the tallest any locale's run reached there (from 960 to 1099 px
# the range test's result, which a desktop shows in the same room), measured
# through the fake microphone (tool/tests/e2e/run.py holds them still at 360,
# 768 and 900 px). The range test's are in css/style.css, as its own
# stylesheet is at its budget; the sing-in-tune test's in css/tool-tune.css.


def tool_panel(ctx, tool_id):
    """A tool's mount point: build.py adds its module script for it."""
    return '<div class="tool-panel" data-tool="%s">%s</div>' % (tool_id, noscript(ctx, "tool-panel__hint"))


def tool_aside(ctx, tool_id, inner=""):
    """The slot beside How it works that a tool fills from its script (spec
    3.7): the range test's no-microphone link, the sing-in-tune test's voice
    choice. inner is what it holds before the script runs, if anything (a
    plain link that works without it keeps the row from shifting)."""
    return '<div class="tp-side" data-tool-slot="aside" data-for="%s">%s</div>' % (tool_id, inner)


def player_mount(ctx, key="main"):
    return '<div class="player" data-tool="player" data-player="%s">%s</div>' % (key, noscript(ctx, "player__status"))


def player_section(ctx):
    """The player, under a heading, with the piano credit after it."""
    return section(L(ctx, "player.heading"), player_mount(ctx) + "\n" + ctx.credit())


def player_entries(ctx, items, default=None):
    """The page data's players for the "main" mount when it plays one of
    several routines or scales, (kind, id) pairs: the shape js/tools/
    player.js reads, {"kind": "chooser", "items": [entry, ...], "selected":
    "<kind>:<id>"}, each entry ctx.player_data(kind, id). It opens on
    default, or on the first item. One item is that item's entry alone."""
    items = [i for i in items if i]
    entries = [ctx.player_data(kind, item_id) for kind, item_id in items]
    if not entries:
        return {}
    if len(entries) == 1:
        return {"main": entries[0]}
    first = default if default in items else items[0]
    return {"main": {"kind": "chooser", "items": entries, "selected": "%s:%s" % first}}


# --------------------------------------------------------------------------
# keyboards and data tables
# --------------------------------------------------------------------------

def keyboard(ctx, low, high, rng=None, primo=None, secondo=None, aria="", labels="c"):
    """A static keyboard (.keyboard, one .key per semitone), widened to a
    white key at each end. rng=(low, high) colours those keys; primo and
    secondo mark the two breaks; labels "c" names each C, "white" every
    white key, in the locale's notation."""
    low, high = max(21, low), min(108, high)
    while low > 21 and low % 12 in BLACK:
        low -= 1
    while high < 108 and high % 12 in BLACK:
        high += 1
    keys, whites = [], 0
    for m in range(low, high + 1):
        black = m % 12 in BLACK
        whites += 0 if black else 1
        cls = ["key"]
        if black:
            cls.append("key--black")
        if rng and rng[0] <= m <= rng[1]:
            cls.append("key--range")
        if m == primo:
            cls.append("key--primo")
        if m == secondo:
            cls.append("key--secondo")
        text = ""
        if not black and (labels == "white" or (labels == "c" and m % 12 == 0)):
            text = ctx.esc(ctx.note(m)[0])
        keys.append('<span class="%s">%s</span>' % (" ".join(cls), text))
    return '<div class="keyboard" style="--whites: %d" role="img" aria-label="%s">%s</div>' % (
        whites, ctx.esc(aria), "".join(keys))


def table(head, rows, cards=False):
    """A data table: head is the escaped header texts, or None for a table
    whose row headers say it all; each row is (row header HTML, [cell
    HTML], extra <tr> attributes). cards (.steps-table) shows each row as a
    card on phones, every cell under its header (td[data-label]): for
    tables too wide for a phone."""
    body = []
    for row_head, cells, attrs in rows:
        tds = "".join(('<td data-label="%s">%s</td>' % (head[n + 1], cell)) if head else "<td>%s</td>" % cell
                      for n, cell in enumerate(cells))
        body.append("  <tr%s><th scope=\"row\">%s</th>%s</tr>" % (attrs, row_head, tds))
    thead = ""
    if head:
        thead = "<thead><tr>%s</tr></thead>\n" % "".join('<th scope="col">%s</th>' % h for h in head)
    cls = ' class="steps-table"' if cards else ""
    return '<table%s>\n%s<tbody>\n%s\n</tbody>\n</table>' % (cls, thead, "\n".join(body))


def voice_keyboard(ctx, v):
    lo, hi = v["rangeLow"], v["rangeHigh"]
    aria = label(ctx, "voices.keyboard", name=v["name"], low=note(ctx, lo), high=note(ctx, hi))
    return keyboard(ctx, lo - 3, hi + 3, rng=(lo, hi), primo=v["primo"], secondo=v["secondo"], aria=aria)


def voice_table(ctx, anchors=False):
    """The six voice types: typical range and the two breaks. anchors links
    each name to its block on the page, #<voice type id>."""
    head = [L(ctx, "voices.voiceType"), L(ctx, "voices.range"), L(ctx, "voices.primo"), L(ctx, "voices.secondo")]
    rows = []
    for v in local(ctx, "voice_types"):
        name = ctx.esc(v["name"])
        if anchors:
            name = '<a href="#%s">%s</a>' % (v["id"], name)
        rows.append((name, [from_to(ctx, v["rangeLow"], v["rangeHigh"]), ctx.esc(note(ctx, v["primo"])),
                            ctx.esc(note(ctx, v["secondo"]))], ""))
    return table(head, rows, cards=True)


def voice_chart(ctx):
    """The six voice types: the table, a keyboard each under its name, and
    the note that the numbers are classical averages."""
    parts = [voice_table(ctx)]
    for v in local(ctx, "voice_types"):
        parts.append("<h3>%s</h3>\n%s" % (ctx.esc(v["name"]), voice_keyboard(ctx, v)))
    parts.append("<p>%s</p>" % L(ctx, "voices.note"))
    return "\n".join(parts)


def register_table(ctx):
    """Scalita's register spans: name, what it is, where it sits."""
    head = [L(ctx, "registers.register"), L(ctx, "registers.span")]
    rows = []
    for r in local(ctx, "registers"):
        rows.append(("%s<br><small>%s</small>" % (ctx.esc(r["name"]), ctx.esc(r["description"])),
                     [from_to(ctx, r["low"], r["high"])], ""))
    return table(head, rows) + "\n<p>%s</p>" % L(ctx, "registers.note")


def span_text(ctx, step):
    if step.get("register"):
        reg = find(local(ctx, "registers"), step["register"])
        return ctx.esc(reg["name"] if reg else step["register"])
    if step.get("span") is None:
        return L(ctx, "steps.wholeRange")
    return L(ctx, "steps.semitones", count=step["span"])


def steps_table(ctx, entry):
    """A routine's steps, in the locale's words: scale (and its cues),
    respelled syllable, tempo, style, direction, span, and the voice-break
    target and repeats where any step has them."""
    s = app(ctx)
    steps = entry.get("steps") or []
    passaggio = any(st.get("passaggioIntent") not in (None, "none") for st in steps)
    repeat = any((st.get("repeatCount") or 1) > 1 for st in steps)
    head = [L(ctx, "steps.scale"), L(ctx, "steps.syllable"), ctx.esc(s["step"]["tempo"]), L(ctx, "steps.style"),
            ctx.esc(s["directions"]["label"]), L(ctx, "steps.span")]
    if passaggio:
        head.append(L(ctx, "steps.passaggio"))
    if repeat:
        head.append(L(ctx, "steps.repeat"))
    scales = entry.get("scales") or {}
    rows = []
    for n, st in enumerate(steps):
        sc = scales.get(st["scaleId"]) or {}
        name = ctx.esc(sc.get("name") or scale_name(ctx, st["scaleId"]))
        badges = " &middot; ".join(ctx.esc(b["label"]) for b in st.get("badges") or [] if b.get("label"))
        row_head = "%d. %s%s" % (n + 1, name, "<br><small>%s</small>" % badges if badges else "")
        cells = [ctx.esc(st.get("syllableLocal") or st.get("syllable") or ""),
                 ctx.esc("%s %s" % (st["tempo"], s["step"]["bpm"])),
                 ctx.esc(s["styles"][st["style"]]["name"]),
                 ctx.esc(s["directions"][st["direction"]]),
                 span_text(ctx, st)]
        if passaggio:
            cells.append(ctx.esc(s["passaggioIntents"][st.get("passaggioIntent") or "none"]["name"]))
        if repeat:
            cells.append(ctx.esc(str(st.get("repeatCount") or 1)))
        rows.append((row_head, cells, ""))
    return table(head, rows, cards=True)


def setup_cues(ctx, entry):
    """The routine's standing cues, held for the whole routine."""
    cues = entry.get("setupCues") or []
    if not cues:
        return ""
    li = "\n".join("  <li><strong>%s</strong><br>%s</li>" % (ctx.esc(c["label"]), ctx.esc(c["description"]))
                   for c in cues)
    return section(L(ctx, "routine.cues"), "<ul>\n%s\n</ul>" % li)


def lengths(ctx, entry):
    """How long the routine takes for each voice type's preset: one line
    when every preset takes the same, else a row per type."""
    presets = entry.get("presets") or {}
    vts = [v for v in local(ctx, "voice_types") if v["id"] in presets]
    if not vts:
        return ""
    mins = [presets[v["id"]]["minutes"] for v in vts]
    if len(set(mins)) == 1:
        inner = "<p>%s</p>" % L(ctx, "steps.minutes", minutes=mins[0])
    else:
        rows = [(ctx.esc(v["name"]), [L(ctx, "steps.minutes", minutes=m)], "") for v, m in zip(vts, mins)]
        inner = table(None, rows)
    return section(L(ctx, "routine.length"), inner)


def routines_inline(ctx, routine_ids):
    """Routine names in a row, each linked to its page where there is one."""
    return ", ".join(link(ctx, page_for(ctx, "routine", rid), routine_name(ctx, rid)) for rid in routine_ids)

