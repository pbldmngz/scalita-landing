"""The tools hub (/tools/): the four tools as app tiles, then the reference,
the byline and the app band. scalita_app docs/specs/site-redesign-spec.md,
3.6; mockups S2-hub-desktop and S2-hub-phone. build.py adds the tools
context chrome, the breadcrumb and the BreadcrumbList.

One body serves both layouts, and css/hub.css moves its parts, all inside
main.hub-wrap (render()'s main_class), after the breadcrumb:

  .hub-title          the H1 and the lead
  .hub-tiles          one a.tile per child tool, in registry order: its icon,
                      its label, the Microphone or No microphone pill, a static
                      preview of the tool's own screen (one SVG for wide
                      screens, one for phones, both aria-hidden), the tool
                      page's tile line and Start
  a.hub-newhere       phones only, to #start
  section.hub-ref     two columns on desktop:
    .hub-ref__main    the kicker, the referenceHeading H2 and the reviewed
                      line; the intro as an accordion (_parts.accordion),
                      open; sections[0] as section#start (a card on phones,
                      moved first); the other sections as accordions; the
                      FAQ (_parts.faq at level 3: H4 questions)
    aside.hub-aside   the guides that go with the tools, and All {n} guides
  the byline, then the band (ctx.cta; phones show the band first)

The reference accordions read as prose on desktop: hub.css shows their
content whatever their open state where the browser has ::details-content,
and leaves them working accordions where it has not. On phones they are
accordions, the intro open. The outline is the same at every width: H1, H2,
H3 for each section and the FAQ, H4 for each question.

Every word comes from the copy, the ui files or the export, every note name
from ctx.note(). Text in a preview never wraps: a label that would not fit
gets a smaller size (fit(), from Sora's letter widths), and the SVG clips
anything past its edge.
"""

import _parts as p

# The guides the aside lists, in this order, when the locale has them.
GUIDES = ["vocal-warm-ups", "voice-types", "voice-cracks-high-notes", "head-voice-vs-chest-voice",
          "note-names-octaves"]

# What the piano preview shows (spec 3.6): the five-note scale in the tenor
# preset's tempo and direction, its status line on key 3 of 18, sounding E4.
PIANO_SCALE, PIANO_PRESET, PIANO_KEY, PIANO_KEYS, PIANO_NOTE = "five_note", "tenor", 3, 18, 64

BLACK = {1, 3, 6, 8, 10}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def ui(ctx, name, path, **values):
    """A string from ui/<loc>/<name>.json with its {placeholders} filled, not
    escaped."""
    d = ctx.ui[name]
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    if not isinstance(d, str):
        raise KeyError("tool/content/ui/en/%s.json has no %s" % (name, path))
    for k, v in values.items():
        d = d.replace("{%s}" % k, str(v))
    return d


def num(v):
    """A coordinate as short as it can be written."""
    s = ("%.2f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def fit(s, size, room, k=0.62):
    """The font size at which s fits room user units: size, or smaller. k is
    a Sora letter's width in em, rounded up: the labels of all seven locales
    measure 0.42 to 0.64 a letter, whole phrases about 0.5."""
    need = max(1, len(s)) * size * k
    return size if need <= room else max(4.0, room / (max(1, len(s)) * k))


def text(ctx, x, y, s, size, cls=None, anchor=None, more=""):
    attrs = ' class="%s"' % cls if cls else ""
    if anchor:
        attrs += ' text-anchor="%s"' % anchor
    return '<text x="%s" y="%s" font-size="%s"%s%s>%s</text>' % (num(x), num(y), num(size), attrs, more,
                                                                ctx.esc(s))


def key_path(x, y, w, h, r):
    """A key: square top, the bottom corners rounded by r, no outline."""
    return "M%s %sh%sv%sa%s %s 0 0 1-%s %sh-%sa%s %s 0 0 1-%s-%sz" % tuple(
        num(v) for v in (x, y, w, h - r, r, r, r, r, w - 2 * r, r, r, r, r))


def svg(w, h, parts):
    return ('<svg class="hub-pv" viewBox="0 0 %d %d" width="%d" height="%d" aria-hidden="true">%s</svg>'
            % (w, h, w, h, "".join(parts)))


def blur(fid, sd, x="-30%", y="-10%", w="160%", h="120%"):
    return ('<defs><filter id="%s" x="%s" y="%s" width="%s" height="%s"><feGaussianBlur stdDeviation="%s"/>'
            '</filter></defs>' % (fid, x, y, w, h, num(sd)))


def note_box(ctx, x, y, h, rx, sw, midi, font, cls="hub-pv__box", dash=None, w=None):
    """The tool's note box, h tall and w wide (square unless w is given), with
    the note's local name centred in it at font, or smaller to fit."""
    w = w or h
    name = ctx.note(midi)[0]
    f = fit(name, font, w - 16 if w > 60 else w - 10)
    extra = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<rect class="%s" x="%s" y="%s" width="%s" height="%s" rx="%s" stroke-width="%s"%s/>'
            % (cls, num(x), num(y), num(w), num(h), num(rx), num(sw), extra)
            + text(ctx, x + w / 2, y + h / 2 + 0.35 * f, name, f, "hub-pv__note", "middle",
                   ' letter-spacing="-1"' if f > 30 else ""))


