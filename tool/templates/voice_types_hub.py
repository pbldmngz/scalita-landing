"""TH for voice types: the voice-types hub.

Body: H1 and lead; intro; the six voice types (the chart from
tool/data/app/voice_types.json: a table of typical ranges and both breaks,
each name linking to its own block); the copy's sections; cards for the
child pages; FAQ; call to action; related pages; sources; byline.

Each voice type has an anchor, its id in the export (#soprano,
#mezzoSoprano, #contralto, #tenor, #baritone, #bass), which the tools link
to. A copy section that names a type, {"heading", "html", "voiceType":
"tenor"}, becomes that type's block: the anchor, its heading, its keyboard
(range, first and second shift) and its facts, then the copy. Types no
section names get a block of their own after the table, keyboard and facts
only, so every anchor and every keyboard is on the page either way.
"""

import _parts as p

RELATED = ["vocal-range-test", "voice-break-finder", "note-names-octaves", "head-voice-vs-chest-voice",
           "voice-cracks-high-notes"]


def facts(ctx, v):
    rows = [(p.L(ctx, "voices.range"), [p.from_to(ctx, v["rangeLow"], v["rangeHigh"])], ""),
            (p.L(ctx, "voices.primo"), [ctx.esc(p.note(ctx, v["primo"]))], ""),
            (p.L(ctx, "voices.secondo"), [ctx.esc(p.note(ctx, v["secondo"]))], "")]
    return p.voice_keyboard(ctx, v) + "\n" + p.table(None, rows)


def render(ctx):
    c = ctx.copy
    vts = p.local(ctx, "voice_types")
    named = {s.get("voiceType") for s in c.get("sections") or [] if s.get("voiceType")}
    chart = [p.voice_table(ctx, anchors=True), "<p>%s</p>" % p.L(ctx, "voices.note")]
    for v in vts:
        if v["id"] not in named:
            chart.append('<h3 id="%s">%s</h3>\n%s' % (v["id"], ctx.esc(v["name"]), facts(ctx, v)))
    blocks = [p.intro(ctx), p.section(p.L(ctx, "voices.heading"), "\n".join(chart))]
    for s in c.get("sections") or []:
        v = p.find(vts, s.get("voiceType")) if s.get("voiceType") else None
        if s.get("voiceType") and v is None:
            raise ValueError("pages/%s/%s.json: voiceType %r is not an id in tool/data/app/voice_types.json"
                             % (ctx.code, ctx.page["id"], s["voiceType"]))
        if v is None:
            blocks.append(p.section(ctx.esc(s["heading"]), s["html"]))
        else:
            blocks.append(p.section(ctx.esc(s["heading"]), facts(ctx, v) + "\n" + s["html"], v["id"]))
    children = [i for i in c.get("children") or [] if ctx.has(i)]
    blocks.append(p.cards(ctx, children))
    related = [i for i in RELATED if i not in children]
    return p.result(p.finish(ctx, blocks, related))
