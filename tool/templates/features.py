"""The features page: everything the app does, in groups a singer can scan.

Body: H1 and lead; the legend of the three marks; links to the groups; each
group (a heading, a line, its features and one screenshot); the basics (the
home's "What you can count on" items, so the two never disagree); the line
on how Pro is bought, linking the home's pricing; the call to action, in the
home's closing words.

Copy (pages/<locale>/features.json): `marks` (free, pro, both and a legend
line for each), `jumpLabel`, `groups` (heading, lead, alt and `items`, each a
name and one sentence), `basics` (heading, lead), `proNote` (text, link).

What is Free and what is Pro is not copy: it is GROUPS below, one mark per
feature, the same in every language, and the build fails when a locale's
lists do not match it. Each mark was read from the app's gates (scalita_app,
lib/shared/widgets/pro_features.dart and the `*Allowed` functions it names):

    free   no gate
    both   part of it is Pro, and the feature's sentence says which part
    pro    the whole feature is Pro

A group's anchor is its English slug in every locale, like a section's id.
Screenshots are images/screenshots/<locale>/<shot>.jpg, 560 x 1174.
"""

import os

import build as B
import _parts as p

CSS = ["features.css"]
F, PRO, BOTH = "free", "pro", "both"

# (anchor, screenshot, one mark per feature in the copy's order)
GROUPS = [
    # scales, routines, scale player, routine player, vocal range, Find my
    # warmup, Adaptive Mode, breathe between keys, lock screen controls, notation
    ("warm-up", "routines", [F, F, F, F, F, F, F, F, F, F]),
    # Path, Library, training plans (planFeatureAllowed: several plans and the
    # builder), plan reminders, share plan
    ("learn", "guides_path", [F, F, BOTH, F, F]),
    # pitch monitor, scores, takes (takeKeepAllowed, takeShareAllowed),
    # spectrogram (spectrogramFeatureAllowed), open a recording
    # (importFeatureAllowed), Know your note (lineKeepAllowed), singer card
    # (singerSheetAllowed), find your range, voice break, extra registers,
    # the views of your own singing (dataFeatureAllowed)
    ("your-voice", "pitch_line", [F, F, BOTH, BOTH, BOTH, BOTH, BOTH, F, F, F, PRO]),
    # tuner, drone (droneSaveAllowed)
    ("tools", "tuner", [F, BOTH]),
    # pitch targeting, Listen & Repeat, ear training (earTrainingAllowed),
    # harmony training (freeMaxSavedHarmonies), Humming Bird
    ("ear-and-games", "ear_training", [F, F, BOTH, BOTH, F]),
    # scale editor, routine editor (freeMaxCustomScales, freeMaxCustomRoutines,
    # built-ins editable with Pro), scale detector, export and import
    ("make-your-own", "create_scale", [BOTH, BOTH, F, F]),
]
BASICS_ID = "basics"
# The home's trust items the basics repeat, with their icons.
BASICS = [("offline", "wifi-off"), ("noAccount", "user-off"), ("noAds", "no-ads"), ("piano", "piano"),
          ("languages", "globe")]
SHOT_W, SHOT_H = 560, 1174


def mark(ctx, tier):
    m = ctx.copy["marks"]
    if tier == BOTH:
        return '<span class="ft-mark ft-mark--both">%s</span>' % ctx.esc(m["both"])
    return '<span class="ft-mark ft-mark--%s">%s</span>' % (tier, ctx.esc(m[tier]))


def shot(ctx, name, alt):
    rel = "images/screenshots/%s/%s.jpg" % (ctx.code, name)
    if not os.path.exists(os.path.join(B.ROOT, rel)):
        raise B.BuildError("features: %s is missing" % rel)
    return '<figure class="ft-shot"><img src="%s" width="%d" height="%d" loading="lazy" alt="%s"></figure>' % (
        ctx.asset(rel), SHOT_W, SHOT_H, ctx.esc(alt))


