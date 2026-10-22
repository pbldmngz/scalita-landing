"""T4, a concept page: voice cracks and the passaggio, head voice and chest
voice.

Body: H1 and lead; the short answer (a box); the copy's sections; where it
sits for your voice (the six voice types' typical ranges and both breaks,
a keyboard each, and Scalita's register spans); what to listen for (the
copy, then the app's three signs from the break finder); try it (the app's
four ways a step can treat the voice break); exercises that help (the
routine in ROUTINE: its name and description, the player with the piano
credit, and its steps); misconceptions; when to see a professional (a caution
box); FAQ; call to action; related pages; sources; byline.
"""

import _parts as p

ROUTINE = "bridge_builder"
SIGNS = ["voiceWantsToCrack", "voiceFlipsToLighterSound", "suddenlyNeedMoreEffort"]
INTENTS = ["approachOnly", "crossOnce", "targetZona", "fullJourney"]


def where(ctx):
    regs = "<h3>%s</h3>\n%s" % (p.L(ctx, "registers.heading"), p.register_table(ctx))
    return p.section(p.L(ctx, "concept.where"), p.voice_chart(ctx) + "\n" + regs)


def listen(ctx):
    s = p.app(ctx).get("listenFor") or {}
    keys = [k for k in SIGNS if k in s] + sorted(k for k in s if k not in SIGNS and k != "whatToListenFor")
    signs = "<ul>\n%s\n</ul>" % "\n".join("  <li>%s</li>" % ctx.esc(s[k]) for k in keys) if keys else ""
    copy = ctx.copy.get("listenFor") or ""
    own, rest = p.split_heading(copy)
    inner = (rest if own else copy).strip("\n") + ("\n" + signs if signs else "")
    if own:
        return "<section>\n%s\n%s\n</section>" % (own, inner)
    return p.section(p.L(ctx, "concept.listenFor"), inner)


def try_it(ctx):
    s = p.app(ctx).get("passaggioIntents") or {}
    rows = [("<strong>%s</strong>" % ctx.esc(s[k]["name"]), [ctx.esc(s[k]["description"])], "")
            for k in INTENTS if k in s]
    return p.section(p.L(ctx, "concept.tryIt"), p.table(None, rows)) if rows else ""


def exercises(ctx, entry):
    head = "<h3>%s</h3>\n<p>%s</p>" % (ctx.esc(entry.get("name") or ROUTINE), ctx.esc(entry.get("description") or ""))
    inner = "\n".join([head, p.player_mount(ctx), ctx.credit(), p.steps_table(ctx, entry)])
    return p.section(p.L(ctx, "concept.exercises"), inner)


def render(ctx):
    entry = ctx.player_data("routine", ROUTINE)
    blocks = [
        p.callout(ctx, "shortAnswer", "concept.shortAnswer"),
        p.prose(ctx, ctx.copy.get("sections")),
        where(ctx),
        listen(ctx),
        try_it(ctx),
        exercises(ctx, entry),
        p.field(ctx, "misconceptions", "concept.misconceptions"),
        p.callout(ctx, "seeProfessional", "concept.seeProfessional", caution=True),
    ]
    related = ["voice-break-finder"] + p.pages_of(ctx, "concept") + ["voice-types", p.page_for(ctx, "routine", ROUTINE),
                                                                     "vocal-range-test"]
    return p.result(p.finish(ctx, blocks, related), {"main": entry})
