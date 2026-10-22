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


def box(html, heading=None, caution=False):
    """Copy HTML as a boxed aside (.callout). A heading the copy opens with
    becomes the box's <h3>, as the stylesheet styles it; else heading
    (escaped text), if any."""
    own, rest = split_heading(html)
    if own:
        head = re.sub(r"^<h2\b", "<h3", re.sub(r"</h2>$", "</h3>", own, flags=re.I), flags=re.I)
    else:
        head = "<h3>%s</h3>" % heading if heading else ""
    cls = "callout callout--caution" if caution else "callout"
    return '<aside class="%s">\n%s%s\n</aside>' % (cls, head + "\n" if head else "", boxed(rest))


def callout(ctx, key, heading_path, caution=False):
    """A copy field as a boxed aside, under its own heading or the template's."""
    html = ctx.copy.get(key)
    return box(html, L(ctx, heading_path), caution) if html else ""


def prose(ctx, sections):
    """The copy's sections: a heading and its HTML each."""
    return "\n\n".join(section(ctx.esc(s["heading"]), s["html"]) for s in sections or [])


def intro(ctx):
    return ctx.copy.get("intro") or ""


def cards(ctx, ids):
    """One card per page: its label and its description. Pages this build
    does not have in the locale are left out."""
    items = []
    for pid in ids:
        other = ctx.copy_of(pid) if ctx.has(pid) else None
        if other is None:
            continue
        items.append('  <li><a class="hub-card" href="%s"><h3>%s</h3><p>%s</p></a></li>'
                     % (ctx.url(pid), ctx.esc(other["label"]), ctx.esc(other["description"])))
    return '<ul class="hub-cards">\n%s\n</ul>' % "\n".join(items) if items else ""


def faq(ctx, items):
    """The copy's FAQ, as plain headings and answers (no FAQPage markup)."""
    if not items:
        return ""
    qa = "\n".join('<div class="faq-item">\n<h3>%s</h3>\n%s\n</div>' % (ctx.esc(i["q"]), i["a"]) for i in items)
    return '<section class="faq">\n<h2>%s</h2>\n%s\n</section>' % (ctx.esc(ctx.site["faq"]["heading"]), qa)


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


# The height a tool's panel reserves before its script runs (the stylesheet's
# --panel-min, 460px by default), measured by the tool's own package so that
# starting a run does not push the page down.
PANEL_MIN = {"vocal-range-test": 560, "sing-in-tune-test": 580}


def tool_panel(ctx, tool_id):
    """A tool's mount point: build.py adds its module script for it."""
    style = ' style="--panel-min:%dpx"' % PANEL_MIN[tool_id] if tool_id in PANEL_MIN else ""
    return '<div class="tool-panel" data-tool="%s"%s>%s</div>' % (tool_id, style, noscript(ctx, "tool-panel__hint"))


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