def group(ctx, n, g):
    anchor, name, tiers = GROUPS[n]
    if len(g["items"]) != len(tiers):
        raise B.BuildError("pages/%s/features.json: group %d has %d features, tool/templates/features.py marks %d"
                           % (ctx.code, n, len(g["items"]), len(tiers)))
    items = "\n".join("""        <li class="ft-item">
          <div class="ft-item__top"><h3>%s</h3>%s</div>
          <p>%s</p>
        </li>""" % (ctx.esc(i["name"]), mark(ctx, t), ctx.esc(i["body"])) for i, t in zip(g["items"], tiers))
    return """<section class="ft-group" id="%s" aria-labelledby="%s-h">
      <div class="ft-group__head">
        <h2 id="%s-h">%s</h2>
        <p>%s</p>
      </div>
      %s
      <ul class="ft-list" role="list">
%s
      </ul>
    </section>""" % (anchor, anchor, anchor, ctx.esc(g["heading"]), ctx.esc(g["lead"]), shot(ctx, name, g["alt"]), items)


def basics(ctx):
    b = ctx.copy["basics"]
    trust = {t["id"]: t for t in ctx.site["index"]["trust"]["items"]}
    items = "\n".join("""        <li class="ft-basic">%s<div><h3>%s</h3><p>%s</p></div></li>""" % (
        p.icon(ic, 20), ctx.esc(trust[i]["title"]), ctx.esc(trust[i]["body"])) for i, ic in BASICS)
    return """<section class="ft-group ft-group--basics" id="%s" aria-labelledby="%s-h">
      <div class="ft-group__head">
        <h2 id="%s-h">%s</h2>
        <p>%s</p>
      </div>
      <ul class="ft-basics" role="list">
%s
      </ul>
    </section>""" % (BASICS_ID, BASICS_ID, BASICS_ID, ctx.esc(b["heading"]), ctx.esc(b["lead"]), items)


def render(ctx):
    c = ctx.copy
    if len(c["groups"]) != len(GROUPS):
        raise B.BuildError("pages/%s/features.json: %d groups, tool/templates/features.py has %d"
                           % (ctx.code, len(c["groups"]), len(GROUPS)))
    m = c["marks"]
    legend = "\n".join('        <li>%s<span>%s</span></li>' % (mark(ctx, t), ctx.esc(m["legend"][t]))
                       for t in (F, BOTH, PRO))
    jump = [(GROUPS[n][0], g["heading"]) for n, g in enumerate(c["groups"])] + [(BASICS_ID, c["basics"]["heading"])]
    links = "\n".join('        <li><a class="ft-jump__link" href="#%s">%s</a></li>' % (a, ctx.esc(h)) for a, h in jump)
    head = """<header class="ft-head">
      <h1>%s</h1>
      <p class="lead">%s</p>
      <ul class="ft-legend" role="list">
%s
      </ul>
      <nav class="ft-jump" aria-label="%s">
        <ul role="list">
%s
        </ul>
      </nav>
    </header>""" % (ctx.esc(c["h1"]), ctx.esc(c["lead"]), legend, ctx.esc(c["jumpLabel"]), links)
    pro = '<p class="ft-pro">%s <a href="%s#pricing">%s</a></p>' % (
        ctx.esc(c["proNote"]["text"]), ctx.url("index"), ctx.esc(c["proNote"]["link"]))
    # the band asks with the home's closing words: "Practice this" is a guide's
    d = ctx.site["index"]["download"]
    band = ctx.cta(heading=d["title"], body=d["lead"])
    blocks = [head] + [group(ctx, n, g) for n, g in enumerate(c["groups"])] + [basics(ctx), pro, band]
    body = '    <div class="container ft">\n    %s\n    </div>' % "\n\n    ".join(blocks)
    return dict(p.result(body), css=CSS, main_class="ft-wrap")
