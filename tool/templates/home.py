"""The home page (the registry's "legacy-home"), direction C of the redesign
(scalita_app docs/design/scalita-site-redesign/C-home-*.dc.html, section 3.13
of docs/specs/site-redesign-spec.md): the hero beside a stage where the vocal
range test is ready, the four free tools, what the app adds (three steps, five
screens and the catalog), what you can count on (with the piano chord and its
credit), Free and Pro without a price, and the final call.

Its copy is the "index" block of tool/content/<locale>.json, the tool pages'
labels and tiles, and a few ui strings. build.py calls render(ctx) with the
ctx every template gets, for the page "index", and frames what comes back with
the landing chrome (tool/templates/_chrome.py): the head, the landing header,
the footer, with css/home.css after the shared stylesheets. render() returns

    title, description   the <title> and the meta description, not escaped
    head_extra           into <head> after the stylesheets (Open Graph, Twitter)
    jsonld               JSON-LD objects, written after head_extra
    body                 <main class="home-wrap" id="main"> with the sections,
                         between the header and the footer as it is (no
                         breadcrumb); lastmod hashes it. It ends with the
                         chord's few lines of script, so the home needs no
                         code from the shared script

No prices anywhere (Google Play shows the price for the reader's country), no
store badges, no Apple logo: every Google Play call has an unavailable iPhone
beside it.
"""

import _parts as P

# Each trust item's icon (the seventh, "maker", is Pablo's photo).
TRUST_ICON = {"free": "pricing", "offline": "wifi-off", "noAds": "no-ads", "noAccount": "user-off",
              "piano": "piano", "languages": "globe"}

# The stage's lanes: C4 down to D#3, labelled the way the test labels its trail.
LANES = range(60, 50, -1)

# The shared icon set (spec section 7).
icon = P.icon


def name_key(s):
    return " ".join(s.split()).casefold()


def catalog_links(ctx):
    """{scale or routine name: URL} for the ones with a page built in this
    locale. The names come from the app export, the same ARB strings the
    home's catalog was written from; a name that does not match stays text."""
    out = {}
    for page in ctx.registry:
        d = page.get("data") or {}
        for key, stem in (("scaleId", "scales"), ("routineId", "routines")):
            if key in d and ctx.has(page["id"]):
                entry = ctx.data.entry(stem, d[key])
                name = ctx.localize(entry.get("names")) if entry else None
                if isinstance(name, str):
                    out[name_key(name)] = ctx.url(page["id"])
    return out


# --------------------------------------------------------------------------
# pieces
# --------------------------------------------------------------------------

def buttons(ctx, label):
    """Google Play, tagged with the page, and the iPhone that is not there yet.
    The iPhone is no control: it reads once, as the sentence cta.iphoneLabel."""
    esc = ctx.esc
    t = ctx.site["cta"]
    return """<div class="home-buttons">
          <a class="btn btn--primary" href="%s" target="_blank" rel="noopener">%s%s</a>
          <span class="btn btn--iphone">%s<span aria-hidden="true">%s</span><span class="btn__tag" aria-hidden="true">%s</span><span class="sr-only">%s</span></span>
        </div>""" % (ctx.play_link(), icon("download", 20), esc(label), icon("iphone", 20),
                     esc(t["iphone"]), esc(t["comingSoon"]), esc(t["iphoneLabel"]))


def checks(ctx, items, cls, html=False):
    """A list with a check mark per item; pricing items may hold <strong>."""
    return '<ul class="home-checks %s">\n%s\n          </ul>' % (cls, "\n".join(
        '            <li>%s<span>%s</span></li>' % (icon("check", 16), it if html else ctx.esc(it))
        for it in items))


def head_row(ctx, block, hid):
    """A section's kicker and heading, with its lead beside them."""
    esc = ctx.esc
    return """<div class="home-head">
        <div>
          <p class="home-kicker">%s</p>
          <h2 id="%s">%s</h2>
        </div>
        <p class="home-head__lead">%s</p>
      </div>""" % (esc(block["kicker"]), hid, esc(block["title"]), esc(block["lead"]))


