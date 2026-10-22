"""T3, a pattern page: one built-in scale (registry data.scaleId).

Body: H1 and lead; the pattern (no heading: the copy's sections explain
it), played the way the app plays it in its natural direction (mirror is
up then down without repeating the top note, as
PlaybackEngine.generateScaleNotes does): its degrees, its notes from
EXAMPLE_ROOT in the locale's notation with the international names under
them, the movable-do syllables of the locale where every degree is natural,
and a keyboard; the player for the scale, with the piano credit; the copy's
sections; the syllables Scalita pairs it with, counted over the built-in
routines' steps; the routines that use it; the copy's local box (a callout,
only where the copy has one); FAQ; call to action; related pages; sources;
byline.
"""

import _parts as p

EXAMPLE_ROOT = 60   # middle C
MOST_PAIRED = 8     # syllables listed, most used first
REST = -1000


def played(intervals, direction):
    """Indexes into the pattern in playing order."""
    up = list(range(len(intervals)))
    if direction == "inverted":
        return up[::-1]
    if direction == "mirror":
        return up + up[::-1][1:]
    return up


def pattern(ctx, scale):
    iv = scale["intervals"]
    order = played(iv, scale.get("naturalDirection"))
    degrees = (scale.get("movableDo") or {}).get("degrees") or [None] * len(iv)
    nums = ["·" if iv[i] == REST or not degrees[i] else degrees[i]["numeral"] for i in order]
    keys = [EXAMPLE_ROOT + iv[i] for i in order if iv[i] != REST]
    locs = ["·" if iv[i] == REST else ctx.note(EXAMPLE_ROOT + iv[i])[0] for i in order]
    intls = ["·" if iv[i] == REST else ctx.note(EXAMPLE_ROOT + iv[i])[1] for i in order]
    names = ctx.esc(" ".join(locs))
    if locs != intls:
        names += "<br><small>%s</small>" % ctx.esc(" ".join(intls))
    rows = [(p.L(ctx, "pattern.degrees"), [ctx.esc(" ".join(nums))], ""),
            (p.L(ctx, "pattern.notes", note=p.note(ctx, EXAMPLE_ROOT)), [names], "")]
    sung = p.local(ctx, "notes").get("locales", {}).get("movableNames")
    if sung and all(d and d.get("accidental") == 0 for d in degrees):
        rows.append((p.L(ctx, "pattern.sung"),
                     [ctx.esc(" ".join(sung[(degrees[i]["number"] - 1) % 7] for i in order))], ""))
    kb = ""
    if keys:
        kb = "\n" + p.keyboard(ctx, min(keys), max(keys), rng=(min(keys), max(keys)), aria=" ".join(locs),
                               labels="white")
    return p.table(None, rows) + kb


def pairings(ctx, scale_id):
    """The syllables the built-in routines sing this scale on most, with
    how many steps do; and every syllable id, most used first."""
    counts, names = {}, {}
    for r in ctx.data["routines"]:
        for st in r.get("steps") or []:
            if st.get("scaleId") == scale_id:
                key = st.get("syllable")
                counts[key] = counts.get(key, 0) + 1
                names[key] = ctx.localize(st.get("syllableByLocale")) or key
    if not counts:
        return "", []
    order = sorted(counts, key=lambda k: (-counts[k], names[k]))
    rows = [(ctx.esc(names[k]), [str(counts[k])], "") for k in order[:MOST_PAIRED]]
    return p.section(p.L(ctx, "pattern.syllables"),
                     p.table([p.L(ctx, "steps.syllable"), p.L(ctx, "steps.count")], rows)), order


def render(ctx):
    sid = ctx.page["data"]["scaleId"]
    scale = ctx.player_data("scale", sid)
    pair_block, syllables = pairings(ctx, sid)
    using = scale.get("routinesUsing") or []
    box = p.box(ctx.copy["localBox"]) if ctx.copy.get("localBox") else ""
    blocks = [
        pattern(ctx, scale),
        p.player_section(ctx),
        p.prose(ctx, ctx.copy.get("sections")),
        pair_block,
        p.section(p.L(ctx, "pattern.routines"), "<p>%s</p>" % p.routines_inline(ctx, using)) if using else "",
        box,
    ]
    related = [p.page_for(ctx, "routine", r) for r in using] + p.exercise_pages_for(ctx, syllables)
    related += ["warm-up-piano", "note-names-octaves", "vocal-range-test"]
    return p.result(p.finish(ctx, blocks, related), {"main": scale})
