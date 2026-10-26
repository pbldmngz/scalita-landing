"""TT, a tool page: the vocal range test, the sing-in-tune test, the warm-up
piano and the voice break finder.

The tool comes first (docs/specs/site-redesign-spec.md in the app repo, 3.7):

- the title row: the H1, the page's one short line (oneLine; not on phones)
  and the Full screen button js/site/fullscreen.js drives (desktop only);
- the stage, section.stage, holding the tool's mount;
- under it, a collapsed "How it works" (the instructions without their own
  heading, then the privacy line on the tools that listen) and the slot a
  tool may fill, [data-tool-slot="aside"];
- the app band, ctx.cta();
- the reference, below the fold: the lead, then sections[0], the sample
  result, sections[1:-1], what the tool does not claim and sections[-1];
  the next tools; the FAQ; related guides and the other tools beside it;
  sources; byline.

The reference blocks are one DOM for every width: <details data-fold open>
whose <summary> holds the block's <h3>. At 600 px and up css/tool.css sets
them as plain prose; on phones they are accordions, and js/site/chrome.js
folds every one written data-fold="shut" (all but the first). Without the
script they stay open everywhere, so nothing is ever out of reach. A list
whose every item opens with a <strong> question becomes a <dl class="tp-qa">.

The mount point is <div class="tool-panel" data-tool="<toolId>">, or for the
warm-up piano (toolId "player") <div class="player" data-tool="player"
data-player="main">: build.py sees it and adds the import map,
/js/tools/<toolId>.js and the page data. The warm-up piano chooses between
the routines and scales that have a page in the registry, in every locale
(players.main, kind "chooser", _parts.player_entries), opening on DEFAULT.
"""

import re

import _parts as p

# Guides and tools each tool page points to, by toolId, in order: the first
# five guides are its related guides, the first two tools its next steps.
RELATED = {
    "vocal-range-test": ["voice-types", "voice-cracks-high-notes", "head-voice-vs-chest-voice",
                         "note-names-octaves", "vocal-warm-ups", "voice-break-finder", "warm-up-piano"],
    "sing-in-tune-test": ["note-names-octaves", "five-note-scale", "vocal-warm-ups", "head-voice-vs-chest-voice",
                          "voice-types", "warm-up-piano", "vocal-range-test"],
    "player": ["vocal-warm-ups", "full-vocal-warm-up", "quick-vocal-warm-up", "five-note-scale", "lip-trills",
               "vocal-range-test", "voice-break-finder"],
    "voice-break-finder": ["voice-cracks-high-notes", "head-voice-vs-chest-voice", "voice-types", "lip-trills",
                           "vocal-warm-ups", "vocal-range-test", "warm-up-piano"],
}

# The tools that listen: their How it works closes with the privacy line.
LISTENS = {"vocal-range-test", "sing-in-tune-test"}

# Each tool's own stylesheet, besides style.css, chrome.css and tool.css
# (build.py adds tool-player.css wherever a player mounts).
CSS = {"vocal-range-test": ["tool-range.css"], "sing-in-tune-test": ["tool-tune.css"],
       "voice-break-finder": ["tool-player.css"]}

# What the warm-up piano opens on.
DEFAULT = ("scale", "five_note")


def chooser_items(ctx):
    """Every routine and scale with a page in the registry, in registry
    order, scales first: the same set in every locale, whether or not that
    page is built in it yet (the export names all of them in every locale),
    so the tool never opens empty."""
    items = []
    for kind in ("scale", "routine"):
        for e in ctx.registry:
            d = e.get("data") or {}
            if kind + "Id" in d:
                items.append((kind, d[kind + "Id"]))
    return items


# --------------------------------------------------------------------------
# small pieces
# --------------------------------------------------------------------------

LEVEL = re.compile(r"<(/?)h([1-5])\b", re.I)


def demote(html):
    """html with every heading one level down: the reference runs h2 > h3 > h4."""
    return LEVEL.sub(lambda m: "<%sh%d" % (m.group(1), int(m.group(2)) + 1), html or "")


def section_of(ctx, page_id):
    return p.entry(ctx, page_id)["section"]


def tools(ctx, first=()):
    """The tool pages built in this locale: those named in first, in that
    order, then the rest in registry order."""
    ids = [e["id"] for e in ctx.registry if e["template"] == "tool" and ctx.has(e["id"])]
    return [i for i in first if i in ids] + [i for i in ids if i not in first]


