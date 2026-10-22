"""T2, an exercise page: one or more sounds from tool/data/app/syllables.json
(the copy's syllables, ids such as "Trr" and "Prr").

Body: H1 and lead; the copy's sections (what it is, its names, how to do it,
when to use which by Scalita's rule); try it now, the player choosing
between the scales in TRY_SCALES, with the piano credit; troubleshooting;
where Scalita uses each sound (its respelling in the locale, how many
built-in steps use it, and those routines, linked where they have a page);
FAQ; call to action; related pages; sources; byline.

The app's own tips for each sound (syllables.json tips) are not printed:
they are in-app cues, and the trill ones say the tongue trill is "the easier
one to start with" (open question 2) and that the lip trill "relaxes a tense
voice" (a mechanism claim, plan 4.7 #1 and #3). The copy says it instead.
"""

import _parts as p

# The patterns "try it now" offers, in order: five-note, arpeggio, octave
# and a half (plan 4.2, T2).
TRY_SCALES = ["five_note", "arpeggio_triad", "octave_and_half"]


def sounds(ctx):
    out = []
    for sid in ctx.copy.get("syllables") or []:
        s = p.find(p.local(ctx, "syllables"), sid)
        if s is not None:
            out.append(s)
    return out


def usage(ctx, items):
    if not items:
        return ""
    head = [p.L(ctx, "steps.syllable"), p.L(ctx, "steps.count"), p.L(ctx, "steps.routines")]
    rows = [(ctx.esc(s.get("respellings") or s["id"]),
             [str(s["usage"]["steps"]), p.routines_inline(ctx, s["usage"]["routines"])], "") for s in items]
    return p.section(p.L(ctx, "exercise.usage"), p.table(head, rows, cards=True))


def render(ctx):
    items = sounds(ctx)
    scales = [("scale", s) for s in TRY_SCALES if ctx.data.entry("scales", s)]
    players = p.player_entries(ctx, scales) if scales else None
    blocks = [
        p.prose(ctx, ctx.copy.get("sections")),
        p.section(p.L(ctx, "exercise.tryIt"), p.player_mount(ctx) + "\n" + ctx.credit()) if players else "",
        p.field(ctx, "troubleshooting", "exercise.troubleshooting"),
        usage(ctx, items),
    ]
    related = [p.page_for(ctx, "routine", r) for s in items for r in s["usage"]["routines"]]
    related += [p.page_for(ctx, "scale", s) for s in TRY_SCALES] + ["warm-up-piano", "vocal-warm-ups"]
    return p.result(p.finish(ctx, blocks, related), players)