def note(ctx, midi):
    return ctx.esc(ctx.note(midi)[0])


# --------------------------------------------------------------------------
# the sections
# --------------------------------------------------------------------------

def hero(ctx, i):
    esc = ctx.esc
    h = i["hero"]
    # One line per sentence, "Real piano.<br>Your range.<br>Just sing.", with
    # the space kept before each break so the heading's text still reads as
    # three sentences
    title = ". <br>".join(esc(s) for s in h["title"].split(". "))
    facts = "\n".join('          <li>%s%s</li>' % (icon("check", 16), esc(f)) for f in h["facts"])
    stage_html = stage(ctx, i) if ctx.has("vocal-range-test") else ""
    return """  <section class="home-hero%s" aria-labelledby="home-hero-h">
      <div class="home-hero__text">
        <p class="pill home-hero__badge">%s</p>
        <h1 id="home-hero-h" class="home-hero__title">%s</h1>
        <p class="home-hero__lead">%s</p>
        <p class="home-hero__tagline">%s</p>
        %s
        <ul class="home-hero__facts">
%s
        </ul>
      </div>%s
    </section>""" % ("" if stage_html else " home-hero--solo", esc(h["badge"]), title, esc(h["lead"]),
                     esc(h["tagline"]), buttons(ctx, h["ctaPrimary"]), facts, stage_html)


def stage(ctx, i):
    """The range test, ready: a picture of its first screen whose Start opens
    the test (spec 3.13: static, so the home loads no tool script)."""
    esc = ctx.esc
    common = ctx.ui["common"]
    rt = ctx.ui["vocal-range-test"]
    url = ctx.url("vocal-range-test")
    lanes = "".join('<span data-n="%s"></span>' % note(ctx, m) for m in LANES)
    return """
      <section class="card home-stage" aria-labelledby="home-stage-h">
        <div class="home-stage__head">
          <div class="home-stage__tool">
            <span class="icon-box">%s</span>
            <div>
              <h2 id="home-stage-h">%s</h2>
              <p class="home-stage__meta">%s</p>
            </div>
          </div>
          <span class="pill pill--off">%s%s</span>
        </div>
        <h3 class="home-stage__title">%s</h3>
        <p class="home-stage__intro">%s</p>
        <div class="home-stage__art">
          <div class="home-stage__lanes" aria-hidden="true">%s</div>
          <span class="home-stage__kicker" aria-hidden="true">%s</span>
          <div class="home-stage__go">
            <a class="btn btn--fill" href="%s">%s%s<span class="sr-only">: %s</span></a>
            <span class="pill pill--hint home-stage__allow">%s</span>
          </div>
        </div>
        <div class="home-stage__foot">
          <a class="home-stage__nomic" href="%s">%s%s</a>
          <span class="home-stage__lock">%s%s</span>
        </div>
      </section>""" % (
        icon("range", 20), esc(ctx.label("vocal-range-test")), esc(i["stage"]["meta"]),
        icon("mic", 14), esc(common["micOff"]),
        esc(rt["title"]), esc(rt["intro"]),
        lanes, esc(common["pitchTrail"]),
        url, icon("mic", 20), esc(common["start"]), esc(ctx.label("vocal-range-test")), esc(common["allow"]),
        ctx.url("vocal-range-test", "#keyboard"), icon("piano", 16), esc(rt["noMic"]),
        icon("lock", 14), esc(common["nothingSent"]),
    )