QA_LIST = re.compile(r"<ul>(.*?)</ul>", re.S)
QA_ITEM = re.compile(r"\s*<li><strong>((?:(?!</?strong>|</?li\b).)*)</strong>((?:(?!</?li\b).)*)</li>\s*", re.S)


def qa(html):
    """A list whose every item opens with a <strong> question, as a <dl> of
    questions and answers; any other list as it is."""
    def swap(m):
        inner, items, pos = m.group(1), [], 0
        while pos < len(inner):
            item = QA_ITEM.match(inner, pos)
            if not item:
                return m.group(0)
            items.append("<div><dt>%s</dt><dd>%s</dd></div>" % (item.group(1).strip(), item.group(2).strip()))
            pos = item.end()
        return '<dl class="tp-qa">\n%s\n</dl>' % "\n".join(items) if items else m.group(0)
    return QA_LIST.sub(swap, html)


# --------------------------------------------------------------------------
# above the fold
# --------------------------------------------------------------------------

def title_row(ctx):
    c, n = ctx.copy, ctx.site["nav"]
    line = '\n    <p class="tp-line">%s</p>' % ctx.esc(c["oneLine"]) if c.get("oneLine") else ""
    return """<div class="tp-title">
  <div>
    <h1>%s</h1>%s
  </div>
  <button type="button" class="btn btn--secondary btn--sm tp-fs" title="%s">%s%s</button>
</div>""" % (ctx.esc(c["h1"]), line, ctx.esc(n["fullscreenHint"]), p.icon("fullscreen", 16), ctx.esc(n["fullscreen"]))


def how_it_works(ctx, tool):
    """The instructions, collapsed, without the heading they open with."""
    html = ctx.copy.get("instructions")
    if not html:
        return ""
    rest = p.split_heading(html)[1].strip("\n")
    if tool in LISTENS:
        rest += '\n<p class="lockline">%s<span>%s</span></p>' % (
            p.icon("lock", 16), ctx.esc(ctx.ui["common"]["privacyLine"]))
    return p.accordion(p.icon("info", 18) + p.L(ctx, "tool.howItWorks"), rest, face="pill", cls="tp-how")


def under(ctx, tool):
    return '<div class="tp-under">\n%s\n%s\n</div>' % (how_it_works(ctx, tool), p.tool_aside(ctx, tool))


# --------------------------------------------------------------------------
# the reference
# --------------------------------------------------------------------------

def fold(heading, body, state, sid=None):
    """One reference block: prose at 600 px and up, an accordion on phones
    (state is how a phone first shows it: "open" or "shut")."""
    attrs = 'data-fold="%s"%s' % (state, ' id="%s"' % sid if sid else "")
    return p.accordion(heading, body, open_=True, cls="tp-fold", attrs=attrs)


def blocks(ctx):
    """The reference blocks in the page's order: sections[0], the sample
    result, sections[1:-1], what it does not claim, sections[-1]."""
    c = ctx.copy
    secs = c.get("sections") or []

    def own(key, label_path, sample=False):
        html = c.get(key)
        if not html:
            return None
        head, rest = p.split_heading(html)
        if sample:
            rest = '<div class="result-card result-card--sample">\n%s\n</div>' % rest.strip("\n")
        return (demote(head) if head else "<h3>%s</h3>" % p.L(ctx, label_path), rest, None)

    def sec(s):
        return ("<h3>%s</h3>" % ctx.esc(s["heading"]), qa(s["html"]), s.get("id"))

    out = [sec(s) for s in secs[:1]] + [own("sampleResult", "tool.sample", True)]
    out += [sec(s) for s in secs[1:-1]] + [own("notClaimed", "tool.notClaimed")]
    out += [sec(s) for s in secs[1:][-1:]]
    out = [b for b in out if b]
    return [fold(h, body, "open" if n == 0 else "shut", ctx.esc(sid) if sid else None)
            for n, (h, body, sid) in enumerate(out)]


def next_tools(ctx, related):
    """Buttons to the first two tools this page names."""
    built = tools(ctx)
    ids = [i for i in related if i in built and i != ctx.page["id"]][:2]
    if not ids:
        return ""
    links = "\n".join('  <a class="btn btn--secondary" href="%s">%s%s</a>' % (
        ctx.url(i), p.icon(p.TOOL_ICONS[i], 16), p.L(ctx, "tool.next." + i)) for i in ids)
    return '<div class="tp-next">\n%s\n</div>' % links


