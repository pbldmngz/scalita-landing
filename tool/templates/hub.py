"""TH, a hub page: the tools hub and the warm-ups hub.

Body: H1 and lead; intro; one card per child page; the hub's own block;
the copy's sections; FAQ; call to action; related pages; sources; byline.

The hub's own block comes from what its children are, not from its id:
- children that are routine pages: the player, choosing between those
  routines (page data players.main with a chooser), and Find My Warmup from
  tool/data/app/intake.json as a static map of feelings and goals to the
  routines the app picks, each linked to its page where there is one;
- children that are tools: their cards are the block.
"""

import _parts as p

# Pages a hub points to besides its own children, by hub id.
RELATED = {
    "tools": ["vocal-warm-ups", "voice-types", "note-names-octaves", "five-note-scale"],
    "vocal-warm-ups": ["warm-up-piano", "vocal-range-test", "voice-types", "voice-break-finder"],
}


def intake(ctx):
    """Find My Warmup as a static map: each feeling, each goal, and the
    routine the app opens for it. A goal the app refuses to a voice that
    feels a certain way carries that feeling and the app's message."""
    it = p.local(ctx, "intake")

    def option(o, extra):
        lines = ["<strong>%s</strong>" % ctx.esc(o["label"]), ctx.esc(o["description"])] + extra
        return "  <li>%s</li>" % "<br>".join(lines)

    feel = []
    for o in it["feelings"]["options"]:
        extra = []
        if o.get("routineId"):
            extra.append(p.link(ctx, p.page_for(ctx, "routine", o["routineId"]), p.routine_name(ctx, o["routineId"])))
        feel.append(option(o, extra))
    goals = []
    labels = {o["id"]: o["label"] for o in it["feelings"]["options"]}
    # the goals the site can play first, then those only the app has
    for o in sorted(it["goals"]["options"], key=lambda g: bool(g.get("appOnly"))):
        extra = []
        if o.get("routineId"):
            extra.append(p.link(ctx, p.page_for(ctx, "routine", o["routineId"]), p.routine_name(ctx, o["routineId"])))
        elif o.get("appOnly"):
            extra.append(p.L(ctx, "intake.appOnly"))
        for f in o.get("blockedWhen") or []:
            extra.append("<small><em>%s</em> %s</small>" % (ctx.esc(labels.get(f, f)), ctx.esc(it["blockedMessage"])))
        goals.append(option(o, extra))
    inner = "<p>%s</p>\n<h3>%s</h3>\n<ul>\n%s\n</ul>\n<h3>%s</h3>\n<ul>\n%s\n</ul>" % (
        ctx.esc(it["subtitle"]), ctx.esc(it["feelings"]["label"]), "\n".join(feel),
        ctx.esc(it["goals"]["label"]), "\n".join(goals))
    return p.section(ctx.esc(it["title"]), inner, "find-my-warmup")


def render(ctx):
    c = ctx.copy
    children = [i for i in c.get("children") or [] if ctx.has(i)]
    routines = [d["routineId"] for d in (p.entry(ctx, i).get("data") or {} for i in children) if "routineId" in d]
    blocks = [p.intro(ctx), p.cards(ctx, children)]
    players = None
    if routines:
        blocks += [p.player_section(ctx), intake(ctx)]
        players = p.player_entries(ctx, [("routine", r) for r in routines])
    blocks.append(p.prose(ctx, c.get("sections")))
    related = [i for i in RELATED.get(ctx.page["id"], []) if i not in children]
    return p.result(p.finish(ctx, blocks, related), players)
