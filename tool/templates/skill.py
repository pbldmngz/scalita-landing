"""T5, a skill page: how to sing in tune.

Body: H1 and lead; the short answer (a box); the copy's sections (why voices
miss notes, then the steps in order); try it now, the player choosing
between the scales in TRY_SCALES (one held note, then three notes, then
five), with the piano credit; troubleshooting; FAQ; call to action; related
pages (the two listening and singing tools first); sources; byline.
"""

import _parts as p

# One note to hold, then three, then five (the copy's steps, in order)
TRY_SCALES = ["single_note", "three_note", "five_note"]
RELATED = ["sing-in-tune-test", "tone-deaf-test", "five-note-scale", "warm-up-piano", "vocal-range-test"]
CSS = ["guides.css"]


def render(ctx):
    scales = [("scale", s) for s in TRY_SCALES if ctx.data.entry("scales", s)]
    players = p.player_entries(ctx, scales) if scales else None
    blocks = [
        p.callout(ctx, "shortAnswer", "concept.shortAnswer", level=2),
        p.prose(ctx, ctx.copy.get("sections")),
        p.section(p.L(ctx, "exercise.tryIt"), p.player_mount(ctx) + "\n" + ctx.credit()) if players else "",
        p.field(ctx, "troubleshooting", "exercise.troubleshooting"),
    ]
    return dict(p.result(p.finish(ctx, blocks, RELATED), players), css=CSS)
