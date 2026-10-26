"""T1, a routine page: one built-in routine (registry data.routineId).

Body: H1 and lead (who, when); how long it takes for each voice type's
preset (routines.json presets.minutes, the app's own estimate); the player
for the routine, with the piano credit; the steps table from the export
(scale and its cues, respelled syllable, tempo, style, direction, span,
and the voice-break target where a step has one); the standing cues held
for the whole routine; why this order; what to feel; when to stop (a
caution box); the copy's sections; what to do next; FAQ; call to action;
related pages; sources; byline.

Related pages come from the data: the pages of the scales the routine
plays, the exercise page of a trill it uses, the break finder when a step
targets the voice break, then the tools and the other routine pages.
"""

import _parts as p

CSS = ["guides.css"]


def related(ctx, entry):
    steps = entry.get("steps") or []
    ids = [p.page_for(ctx, "scale", st["scaleId"]) for st in steps]
    ids += p.exercise_pages_for(ctx, [st.get("syllable") for st in steps])
    if any(st.get("passaggioIntent") not in (None, "none") for st in steps):
        ids += ["voice-break-finder", "voice-cracks-high-notes"]
    ids += ["warm-up-piano", "vocal-range-test"] + p.pages_of(ctx, "routine")
    return ids


def render(ctx):
    rid = ctx.page["data"]["routineId"]
    entry = ctx.player_data("routine", rid)
    blocks = [
        p.lengths(ctx, entry),
        p.player_section(ctx),
        p.section(p.L(ctx, "routine.steps"), p.steps_table(ctx, entry)),
        p.setup_cues(ctx, entry),
        p.field(ctx, "whyOrder", "routine.whyOrder"),
        p.field(ctx, "whatToFeel", "routine.whatToFeel"),
        p.callout(ctx, "whenToStop", "routine.whenToStop", caution=True),
        p.prose(ctx, ctx.copy.get("sections")),
        p.field(ctx, "next", "routine.next"),
    ]
    return dict(p.result(p.finish(ctx, blocks, related(ctx, entry)), {"main": entry}), css=CSS)
