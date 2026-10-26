"""T6, a library page: note names and octaves.

Body: H1 and lead; the copy's sections (the answer comes first); the four
notation systems (the app's own label, names and "where it is used" for
each, from tool/data/app/notes.json); middle C and A 440 in each system the
locale offers, in the order its notation picker lists them; one octave in
each pitch-naming system; a keyboard of that octave in the locale's own
notation; the three octave numbering styles (middle C, A 440, the lowest
and highest piano keys); FAQ; call to action; related pages; sources;
byline.

Every name is the export's, in the locale's spelling (Ré, Dó, H, c¹).
"""

import _parts as p

RELATED = ["vocal-range-test", "voice-types", "sing-in-tune-test", "five-note-scale", "voice-break-finder"]
MIDDLE_C, A440 = 60, 69
STYLES = ["scientific", "francoBelgian", "helmholtz"]
CSS = ["guides.css"]


def systems_order(n):
    order = list(n["locales"].get("notationOrder") or [])
    return order + [k for k in sorted(n["systems"]) if k not in order]


def render(ctx):
    n = p.local(ctx, "notes")
    order = systems_order(n)
    sy = n["systems"]
    rows = [(ctx.esc(sy[k]["label"]), [ctx.esc(sy[k]["example"]), ctx.esc(sy[k]["regions"])], "") for k in order]
    systems = p.section(p.L(ctx, "notation.systems"), p.table(
        [p.L(ctx, "notation.system"), p.L(ctx, "notation.names"), p.L(ctx, "notation.where")], rows, cards=True))

    naming = [k for k in order if not sy[k].get("relative")]
    # localize() turns each system's names map into "name": the 88 keys
    rows = [(ctx.esc(sy[k]["label"]), [ctx.esc(sy[k]["name"][MIDDLE_C - 21]), ctx.esc(sy[k]["name"][A440 - 21])], "")
            for k in naming]
    landmarks = p.section(p.L(ctx, "notation.landmarks"), p.table(
        [p.L(ctx, "notation.system"), p.L(ctx, "notation.middleC"), p.L(ctx, "notation.a440")], rows))

    rows = []
    for pc in range(12):
        first = ctx.esc(sy[naming[0]]["pitchClasses"][pc])
        rows.append((first, [ctx.esc(sy[k]["pitchClasses"][pc]) for k in naming[1:]], ""))
    own = n["locales"].get("notation")
    kb = p.keyboard(ctx, MIDDLE_C, MIDDLE_C + 12, labels="white",
                    aria=p.label(ctx, "notation.keyboard", system=sy[own]["label"] if own in sy else ""))
    octave = p.section(p.L(ctx, "notation.octave"), p.table([ctx.esc(sy[k]["label"]) for k in naming], rows) + "\n" + kb)

    st = n.get("octaveStyles") or {}
    rows = []
    for k in STYLES:
        if k not in st:
            continue
        names = [st[k]["middleC"], st[k]["a440"], st[k]["lowest"], st[k]["highest"]]
        if k == "francoBelgian" and n["locales"].get("octaveStyle") == k:
            # the locale's own solfège spelling of the same keys: Dó3 in Portuguese, Do3 in French
            names = [ctx.note(m)[0] for m in (MIDDLE_C, A440, 21, 108)]
        rows.append((p.L(ctx, "notation.styles." + k), [ctx.esc(x) for x in names], ""))
    octaves = p.section(p.L(ctx, "notation.octaves"), p.table(
        [p.L(ctx, "notation.style"), p.L(ctx, "notation.middleC"), p.L(ctx, "notation.a440"),
         p.L(ctx, "notation.lowest"), p.L(ctx, "notation.highest")], rows, cards=True))

    blocks = [p.prose(ctx, ctx.copy.get("sections")), systems, landmarks, octave, octaves]
    return dict(p.result(p.finish(ctx, blocks, RELATED)), css=CSS)