def lanes(x, ys, w, h, on):
    return "".join('<rect class="hub-pv__lane%s" x="%s" y="%s" width="%s" height="%s" rx="3"/>'
                   % (" hub-pv__lane--on" if i == on else "", num(x), num(y), num(w), num(h))
                   for i, y in enumerate(ys))


def trail(points, width, head, halo=None):
    """The pitch line through points, its head dot (radius head) on the last
    one, and on wide previews the halo under it."""
    x, y = points[-1]
    out = '<polyline class="hub-pv__line" stroke-width="%s" points="%s"/>' % (
        num(width), " ".join("%s,%s" % (num(a), num(b)) for a, b in points))
    if halo:
        out += '<circle class="hub-pv__halo" cx="%s" cy="%s" r="%s"/>' % (num(x), num(y), num(halo))
    return out + '<circle class="hub-pv__head" cx="%s" cy="%s" r="%s"/>' % (num(x), num(y), num(head))


# --------------------------------------------------------------------------
# the four previews: (wide, phone), each one SVG
# --------------------------------------------------------------------------

def preview_range(ctx):
    """Step 1, the lowest note: G2 locked in its box, six lanes A#2 to F2 with
    G2 lit, the trail settling onto it."""
    step = ui(ctx, "vocal-range-test", "stepLow")
    wide = ['<circle class="hub-pv__dot" cx="30" cy="20" r="4"/>', text(ctx, 42, 24, step, fit(step, 12, 446)),
            note_box(ctx, 24, 44, 112, 22, 1.5, 43, 52), lanes(160, [42 + 22 * i for i in range(6)], 284, 20, 3)]
    for i, m in enumerate(range(46, 40, -1)):
        wide.append(text(ctx, 482, 56 + 22 * i, ctx.note(m)[0], 11, "hub-pv__cur" if i == 3 else None, "end"))
    wide.append(trail([(176, 60), (200, 58), (224, 66), (248, 80), (272, 98), (292, 112), (308, 118), (330, 120),
                       (354, 118), (378, 120), (402, 119), (426, 120)], 3, 4, 10))
    phone = [note_box(ctx, 6, 12, 50, 12, 1.2, 43, 24), lanes(64, [10, 28, 46, 64], 82, 14, 2),
             trail([(70, 18), (80, 20), (90, 28), (100, 40), (110, 50), (120, 53), (130, 52), (140, 53)], 2.2, 3)]
    return svg(500, 176, wide), svg(150, 86, phone)


def meter(cx, x0, x1, y, h, ticks, needle_cents, needle):
    """The cents meter: the +-25 and +-10 cents bands, the baseline, the ticks
    and the needle, +-50 cents across x0..x1."""
    per = (x1 - x0) / 100.0
    out = ""
    for cents, cls in ((25, "hub-pv__band"), (10, "hub-pv__band hub-pv__band--in")):
        out += '<rect class="%s" x="%s" y="%s" width="%s" height="%s" rx="3"/>' % (
            cls, num(cx - cents * per), num(y - h / 2), num(2 * cents * per), num(h))
    out += '<path class="hub-pv__rule" d="M%s %sH%s" stroke-width="1.5"/>' % (num(x0), num(y), num(x1))
    out += '<path class="hub-pv__tick" d="%s" stroke-width="1"/>' % "".join(
        "M%s %sv%s" % (num(cx + c * per), num(y - t), num(2 * t)) for c, t in ticks)
    nx = cx + needle_cents * per
    out += '<path class="hub-pv__needle" d="M%s %sv%s" stroke-width="%s"/>' % (
        num(nx), num(y - needle[0]), num(2 * needle[0]), num(needle[1]))
    return out