def glyph(ctx, page):
    """A small drawing of what each tool does, 240 x 56. Words are ui strings
    and note names come from ctx.note(), so each locale draws its own."""
    if page == "vocal-range-test":
        # The test's own span, C2 to E6, with G2 to G4 lit.
        lo, hi = 36, 88

        def x(m):
            return 8 + (m - lo) * 224.0 / (hi - lo)
        a, b = x(43), x(67)
        return ('<rect x="8" y="22" width="224" height="16" rx="8" fill="#2D373A"/>'
                '<rect x="%.1f" y="22" width="%.1f" height="16" rx="8" fill="#5A9FA3" fill-opacity=".55" '
                'stroke="#8AC4C7" stroke-width="1.5"/>'
                '<circle cx="%.1f" cy="30" r="4" fill="#8AC4C7"/><circle cx="%.1f" cy="30" r="4" fill="#8AC4C7"/>'
                '<g font-size="11" fill="#E8EDEE" text-anchor="middle"><text x="%.1f" y="14">%s</text>'
                '<text x="%.1f" y="14">%s</text></g>'
                '<g font-size="10" fill="#A8B5BA"><text x="10" y="52">%s</text>'
                '<text x="230" y="52" text-anchor="end">%s</text></g>'
                % (a, b - a, a, b, a, note(ctx, 43), b, note(ctx, 67), note(ctx, lo), note(ctx, hi)))
    if page == "sing-in-tune-test":
        # A note sung 6 cents sharp, on the tuner's -50 to +50 scale.
        cents = ctx.ui["sing-in-tune-test"]["units"]["cents"]["other"].replace("{n}", "+6")
        x = 120 + 6 * 104 / 50.0
        ticks = "".join('<path d="M%d %dv%d"/>' % (tx, 36 - h, 2 * h) for tx, h in ((16, 6), (68, 4), (172, 4), (224, 6)))
        return ('<g stroke="#3A4548" stroke-width="2" stroke-linecap="round"><path d="M16 36h208"/>%s</g>'
                '<path d="M120 26v20" stroke="#A8B5BA" stroke-width="2" stroke-linecap="round"/>'
                '<circle cx="%.1f" cy="36" r="10" fill="#8AC4C7" fill-opacity=".25"/>'
                '<circle cx="%.1f" cy="36" r="5" fill="#E8EDEE"/>'
                '<text x="%.1f" y="16" font-size="11" font-weight="500" fill="#8AC4C7" text-anchor="middle">%s</text>'
                '<g font-size="10" fill="#A8B5BA" text-anchor="middle"><text x="16" y="54">&#8722;50</text>'
                '<text x="120" y="54">0</text><text x="224" y="54">+50</text></g>'
                % (ticks, x, x, x, ctx.esc(cents)))
    if page == "warm-up-piano":
        # Fourteen keys from C, a five-note scale lit (G to D). No outlines:
        # small gaps, bottom corners rounded to a quarter of a white key's
        # width and a fifth of a black one's, the lit keys glowing from their fill.
        def key(w, h, r):
            return "M0 4h%gv%gq0 %g-%g %gh-%gq-%g 0-%g-%gz" % (w, h - r, r, r, r, w - 2 * r, r, r, r)

        def keys(ref, xs):
            return "".join('<use href="#%s" x="%d"/>' % (ref, kx) for kx in xs)
        lit = range(4, 9)
        on = keys("home-kw", (8 + 16 * n for n in lit))
        return ('<defs><path id="home-kw" d="%s"/><path id="home-kb" d="%s"/>'
                '<filter id="home-key-glow" x="-50%%" y="-50%%" width="200%%" height="200%%">'
                '<feGaussianBlur stdDeviation="4"/></filter></defs>'
                '<g fill="#3A4548">%s</g>'
                '<g fill="#7FB3B5" fill-opacity=".5" filter="url(#home-key-glow)">%s</g>'
                '<g fill="#7FB3B5">%s</g>'
                '<g fill="#1E2628">%s</g>'
                % (key(15, 48, 3.75), key(9, 28, 1.8),
                   keys("home-kw", (8 + 16 * n for n in range(14) if n not in lit)), on, on,
                   keys("home-kb", (19 + 16 * n for n in (0, 1, 3, 4, 5, 7, 8, 10, 11, 12)))))
    # voice-break-finder: the piano climbing in chest voice, a shift felt at
    # E4, then on up in head voice; the words are the app's own.
    bf = ctx.data["strings"][ctx.code]["breakFinder"]
    return ('<g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M12 40h32v-7h32v-7h32v-7h32" stroke="#5A9FA3"/>'
            '<path d="M156 19v-7h32v-6h40" stroke="#8AC4C7"/></g>'
            '<path d="M148 4v40" stroke="#E8EDEE" stroke-width="1.5" stroke-dasharray="3 4" stroke-linecap="round"/>'
            '<text x="148" y="54" font-size="10" font-weight="500" fill="#E8EDEE" text-anchor="middle">%s</text>'
            '<g font-size="10" fill="#A8B5BA"><text x="12" y="11">%s</text>'
            '<text x="228" y="34" text-anchor="end">%s</text></g>'
            % (note(ctx, 64), ctx.esc(bf["chestVoice"]), ctx.esc(bf["headVoice"])))


