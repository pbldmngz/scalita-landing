"""TT, a tool page: the vocal range test, the sing-in-tune test, the warm-up
piano and the voice break finder.

Body: H1 and lead; the tool's mount point (its height reserved by the
stylesheet) and the piano credit; how to use it; a sample result, in a
dashed result card; the copy's sections (what it measures, how it works,
microphone help); what it does not claim; FAQ; call to action; related
pages; sources; byline. A copy field that opens with its own <h2> keeps it.

The mount point is <div class="tool-panel" data-tool="<toolId>">, or for the
warm-up piano (toolId "player") <div class="player" data-tool="player"
data-player="main">: build.py sees it and adds the import map,
/js/tools/<toolId>.js and the page data. The warm-up piano chooses between
the routines and scales that have a page in the registry, in every locale
(players.main, kind "chooser", _parts.player_entries), opening on DEFAULT.
"""

import _parts as p

# Guides and tools each tool page points to, by toolId.
RELATED = {
    "vocal-range-test": ["voice-types", "voice-break-finder", "note-names-octaves", "warm-up-piano",
                         "head-voice-vs-chest-voice"],
    "sing-in-tune-test": ["warm-up-piano", "note-names-octaves", "vocal-range-test", "five-note-scale"],
    "player": ["vocal-warm-ups", "full-vocal-warm-up", "quick-vocal-warm-up", "five-note-scale",
               "vocal-range-test"],
    "voice-break-finder": ["voice-cracks-high-notes", "head-voice-vs-chest-voice", "voice-types",
                           "vocal-range-test"],
}

# What the warm-up piano opens on.
DEFAULT = ("scale", "five_note")


def chooser_items(ctx):
    """Every routine and scale with a page in the registry, in registry
    order, scales first: the same set in every locale, whether or not that
    page is built in it yet (the export names all of them in every locale),
    so the tool never opens empty."""
    items = []
    for kind in ("scale", "routine"):
        for e in ctx.registry:
            d = e.get("data") or {}
            if kind + "Id" in d:
                items.append((kind, d[kind + "Id"]))
    return items


def sample(ctx):
    html = ctx.copy.get("sampleResult")
    if not html:
        return ""
    own, rest = p.split_heading(html)
    card = '<div class="result-card result-card--sample">\n%s\n</div>' % p.boxed(rest)
    if own:
        return "<section>\n%s\n%s\n</section>" % (own, card)
    return p.section(p.L(ctx, "tool.sample"), card)


def render(ctx):
    c = ctx.copy
    tool = ctx.page["data"]["toolId"]
    players = None
    if tool == "player":
        mount = p.player_mount(ctx)
        players = p.player_entries(ctx, chooser_items(ctx), DEFAULT)
    else:
        mount = p.tool_panel(ctx, tool)
    blocks = [
        mount + "\n" + ctx.credit(),
        p.field(ctx, "instructions", "tool.howTo"),
        sample(ctx),
        p.prose(ctx, c.get("sections")),
        p.field(ctx, "notClaimed", "tool.notClaimed"),
    ]
    return p.result(p.finish(ctx, blocks, RELATED.get(tool, [])), players)