def preview_tune(ctx):
    """Note 1 of 5: A3 in its box, the needle at +4 cents, the trail flat on
    the A3 lane."""
    noteof = ui(ctx, "sing-in-tune-test", "sing.noteOf", n=1, total=5)
    a3 = ctx.note(57)[0]
    wide = ['<circle class="hub-pv__dot" cx="30" cy="20" r="4"/>', text(ctx, 42, 24, noteof, fit(noteof, 12, 446)),
            note_box(ctx, 24, 44, 112, 22, 1.5, 57, 52),
            meter(319, 168, 470, 56, 20, [(-50, 6), (-25, 4), (0, 8), (25, 4), (50, 6)], 4, (12, 3)),
            lanes(160, [84, 106, 128, 150], 290, 20, 1), text(ctx, 172, 120, a3, 11),
            trail([(300, 117), (324, 115), (348, 117), (372, 116), (396, 117), (420, 115), (444, 116)], 3, 4, 10)]
    phone = [note_box(ctx, 6, 12, 50, 12, 1.2, 57, 24),
             meter(105, 64, 146, 18, 12, [(-50, 4), (0, 6), (50, 4)], 4, (8, 2.2)),
             lanes(64, [34, 52, 70], 82, 14, 1),
             trail([(96, 60), (106, 58), (116, 59), (126, 58), (136, 59), (142, 58)], 2.2, 3)]
    return svg(500, 176, wide), svg(150, 86, phone)


