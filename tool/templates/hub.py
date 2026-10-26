"""TH, a hub page of the guides: the warm-ups hub. (The tools hub has its
own template, tools_hub.py.)

Body: H1 and lead; intro; one card per child page; on the hub the nav's
Guides link leads to, More guides: a card for every other guide page; the
hub's own block; the copy's sections; FAQ; call to action; related pages;
sources; byline.

The hub's own block comes from what its children are, not from its id:
children that are routine pages bring the player, choosing between those
routines (page data players.main with a chooser), and Find My Warmup from
tool/data/app/intake.json as a static map of feelings and goals to the
routines the app picks, each linked to its page where there is one, every
answer a small card (.gd-options in css/guides.css).
"""

import _parts as p

# Pages a hub points to besides its own children, by hub id.
RELATED = {
    "vocal-warm-ups": ["warm-up-piano", "vocal-range-test", "voice-types", "voice-break-finder"],
}
CSS = ["guides.css"]


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
    answers = '<h3>%s</h3>\n<ul class="gd-options">\n%s\n</ul>'
    inner = "<p>%s</p>\n%s\n%s" % (ctx.esc(it["subtitle"]),
                                   answers % (ctx.esc(it["feelings"]["label"]), "\n".join(feel)),
                                   answers % (ctx.esc(it["goals"]["label"]), "\n".join(goals)))
    return p.section(ctx.esc(it["title"]), inner, "find-my-warmup")


def others(ctx, children):
    """The guides this hub's cards leave out, when it is the page the nav's
    Guides link and All {n} guides lead to: then it lists every guide
    (build.guide_count counts the same pages), in registry order."""
    if ctx.page["id"] != ctx.section_home("guides"):
        return []
    return [e["id"] for e in ctx.registry if e["section"] == "guides" and ctx.has(e["id"])
            and e["id"] != ctx.page["id"] and e["id"] not in children]


def render(ctx):
    c = ctx.copy
    children = [i for i in c.get("children") or [] if ctx.has(i)]
    more = others(ctx, children)
    routines = [d["routineId"] for d in (p.entry(ctx, i).get("data") or {} for i in children) if "routineId" in d]
    blocks = [p.intro(ctx), p.cards(ctx, children)]
    if more:
        blocks.append(p.section(p.L(ctx, "hub.moreGuides"), p.cards(ctx, more, level=3), "more-guides"))
    players = None
    if routines:
        blocks += [p.player_section(ctx), intake(ctx)]
        players = p.player_entries(ctx, [("routine", r) for r in routines])
    blocks.append(p.prose(ctx, c.get("sections")))
    related = [i for i in RELATED.get(ctx.page["id"], []) if i not in children and i not in more]
    return dict(p.result(p.finish(ctx, blocks, related), players), css=CSS)