def tools(ctx, i):
    """The four tools. One card per tool, the title its link and the whole
    card its target; on a phone the card shows the tool page's tile line."""
    esc = ctx.esc
    t = i["tools"]
    cards = []
    for item in t["items"]:
        pid = item["page"]
        if not ctx.has(pid):
            continue
        tile = (ctx.copy_of(pid) or {}).get("tile")
        cards.append("""        <article class="card home-card">
          <div class="home-card__head">
            <span class="icon-box">%s</span>
            <div class="home-card__name">
              <h3><a class="home-card__link" href="%s">%s</a></h3>
              <p class="home-card__meta">%s</p>
            </div>
          </div>
          <svg class="home-card__glyph" viewBox="0 0 240 56" width="240" height="56" aria-hidden="true">%s</svg>
          <p class="home-card__body">%s</p>%s
          <span class="home-card__open" aria-hidden="true">%s%s</span>
        </article>""" % (
            icon(P.TOOL_ICONS[pid], 20), ctx.url(pid), esc(ctx.label(pid)), esc(item["meta"]), glyph(ctx, pid),
            esc(item["body"]), '\n          <p class="home-card__tile">%s</p>' % esc(tile) if tile else "",
            esc(t["open"]), icon("arrow-right", 16)))
    return """  <section class="home-tools" aria-labelledby="home-tools-h">
      %s
      <div class="home-cards">
%s
      </div>
    </section>""" % (head_row(ctx, t, "home-tools-h"), "\n".join(cards))


def app(ctx, i):
    """What the app adds: the three steps, five screens, and the catalog."""
    esc = ctx.esc
    steps = "\n".join("""        <li class="card home-step">
          <span class="home-step__n" aria-hidden="true">%d</span>
          <div>
            <h3>%s</h3>
            <p>%s</p>
          </div>
        </li>""" % (n + 1, esc(s["title"]), esc(s["body"])) for n, s in enumerate(i["how"]["steps"]))
    shots = "\n".join("""        <li>
          <figure class="home-screen">
            <div class="home-screen__frame"><img src="%s" alt="%s" width="560" height="1125" loading="lazy" decoding="async"></div>
            <figcaption><strong>%s</strong><span>%s</span></figcaption>
          </figure>
        </li>""" % (ctx.asset("images/screenshots/%s/%s.jpg" % (ctx.code, s["file"])), esc(s["alt"]),
                    esc(s["title"]), esc(s["caption"])) for s in i["screens"])
    # The row scrolls sideways under 960 px, so it takes the keyboard too. The
    # steps' numbers are drawn, so the list says its order itself: role="list",
    # since Safari stops calling a list without bullets a list.
    shots_label = i["hero"].get("carouselLabel") or i["app"]["title"]
    return """  <section class="home-app" id="features" aria-labelledby="home-app-h">
      %s
      <ol class="home-steps" role="list">
%s
      </ol>
      <ul class="home-screens" tabindex="0" aria-label="%s">
%s
      </ul>
%s
    </section>""" % (head_row(ctx, i["app"], "home-app-h"), steps, esc(shots_label), shots, catalog(ctx, i))