def keyboard(ctx, x0, y, w, gap, h, bw, bh, whites, lit, labels, fid, sd, label_y, label_size):
    """White keys from C4, the lit one with its glow, the black keys over
    them, and the Cs named on their keys."""
    step = w + gap
    out = blur(fid, sd)
    out += '<g class="hub-pv__key">%s</g>' % "".join(
        '<path d="%s"/>' % key_path(x0 + i * step, y, w, h, min(6, w / 4)) for i in range(whites) if i != lit)
    d = key_path(x0 + lit * step, y, w, h, min(6, w / 4))
    out += '<path class="hub-pv__glow" d="%s" filter="url(#%s)"/><path class="hub-pv__key--on" d="%s"/>' % (
        d, fid, d)
    scale = [0, 2, 4, 5, 7, 9, 11]
    blacks = [i for i in range(whites - 1) if (scale[i % 7] + 1) % 12 in BLACK]
    out += '<g class="hub-pv__key--b">%s</g>' % "".join(
        '<path d="%s"/>' % key_path(x0 + (i + 1) * step - gap / 2 - bw / 2, y, bw, bh, min(4, bw / 4))
        for i in blacks)
    for i in labels:
        name = ctx.note(60 + 12 * (i // 7))[0]
        out += text(ctx, x0 + i * step + w / 2, label_y, name, fit(name, label_size, w - 1), "hub-pv__kl", "middle")
    return out


def preview_piano(ctx):
    """The five-note scale, mirrored, at the tenor preset's tempo: two octaves
    from C4 with E4 sounding."""
    sc = ctx.data.entry("scales", PIANO_SCALE) or {}
    preset = (sc.get("presets") or {}).get(PIANO_PRESET) or {}
    detail = ""
    if preset:
        detail = ui(ctx, "player", "scaleDetail", scale=p.scale_name(ctx, PIANO_SCALE), tempo=preset["tempo"],
                    direction=ui(ctx, "player", "directions." + preset["direction"]))
    keyof = ui(ctx, "player", "keyOf", key=PIANO_KEY, keys=PIANO_KEYS, note=ctx.note(PIANO_NOTE)[0])
    wide = [text(ctx, 24, 24, detail, fit(detail, 12, 452)) if detail else "",
            keyboard(ctx, 24, 38, 30.3, 2, 112, 16, 66, 14, 2, (0, 7), "hub-kg1", 4, 142, 11),
            text(ctx, 24, 172, keyof, fit(keyof, 12, 452))]
    phone = [keyboard(ctx, 6, 8, 12, 2, 66, 8, 40, 9, 2, (0,), "hub-kg2", 2.5, 69, 7),
             text(ctx, 6, 84, detail, fit(detail, 8, 138)) if detail else ""]
    return svg(500, 176, wide), svg(150, 86, phone)


def stairs(x0, y0, w, h, dx, dy, count, lit, fid, sd):
    """The piano climbing: keys stepping up, the one sounding lit."""
    out = blur(fid, sd, "-40%", "-20%", "180%", "140%")
    for j in range(count):
        d = key_path(x0 + j * dx, y0 - j * dy, w, h, min(6, w / 4))
        if j == lit:
            out += '<path class="hub-pv__glow" d="%s" filter="url(#%s)"/><path class="hub-pv__key--on" d="%s"/>' % (
                d, fid, d)
        else:
            out += '<path class="hub-pv__step%s" d="%s"/>' % (" hub-pv__step--up" if j > lit else "", d)
    return out


def buttons(ctx, cx, y, h, rx, sw, size, room, gap, pad, items):
    """A row of button shapes centred on cx: (label, min width, on), each as
    wide as its label needs. A row wider than room first lets go of the min
    widths, then makes the font smaller until it fits."""
    f, mins = size, True
    while True:
        ws = [max(mw if mins else 0, len(s) * f * 0.62 + 2 * pad) for s, mw, _ in items]
        total = sum(ws) + gap * (len(ws) - 1)
        if total <= room or f <= 4:
            break
        if mins:
            mins = False
        else:
            f *= 0.95
    x, out = cx - total / 2, ""
    for (s, _, on), w in zip(items, ws):
        out += '<rect class="hub-pv__btn%s" x="%s" y="%s" width="%s" height="%s" rx="%s" stroke-width="%s"/>' % (
            "" if on else " hub-pv__btn--off", num(x), num(y), num(w), num(h), num(rx), num(sw))
        out += text(ctx, x + w / 2, y + h / 2 + 0.35 * f, s, f, "hub-pv__bt" + ("" if on else " hub-pv__bt--off"),
                    "middle")
        x += w + gap
    return out


def preview_break(ctx):
    """The piano climbing, First shift above E3 in a dashed box, and the two
    buttons the finder shows while it climbs."""
    first, felt, stop = (ui(ctx, "voice-break-finder", "firstShift"), ui(ctx, "voice-break-finder", "feltIt"),
                         ui(ctx, "common", "stop"))
    wide = [stairs(24, 110, 20, 44, 22, 10, 6, 3, "hub-kg3", 3),
            text(ctx, 250, 24, first, fit(first, 12, 300), anchor="middle"),
            note_box(ctx, 194, 34, 88, 20, 1.5, 52, 44, "hub-pv__dash", "4 4", 112),
            buttons(ctx, 250, 134, 36, 12, 1.5, 13, 316, 14, 16, [(felt, 164, True), (stop, 98, False)])]
    phone = [stairs(6, 38, 9, 22, 11, 6, 4, 2, "hub-kg4", 2),
             text(ctx, 98, 12, first, fit(first, 8, 100), anchor="middle"),
             note_box(ctx, 74, 16, 38, 10, 1, 52, 20, "hub-pv__dash", "3 3", 48),
             buttons(ctx, 79, 62, 20, 7, 1, 8, 136, 6, 6, [(felt, 84, True), (stop, 40, False)])]
    return svg(500, 176, wide), svg(150, 86, phone)


# toolId: (whether it listens, its preview)
TOOLS = {
    "vocal-range-test": (True, preview_range),
    "sing-in-tune-test": (True, preview_tune),
    "player": (False, preview_piano),
    "voice-break-finder": (False, preview_break),
}


# --------------------------------------------------------------------------
# the page
# --------------------------------------------------------------------------

def tile(ctx, pid):
    tool = (p.entry(ctx, pid).get("data") or {}).get("toolId")
    listens, draw = TOOLS.get(tool, (None, None))
    icon = p.TOOL_ICONS.get(pid)
    other = ctx.copy_of(pid)
    head = ['<span class="icon-box">%s</span>' % p.icon(icon, 22) if icon else "",
            '<span class="tile__title">%s</span>' % ctx.esc(other["label"])]
    if listens is not None:
        head.append('<span class="pill">%s%s</span>' % (
            p.icon("mic" if listens else "headphones", 13), p.L(ctx, "tool.mic" if listens else "tool.noMic")))
    wide, phone = draw(ctx) if draw else ("", "")
    previews = ""
    if draw:
        previews = ('<span class="tile__preview tile__preview--desktop">%s</span>\n'
                    '<span class="tile__preview tile__preview--phone">%s</span>\n' % (wide, phone))
    return ('<a class="card tile" href="%s">\n<span class="tile__head">%s</span>\n%s'
            '<span class="tile__foot"><span class="tile__line">%s</span>'
            '<span class="tile__start">%s%s</span></span>\n</a>' % (
                ctx.url(pid), "".join(head), previews, ctx.esc(other.get("tile") or ""),
                ctx.esc(ctx.ui["common"]["start"]), p.icon("arrow-right", 16)))


def aside(ctx):
    """The guides that go with the tools, and All {n} guides: n counts the
    guides the page it leads to lists (ctx.guide_count)."""
    ids = p.pick(ctx, GUIDES)
    home = ctx.section_home("guides")  # where All {n} guides goes, as the nav's Guides
    if not ids and not home:
        return ""
    out = ['<aside class="hub-aside" aria-labelledby="hub-guides-h">',
           '<h3 class="hub-kicker" id="hub-guides-h">%s</h3>' % p.L(ctx, "reference.guidesWith")]
    if ids:
        out.append('<ul class="hub-aside__list">\n%s\n</ul>' % "\n".join(
            '<li><a class="aside__row" href="%s"><span>%s</span>%s</a></li>' % (
                ctx.url(i), ctx.esc(ctx.label(i)), p.icon("chevron-right", 16)) for i in ids))
    if home:
        out.append('<a class="hub-allguides" href="%s">%s%s</a>' % (
            ctx.url(home), p.L(ctx, "reference.allGuides", n=ctx.guide_count()), p.icon("arrow-right", 14)))
    return "\n".join(out + ["</aside>"])


def reference(ctx):
    c = ctx.copy
    sections = c.get("sections") or []
    main = ['<div class="hub-ref__head">\n<p class="hub-kicker">%s</p>\n<h2 id="hub-ref-h">%s</h2>\n'
            '<p class="hub-ref__date">%s</p>\n</div>' % (
                p.L(ctx, "reference.kicker"), ctx.esc(c["referenceHeading"]),
                p.L(ctx, "reference.reviewed", date=p.date_text(ctx, c["reviewed"])))]
    if c.get("intro"):
        main.append(p.accordion("<h3>%s</h3>" % p.L(ctx, "reference.twoRules"), c["intro"], True,
                                cls="hub-sec hub-sec--intro"))
    if sections:
        main.append('<section class="hub-start" id="start">\n<h3>%s</h3>\n%s\n</section>' % (
            ctx.esc(sections[0]["heading"]), sections[0]["html"].strip("\n")))
    for s in sections[1:]:
        main.append(p.accordion("<h3>%s</h3>" % ctx.esc(s["heading"]), s["html"], cls="hub-sec"))
    main.append(p.faq(ctx, c.get("faq"), level=3))
    main.append(p.sources(ctx, c.get("sources")))
    return ('<section class="hub-ref" aria-labelledby="hub-ref-h">\n<div class="hub-ref__main">\n%s\n</div>\n'
            '%s\n</section>' % ("\n".join(m for m in main if m), aside(ctx)))


def render(ctx):
    c = ctx.copy
    order = [e["id"] for e in ctx.registry]
    children = sorted((i for i in c.get("children") or [] if ctx.has(i)), key=order.index)
    body = [
        '<div class="hub-title">\n<h1>%s</h1>\n<p class="hub-lead">%s</p>\n</div>' % (
            ctx.esc(c["h1"]), ctx.esc(c["lead"])),
        '<div class="hub-tiles">\n%s\n</div>' % "\n".join(tile(ctx, i) for i in children),
    ]
    if c.get("sections"):
        body.append('<a class="hub-newhere" href="#start">%s<span>%s</span></a>' % (
            p.icon("info", 16), p.L(ctx, "reference.newHere")))
    body += [reference(ctx), ctx.byline(), ctx.cta(ctx.site["cta"]["hubHeading"], c["appBand"])]
    out = p.result("\n\n".join(b for b in body if b))
    out.update(css=["hub.css"], main_class="hub-wrap")
    return out