def aside(ctx, related):
    """Beside the prose: related guides, then the other tools."""
    pid = ctx.page["id"]
    guides = [i for i in related if i != pid and ctx.has(i) and section_of(ctx, i) == "guides"][:5]
    out = []
    if guides:
        rows = ['  <li><a class="aside__row" href="%s">%s%s</a></li>' % (
            ctx.url(i), ctx.esc(ctx.label(i)), p.icon("chevron-right", 16)) for i in guides]
        home = ctx.section_home("guides")
        if home:
            rows.append('  <li><a class="tp-all" href="%s">%s%s</a></li>' % (
                ctx.url(home), p.L(ctx, "reference.allGuides", n=ctx.guide_count()), p.icon("arrow-right", 14)))
        out.append('<div class="tp-guides">\n<h3 class="tp-kicker">%s</h3>\n<ul>\n%s\n</ul>\n</div>' % (
            p.L(ctx, "reference.relatedGuides"), "\n".join(rows)))
    others = [i for i in tools(ctx, related) if i != pid]
    if others:
        rows = "\n".join(
            '  <li><a class="row" href="%s"><span class="icon-box icon-box--sm">%s</span>'
            '<span class="row__text"><span class="row__title">%s</span><span class="row__line">%s</span></span></a></li>'
            % (ctx.url(i), p.icon(p.TOOL_ICONS[i], 18), ctx.esc(ctx.label(i)), ctx.esc(ctx.copy_of(i).get("tile") or ""))
            for i in others)
        out.append('<div class="tp-tools">\n<h3 class="tp-kicker">%s</h3>\n<ul>\n%s\n</ul>\n</div>' % (
            p.L(ctx, "reference.otherTools"), rows))
    if not out:
        return ""
    return '<aside class="tp-aside" aria-label="%s">\n%s\n</aside>' % (
        ctx.esc(ctx.site["related"]["heading"]), "\n".join(out))


def reviewed(ctx):
    iso = ctx.copy["reviewed"]
    when = '<time datetime="%s">%s</time>' % (iso, ctx.esc(p.date_text(ctx, iso)))
    return ctx.esc(p.label(ctx, "reference.reviewed")).replace("{date}", when)


def reference(ctx, related):
    c = ctx.copy
    main = ["""<div class="tp-ref__head">
<p class="tp-kicker">%s</p>
<h2 id="tp-ref-h">%s</h2>
<p class="tp-reviewed">%s</p>
</div>""" % (p.L(ctx, "reference.kicker"), ctx.esc(c["referenceHeading"]), reviewed(ctx)),
            '<p class="tp-lead">%s</p>' % ctx.esc(c["lead"])]
    main += blocks(ctx) + [next_tools(ctx, related), p.faq(ctx, c.get("faq"), level=3)]
    end = [demote(p.sources(ctx, c.get("sources"))), ctx.byline()]
    return """<section class="tp-ref" aria-labelledby="tp-ref-h">
<div class="tp-ref__main">
%s
</div>
%s
<div class="tp-ref__end">
%s
</div>
</section>""" % ("\n\n".join(b for b in main if b), aside(ctx, related), "\n".join(b for b in end if b))


def render(ctx):
    c = ctx.copy
    tool = ctx.page["data"]["toolId"]
    players = None
    if tool == "player":
        mount = p.player_mount(ctx)
        players = p.player_entries(ctx, chooser_items(ctx), DEFAULT)
    else:
        mount = p.tool_panel(ctx, tool)
    related = RELATED.get(tool, [])
    body = "\n\n".join([
        title_row(ctx),
        '<section class="stage" aria-label="%s">\n%s\n</section>' % (ctx.esc(c["label"]), mount),
        under(ctx, tool),
        ctx.cta(ctx.site["cta"]["inApp"], c["appBand"]),
        reference(ctx, related),
    ])
    out = p.result(body, players)
    if tool in ("player", "voice-break-finder"):
        # the stage's "No microphone" pill, as on the hub's tiles (not on a guide's player)
        out["page_data"]["strings"] = {"templates": {"tool": {"noMic": ctx.ui["templates"]["tool"]["noMic"]}}}
    out["css"] = ["tool.css"] + CSS.get(tool, [])
    out["main_class"] = "tp-wrap"
    return out