def catalog(ctx, i):
    """The 21 scales and 15 routines, behind a disclosure; a scale or routine
    with a page of its own links to it."""
    esc = ctx.esc
    c = i["catalog"]
    pages = catalog_links(ctx)

    def tag(s):
        href = pages.get(name_key(s))
        if href:
            return '              <a class="tag" href="%s">%s</a>' % (href, esc(s))
        return '              <span class="tag">%s</span>' % esc(s)

    def routine(r):
        href = pages.get(name_key(r[0]))
        name = '<a href="%s">%s</a>' % (href, esc(r[0])) if href else esc(r[0])
        return '              <li><strong>%s</strong> <span>%s</span></li>' % (name, esc(r[1]))

    return """      <details class="acc acc--pill home-catalog">
        <summary class="acc__head">
          <span class="icon-box">%s</span>
          <h3>%s</h3>
          <span class="home-catalog__lead">%s</span>
          %s
        </summary>
        <div class="acc__body home-catalog__cols">
          <div>
            <h4>%s</h4>
            <div class="home-catalog__tags">
%s
            </div>
          </div>
          <div>
            <h4>%s</h4>
            <ul class="home-catalog__routines">
%s
            </ul>
            <p class="home-catalog__note">%s</p>
          </div>
        </div>
      </details>""" % (
        icon("piano", 20), esc(c["title"]), esc(c["lead"]), icon("chevron-down", 16, "acc__chev"),
        esc(c["scalesHeading"]), "\n".join(tag(s) for s in c["scales"]),
        esc(c["routinesHeading"]), "\n".join(routine(r) for r in c["routines"]), esc(c["note"]),
    )


def trust(ctx, i):
    """What you can count on. The real piano card plays a C major chord, and
    the credit the samples' licence asks for sits under the grid."""
    esc = ctx.esc
    how = i.get("how") or {}
    items = []
    for it in i["trust"]["items"]:
        if it["id"] == "maker":
            mark = '<img src="%s" alt="" width="40" height="40" loading="lazy" decoding="async">' % ctx.asset("images/pablo.jpg")
        else:
            mark = icon(TRUST_ICON.get(it["id"], "check"), 22)
        play = ""
        if it["id"] == "piano":
            play = '\n          <button type="button" class="piano-button">%s%s</button>' % (
                icon("play", 14), esc(how.get("pianoLabel") or ctx.ui["common"]["play"]))
        items.append("""        <li class="card home-trust__item home-trust__item--%s">
          %s
          <div class="home-trust__text">
            <strong>%s</strong>
            <span>%s</span>
          </div>%s
        </li>""" % (it["id"], mark, esc(it["title"]), esc(it["body"]), play))
    return """  <section class="home-trust" aria-labelledby="home-trust-h">
      <h2 id="home-trust-h" class="home-kicker">%s</h2>
      <ul class="home-trust__grid">
%s
      </ul>
      <div class="home-trust__credit">%s</div>
    </section>""" % (esc(i["trust"]["title"]), "\n".join(items), ctx.credit())


def pricing(ctx, i):
    """Free and Pro. No price: Google Play shows it, per country."""
    esc = ctx.esc
    p = i["pricing"]
    pro = p["pro"]
    return """  <section class="home-pro" id="pricing" aria-labelledby="home-pricing-h">
      <div class="card home-pro__box">
        <div>
          <h2 id="home-pricing-h">%s</h2>
          <p class="home-pro__lead">%s</p>
          %s
        </div>
        <div class="home-pro__card">
          <div class="home-pro__name">
            <h3>%s</h3>
            <span class="pill pill--tag">%s</span>
          </div>
          %s
          <p class="home-pro__note">%s</p>
        </div>
      </div>
    </section>""" % (esc(p["title"]), esc(p["lead"]), checks(ctx, p["free"]["items"], "home-checks--two"),
                     esc(pro["name"]), esc(pro["badge"]), checks(ctx, pro["items"], "home-checks--pro", html=True),
                     esc(pro["note"]))


def download(ctx, i):
    esc = ctx.esc
    d = i["download"]
    return """  <section class="home-cta" id="download" aria-labelledby="home-download-h">
      <div class="card home-cta__box">
        <h2 id="home-download-h">%s</h2>
        <p class="home-cta__lead">%s</p>
        %s
        <p class="home-cta__note">%s</p>
      </div>
    </section>""" % (esc(d["title"]), esc(d["lead"]), buttons(ctx, d["cta"]), esc(d["note"]))


def chord_script(ctx):
    """The C major chord of the real piano card. Its three notes download on
    the first tap, never with the page."""
    files = ", ".join("'%s'" % ctx.asset("audio/" + f, True) for f in ("60_C4.mp3", "64_E4.mp3", "67_G4.mp3"))
    return """  <script>
    (function () {
      var button = document.querySelector('.piano-button');
      var chord = null;
      if (!button) return;
      button.addEventListener('click', function () {
        if (!chord) {
          chord = [%s].map(function (src) { return new Audio(src); });
        }
        chord.forEach(function (note, i) {
          note.currentTime = 0;
          setTimeout(function () {
            var played = note.play();
            if (played && played.catch) played.catch(function () {});
          }, i * 80);
        });
      });
    })();
  </script>""" % files


# --------------------------------------------------------------------------
# the page
# --------------------------------------------------------------------------

def render(ctx):
    code = ctx.code
    esc = ctx.esc
    i = ctx.site["index"]

    og_alts = "\n".join(
        '  <meta property="og:locale:alternate" content="%s">' % o
        for cc, _, _, _, o, _ in ctx.locales if cc != code and cc in ctx.alternates
    )
    # No app markup: Google's software app item needs a rating or a review
    # (aggregateRating or review), which the page does not show, so it would
    # only be listed as invalid (the tools leave WebApplication out for the
    # same reason). The site name is read from the home page at the domain
    # root only.
    site = {"@context": "https://schema.org", "@type": "WebSite", "name": "Scalita", "url": ctx.origin + "/"}
    # The hero's title is the largest thing on the first screen and is set in
    # Sora 300: fetched with the page, it paints once, in its own font.
    extra = """
  <link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>

  <!-- Open Graph -->
  <meta property="og:title" content="%s">
  <meta property="og:description" content="%s">
  <meta property="og:type" content="website">
  <meta property="og:url" content="%s">
  <meta property="og:image" content="%s/images/og-image-%s.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="%s">
%s

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="%s">
  <meta name="twitter:description" content="%s">
  <meta name="twitter:image" content="%s/images/og-image-%s.png">
""" % (
        ctx.asset("fonts/sora-300.woff2"), esc(i["ogTitle"]), esc(i["ogDescription"]),
        ctx.url_abs("index"), ctx.origin, code, ctx.loc[4], og_alts,
        esc(i["ogTitle"]), esc(i["ogDescription"]), ctx.origin, code,
    )

    sections = [hero(ctx, i), tools(ctx, i), app(ctx, i), trust(ctx, i), pricing(ctx, i), download(ctx, i)]
    body = '  <main class="home-wrap" id="main">\n\n  %s\n\n  </main>\n%s' % (
        "\n\n  ".join(sections), chord_script(ctx))

    return {
        "title": i["title"],
        "description": i["description"],
        "head_extra": extra,
        "jsonld": [site] if code == "en" else [],
        "body": body,
    }
