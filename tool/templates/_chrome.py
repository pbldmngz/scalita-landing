"""The page chrome: what build.py puts around every page it writes.

The document shell, the <head> (title, description, canonical and hreflang,
the icons, the theme colour, the font preload, the stylesheets, the chrome's
scripts, and Open Graph on the template pages), the two headers, the tab
bar, the breadcrumb, the two footers, the language bar's words, the web app
manifest, and the blocks a template prints through ctx: the band (the call to
action), the piano credit, the byline and the related links.

Two contexts (tool/pages.json, "context"): the landing context (the home,
the guides, the legal and support pages, the 404) keeps the site's menu,
Features to Support with the language menu and Get the app, folded into a
menu on phones; the tools context (the tools hub and every tool) shows Home
and the four tools as one switcher, and on phones as a floating tab bar,
with a compact footer. docs/specs/site-redesign-spec.md, sections 3.1 to
3.5, has the layout; css/chrome.css draws it; js/site/chrome.js and
js/site/fullscreen.js add the little that needs a script.

build.py assembles each page from these pieces; tool/templates/home.py
renders the home page's own content. This module reads build.py's state and
helpers the way check.py does, as `import build as B`: build.py answers to
that name even when it runs as a script, so there is one build, never a
second copy without its state. Read B's names inside functions, never at
import: build.py imports this module before it defines them. A page is named
by its registry id, or "404" for the 404 page.
"""

import json
import os
import re

import build as B
import _parts as P

# The page colour, for the browser's own bar and the installed tools.
THEME = "#1E2628"

# The id of the band: Get the app scrolls to it on a page that has one.
BAND_ID = "app"

# The screenshot the band shows (images/screenshots/<locale>/<name>.jpg): by
# page id, else by template.
SHOTS = {"tools": "home", "vocal-range-test": "player", "sing-in-tune-test": "pitch_targeting",
         "warm-up-piano": "find_my_warmup", "voice-break-finder": "player"}
TEMPLATE_SHOTS = {"routine": "player", "exercise": "player", "pattern": "player", "concept": "scored",
                  "hub": "home", "voice_types_hub": "home", "library": "home", "tools_hub": "home",
                  "tool": "player"}

# Each tool's icon in the switcher and the tab bar (_parts holds the map).
TOOL_ICONS = P.TOOL_ICONS

# On a page with the full screen control: restores the mode before the first
# paint, so a tab that chose it does not see the page jump, and then loads
# js/site/fullscreen.js at once. Otherwise the script waits for the control's
# first click (it shows from 960 px), which it then replays: no page loads it
# before a tap, and the 15 KB script budget holds on the desktop piano too.
FS_HEAD = ("<script>(function(d,r){function L(f){var s=d.createElement('script');s.src='%s';s.onload=f;"
           "d.head.appendChild(s)}try{if(sessionStorage.getItem('scalita-fs')){r.setAttribute('data-fs','on');"
           "return L()}}catch(e){}d.addEventListener('click',function c(e){var b=e.target.closest&&"
           "e.target.closest('.tp-fs');if(b){d.removeEventListener('click',c,!0);L(function(){b.click()})}},!0)})"
           "(document,document.documentElement)</script>")


# --------------------------------------------------------------------------
# the document and its head
# --------------------------------------------------------------------------

def document(banner, head_html, parts, end, body_class=""):
    """A whole page: the generated-file banner, the head, the body's parts
    (the header, the content, the footer, the tab bar) a blank line apart,
    then end (the page data and the scripts), which closes the body."""
    cls = ' class="%s"' % body_class if body_class else ""
    return "%s%s\n<body%s>\n%s\n\n%s</body>\n</html>\n" % (banner, head_html, cls, "\n\n".join(p for p in parts if p), end)


def head(loc, page, c, title, description, extra="", links=None, css=("style.css", "chrome.css"),
         manifest=None, fs=False):
    """The <head>. Sora is self-hosted (css/style.css has the @font-face
    rules): no request leaves the site, and the privacy policy stays true.
    css is the stylesheets under css/, in order; manifest the URL of the
    web app manifest (the tools context links it); fs a page with the full
    screen control (FS_HEAD)."""
    code, loc_path, lang, hl, og, native = loc
    early = '  <link rel="manifest" href="%s">\n' % manifest if manifest else ""
    if fs:
        early += "  %s\n" % (FS_HEAD % B.asset("js/site/fullscreen.js"))
    sheets = "".join('  <link rel="stylesheet" href="%s">\n' % B.asset("css/" + n) for n in css)
    js = '  <script src="%s" defer></script>\n' % B.asset("js/site/chrome.js")
    return """<!DOCTYPE html>
<html lang="%s">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
  <meta name="description" content="%s">
%s
  <link rel="icon" type="image/png" sizes="32x32" href="%s">
  <link rel="icon" type="image/png" sizes="192x192" href="%s">
  <link rel="apple-touch-icon" sizes="192x192" href="%s">
  <meta name="theme-color" content="%s">
%s
%s%s%s%s</head>""" % (
        lang, B.esc(title), B.esc(description), head_links(loc, page) if links is None else links,
        B.asset("images/logo_32.png"),
        B.asset("images/logo_192.png"),
        B.asset("images/logo_192.png"),
        THEME, early,
        font_preload(extra), sheets, js,
        extra,
    )


def head_links(loc, page):
    """canonical + the hreflang set of the locales this page is built in."""
    code = loc[0]
    out = ['  <link rel="canonical" href="%s">' % B.url_abs(page, code)]
    for c, href in B.alternates(page):
        for hl in B.hreflangs(c):
            out.append('  <link rel="alternate" hreflang="%s" href="%s">' % (hl, href))
    if B.built(page, "en"):
        out.append('  <link rel="alternate" hreflang="x-default" href="%s">' % B.url_abs(page, "en"))
    return "\n".join(out)


# The faces the first screen is set in, preloaded so that each paints once,
# in its own face, and moves nothing when it arrives (decision 11: no layout
# shift): 400 the text and 500 the header, the buttons and the tabs on every
# page, 300 the titles from 600 px up (a phone sets them in 400). A face the
# page preloads itself (the home's hero, 300 at every width) is not repeated.
PRELOAD = ((400, ""), (500, ""), (300, "(min-width: 600px)"))


def font_preload(extra=""):
    """The preloads of PRELOAD's weights that style.css hosts."""
    S = B.S
    if S.font is None:
        S.font = {}
        try:
            with open(os.path.join(B.ROOT, "css", "style.css"), encoding="utf-8") as fh:
                css = fh.read()
        except OSError:
            css = ""
        for block in re.findall(r"@font-face\s*\{([^}]*)\}", css):
            src = re.search(r"url\(\s*['\"]?([^'\")]+\.woff2)['\"]?\s*\)", block)
            weight = re.search(r"font-weight:\s*(\d+)(?:\s+(\d+))?", block)
            if not src:
                continue
            lo = int(weight.group(1)) if weight else 400
            hi = int(weight.group(2)) if weight and weight.group(2) else lo
            href = src.group(1)
            if not href.startswith("/"):
                href = os.path.normpath(os.path.join("/css", href))
            for w, _ in PRELOAD:
                if lo <= w <= hi:
                    S.font.setdefault(w, href)
    lines = ['  <link rel="preload" href="%s" as="font" type="font/woff2" crossorigin%s>\n' % (
        B.esc(S.font[w]), ' media="%s"' % media if media else "") for w, media in PRELOAD
        if w in S.font and S.font[w] not in extra]
    return "".join(lines) + ("\n" if lines else "")


def og_tags(loc, page, copy):
    """Open Graph and the Twitter card of a template page, from its copy."""
    code, og = loc[0], loc[4]
    u = B.url_abs(page["id"], code)
    img = "%s/images/og-image-%s.png" % (B.SITE, code)
    alts = "".join('\n  <meta property="og:locale:alternate" content="%s">' % B.LOC[c][4]
                   for c, _ in B.alternates(page["id"]) if c != code)
    kind = "article" if page["section"] == "guides" and not page["hub"] else "website"
    return """  <meta property="og:title" content="%s">
  <meta property="og:description" content="%s">
  <meta property="og:type" content="%s">
  <meta property="og:url" content="%s">
  <meta property="og:image" content="%s">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="%s">%s
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="%s">
  <meta name="twitter:description" content="%s">
  <meta name="twitter:image" content="%s">""" % (
        B.esc(copy["title"]), B.esc(copy["description"]), kind, u, img, og, alts,
        B.esc(copy["title"]), B.esc(copy["description"]), img)


# --------------------------------------------------------------------------
# the headers
# --------------------------------------------------------------------------

def logo_link(loc, c, size=28, cls="site-logo"):
    """The mark and the name, linking the locale's home."""
    return '<a class="%s" href="%s" aria-label="%s">%s<span>Scalita</span></a>' % (
        cls, loc[1], B.esc(c["nav"]["logoAlt"]), P.icon("logo", size))


def get_app_button(c, href, cls):
    return '<a class="btn btn--primary %s" href="%s">%s<span>%s</span></a>' % (
        cls, href, P.icon("download", 18), B.esc(c["nav"]["getApp"]))


def header(loc, page, c, context, get_app, fs=False):
    """The header of a page in its context. get_app is where Get the app
    goes; fs adds the Exit full screen button (tools context only)."""
    if context == "tools":
        return tools_header(loc, page, c, get_app, fs)
    return landing_header(loc, page, c, get_app)


def landing_header(loc, page, c, get_app):
    """The site's menu: Features, Pricing, Download, Tools, Guides, Support,
    then the language menu and Get the app. On phones the six links and Get
    the app fold into #nav-menu, a sheet the toggle opens; the language
    menu stays in the bar."""
    code, loc_path = loc[0], loc[1]
    n = c["nav"]
    here = B.S.by_id[page]["section"] if page in B.S.by_id else None
    # On the sub-pages the section anchors reach back to that locale's home.
    anchor = (lambda a: "#" + a) if page == "index" else (lambda a: loc_path + "#" + a)
    rows = [(anchor("features"), "features", n["features"], "", False),
            (anchor("pricing"), "pricing", n["pricing"], "", False),
            (anchor("download"), "download", n["download"], "", False)]
    for section in B.SECTIONS:
        home = B.section_home(section, code)
        if home:
            hint = n["toolsHint"] if section == "tools" else \
                n["guidesHint"].replace("{n}", str(B.guide_count(code)))
            rows.append((B.url(home, code), section, n[section], hint, here == section))
    rows.append((B.url("support", code), "support", n["support"], "", page == "support"))
    items = "\n".join(
        '        <li><a class="site-menu__row" href="%s"%s>%s<span>%s</span>%s</a></li>' % (
            href, ' aria-current="true"' if current else "", P.icon(ic, 20), B.esc(label),
            '<span class="site-menu__hint">%s</span>' % B.esc(hint) if hint else "")
        for href, ic, label, hint, current in rows)
    return """  <header class="site-header">
    <div class="site-header__in">
      %s
      <nav class="site-nav" aria-label="%s">
        <ul id="nav-menu" class="site-menu">
%s
        <li class="site-menu__cta">%s</li>
        </ul>
      </nav>
      <div class="site-header__right">
        %s
        %s
        <button type="button" class="site-menu__toggle" aria-label="%s" data-label-close="%s" aria-expanded="false" aria-controls="nav-menu">%s%s</button>
      </div>
    </div>
  </header>""" % (
        logo_link(loc, c), B.esc(n["siteLabel"]), items,
        get_app_button(c, get_app, "btn--wide"),
        lang_menu(loc, page, c), get_app_button(c, get_app, "site-getapp"),
        B.esc(n["menuLabel"]), B.esc(n["closeMenu"]),
        P.icon("menu", 24, "i-menu"), P.icon("close", 24, "i-close"))


def tools(code):
    """The four tools in registry order: the tools section without its root."""
    return [p for p in B.section_pages("tools", code) if not B.S.by_id[p].get("root")]


def tools_header(loc, page, c, get_app, fs=False):
    """Home and the four tools as one switcher, the language menu and Get
    the app; on phones the logo and the language menu only (the tab bar
    takes the switcher's place). The hub lights no segment.

    Each tool carries its full name and its tab bar name (nav.tabLabels):
    chrome.css shows the short one until the full names fit on one row.
    The link's name is whichever one shows (the other is display: none), so
    what a speech-input user reads is what they can say (WCAG 2.5.3); the
    title keeps the full name as its description."""
    code = loc[0]
    n = c["nav"]
    segs = ['<a class="seg seg--home" href="%s" title="%s">%s<span>%s</span></a>' % (
        loc[1], B.esc(n["home"]), P.icon("home", 18), B.esc(n["home"])),
            '<span class="seg-group__rule" aria-hidden="true"></span>']
    for t in tools(code):
        full = B.esc(B.page_label(t, code))
        segs.append('<a class="seg" href="%s"%s title="%s">%s<span class="seg__full">%s</span>'
                    '<span class="seg__short">%s</span></a>' % (
                        B.url(t, code), ' aria-current="page"' if t == page else "", full,
                        P.icon(TOOL_ICONS.get(t, "tools"), 18), full,
                        B.esc(n["tabLabels"].get(t) or B.page_label(t, code))))
    exit_ = ""
    if fs:
        exit_ = '\n      <button type="button" class="btn btn--secondary btn--sm site-fs-exit">%s<span>%s</span></button>' % (
            P.icon("exit", 16), B.esc(n["exitFullscreen"]))
    return """  <header class="site-header site-header--tools">
    <div class="site-header__in">
      %s
      <nav class="site-switch seg-group" aria-label="%s">
        %s
      </nav>
      <div class="site-header__right">
        %s
        %s
      </div>%s
    </div>
  </header>""" % (logo_link(loc, c), B.esc(n["toolsLabel"]), "\n        ".join(segs),
                  lang_menu(loc, page, c), get_app_button(c, get_app, "site-getapp"), exit_)


def tabbar(loc, page, c):
    """The phones' floating tab bar of the tools context: Home and the four
    tools, by their short names (nav.tabLabels)."""
    code = loc[0]
    n = c["nav"]
    tabs = ['<a class="site-tab" href="%s">%s<span>%s</span></a>' % (loc[1], P.icon("home", 22), B.esc(n["home"]))]
    for t in tools(code):
        tabs.append('<a class="site-tab" href="%s"%s>%s<span>%s</span></a>' % (
            B.url(t, code), ' aria-current="page"' if t == page else "", P.icon(TOOL_ICONS.get(t, "tools"), 22),
            B.esc(n["tabLabels"].get(t) or B.page_label(t, code))))
    return '  <nav class="site-tabbar" aria-label="%s">\n    %s\n  </nav>' % (
        B.esc(n["toolsLabel"]), "\n    ".join(tabs))


def lang_menu(loc, page, c):
    """A disclosure menu, not a row of buttons.

    <details> is the only native HTML that opens and closes a panel with no
    script at all: the summary is focusable, Enter and Space toggle it, and
    the links inside leave the tab order when it shuts. js/site/chrome.js
    only adds Escape and click-outside, which are polish.

    The button shows the locale's code ("ES"); its label names the
    language. It lists the locales this page exists in; a page that exists
    in none (the 404) offers the homes instead.
    """
    code, loc_path, _, _, _, native = loc
    if not B.built(page, code):
        page = "index"
    items = []
    for c2, p2, lang2, hl2, _, native2 in B.LOCALES:
        if not B.built(page, c2):
            continue
        current = ' aria-current="true"' if c2 == code else ""
        items.append('<a href="%s" hreflang="%s" lang="%s"%s>%s</a>' % (B.url(page, c2), hl2, lang2, current, native2))
    return """<details class="lang-menu">
          <summary aria-label="%s">%s<span>%s</span>%s</summary>
          <div class="lang-list">
            %s
          </div>
        </details>""" % (B.esc(c["nav"]["languageLabel"] % native), P.icon("globe", 18), code.upper(),
                         P.icon("chevron-down", 14, "lang-chevron"), "\n            ".join(items))


def breadcrumb_html(crumbs, c):
    """The visible breadcrumb of a template page, from build.breadcrumbs()."""
    items = []
    for n, (label, href) in enumerate(crumbs):
        if n == len(crumbs) - 1:
            items.append('          <li aria-current="page">%s</li>' % B.esc(label))
        else:
            items.append('          <li><a href="%s">%s</a></li>' % (href, B.esc(label)))
    return """    <nav class="breadcrumb" aria-label="%s">
      <div class="container">
        <ol>
%s
        </ol>
      </div>
    </nav>""" % (B.esc(c["breadcrumb"]["label"]), "\n".join(items))


# --------------------------------------------------------------------------
# the footers
# --------------------------------------------------------------------------

def footer_bottom(c):
    f = c["footer"]
    return '<div class="site-footer__bottom"><p>&copy; 2026 Pablo Dominguez. %s</p><p>%s</p></div>' % (
        B.esc(f["rights"]), f["madeBy"])


def footer(loc, page, c):
    """The landing footer: the brand, Product, the free tools, the guides,
    Legal and Support, and the line with the joke."""
    code, loc_path = loc[0], loc[1]
    f = c["footer"]
    n = c["nav"]
    anchor = (lambda a: "#" + a) if page == "index" else (lambda a: loc_path + "#" + a)

    def column(heading, links):
        li = "\n".join('            <li><a href="%s"%s>%s</a></li>' % (href, attrs, B.esc(label))
                       for href, label, attrs in links)
        return "          <h2>%s</h2>\n          <ul>\n%s\n          </ul>" % (B.esc(heading), li)

    cols = [column(f["productHeading"], [(anchor("features"), n["features"], ""), (anchor("pricing"), n["pricing"], ""),
                                         (anchor("download"), n["download"], "")])]
    for section, heading in zip(B.SECTIONS, (f["toolsHeading"], f["guidesHeading"])):
        pages = B.section_pages(section, code)
        if pages:
            cols.append(column(heading, [(B.url(p, code), B.page_label(p, code), "") for p in pages]))
    cols.append(column(f["legalHeading"], [(B.url("privacy", code), c["privacy"]["navLabel"], ""),
                                           (B.url("terms", code), c["terms"]["navLabel"], "")]) + "\n" +
                column(f["supportHeading"], [(B.url("support", code), f["supportLink"], ""),
                                             ("https://ko-fi.com/pablodm9", f["kofi"], ' target="_blank" rel="noopener"')]))
    return """  <footer class="site-footer">
    <div class="site-footer__in">
      <div class="site-footer__cols">
        <div class="site-footer__brand">
          %s
          <p>%s</p>
        </div>
%s
      </div>
      %s
    </div>
  </footer>""" % (logo_link(loc, c), B.esc(f["brandLine"]),
                  "\n".join("        <div>\n%s\n        </div>" % col for col in cols), footer_bottom(c))


def compact_footer(loc, page, c, credit=True):
    """The tools context's footer (and the 404's): one row of links, the
    piano credit, and the line with the joke. Guides, help and legal live
    here, since the tab bar holds only Home and the tools."""
    code = loc[0]
    f = c["footer"]
    n = c["nav"]
    links = [(loc[1], n["home"], ' class="site-footer__home"')]
    for section, label in (("tools", f["toolsHeading"]), ("guides", n["guides"])):
        home = B.section_home(section, code)
        if home:
            links.append((B.url(home, code), label, ""))
    links += [(B.url("support", code), f["supportLink"], ""),
              (B.url("privacy", code), c["privacy"]["navLabel"], ""),
              (B.url("terms", code), c["terms"]["navLabel"], ""),
              ("https://ko-fi.com/pablodm9", f["kofi"], ' target="_blank" rel="noopener"')]
    nav = "\n          ".join('<a href="%s"%s>%s</a>' % (href, attrs, B.esc(label)) for href, label, attrs in links)
    note = '\n      <p class="site-footer__credit">%s</p>' % c["credit"]["piano"] if credit else ""
    return """  <footer class="site-footer site-footer--compact">
    <div class="site-footer__in">
      <div class="site-footer__row">
        %s
        <nav class="site-footer__nav" aria-label="%s">
          %s
        </nav>
      </div>%s
      %s
    </div>
  </footer>""" % (logo_link(loc, c, 24, "site-logo site-logo--sm"), B.esc(n["siteLabel"]), nav, note,
                  footer_bottom(c))


# --------------------------------------------------------------------------
# what closes the body: the language bar's words, a page's own script
# --------------------------------------------------------------------------

def scripts(loc, page, ready="", top=""):
    """The words js/site/chrome.js offers in the language bar, and a page's
    own inline code if it brings any (ready runs on DOMContentLoaded, top at
    the script's top level).

    The bar: when the browser prefers another language this page exists in,
    a bar at the bottom offers it, written in that language. It never
    redirects; closing it, or picking a language from the menu, is
    remembered under scalita-lang-choice."""
    said = lang_bar_strings(loc[0], page)
    out = '  <script type="application/json" id="site-langs">%s</script>\n' % B.inline_json(said) if said else ""
    if ready.strip() or top.strip():
        out += "  <script>\n    document.addEventListener('DOMContentLoaded', function () {\n%s    });\n%s  </script>\n" % (
            ready, top)
    return out


def lang_bar_strings(code, page):
    """What the bar says in each other language this page is built in, keyed
    like the hreflang's language."""
    out = {}
    for c2, _, _, hl, _, _ in B.LOCALES:
        if c2 != code and c2 in B.S.site and B.built(page, c2):
            out[hl.split("-")[0].lower()] = B.S.site[c2]["langBar"]
    return out


# --------------------------------------------------------------------------
# the web app manifest
# --------------------------------------------------------------------------

def manifest(code):
    """One locale's web app manifest: the tools, from the locale's tools hub,
    so Chrome on Android can put them on the home screen. No service worker:
    the tools need the network for their first load, as any page does."""
    loc = B.LOC[code]
    c = B.S.site[code]
    hub = B.section_home("tools", code)
    start = B.url(hub, code) if hub else loc[1]
    copy = B.S.copy.get((hub, code)) or {}
    icons = [{"src": "/images/logo_192.png", "sizes": "192x192", "type": "image/png"},
             {"src": "/images/logo_512.png", "sizes": "512x512", "type": "image/png"}]
    if os.path.exists(os.path.join(B.ROOT, "images", "maskable_512.png")):
        icons.append({"src": "/images/maskable_512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"})
    m = {
        "id": start,
        "name": "Scalita",
        "short_name": "Scalita",
        "description": copy.get("description", ""),
        "lang": loc[2],
        "dir": "ltr",
        "start_url": start,
        "scope": loc[1],
        "display": "standalone",
        "background_color": THEME,
        "theme_color": THEME,
        "icons": icons,
        "shortcuts": [{"name": B.page_label(t, code), "short_name": c["nav"]["tabLabels"].get(t) or B.page_label(t, code),
                       "url": B.url(t, code),
                       "icons": [{"src": "/images/logo_96.png", "sizes": "96x96", "type": "image/png"}]}
                      for t in tools(code)],
    }
    return json.dumps(m, ensure_ascii=False, indent=2) + "\n"


# --------------------------------------------------------------------------
# the blocks a template prints: ctx.credit(), cta(), byline(), related(ids)
# --------------------------------------------------------------------------

def credit(ctx):
    return '<p class="credit">%s</p>' % ctx.site["credit"]["piano"]


def shot_alt(ctx, name):
    for s in ctx.site.get("index", {}).get("screens") or []:
        if s.get("file") == name:
            return s.get("alt") or ""
    return ""


def cta(ctx, heading=None, body=None, shot=None):
    """The band (spec 2.9): the page's one call to action. heading and body
    are plain text (cta.heading and cta.body when not given: the guides'),
    shot the screenshot's name (by page, else by template). Google Play,
    tagged with the page, and beside it the iPhone version that is not out
    yet: a visibly disabled button, no store badge."""
    t = ctx.site["cta"]
    shot = re.sub(r"\.jpg$", "", shot or SHOTS.get(ctx.page["id"]) or TEMPLATE_SHOTS.get(ctx.page["template"], "player"))
    phone = ""
    if os.path.exists(os.path.join(B.ROOT, "images", "screenshots", ctx.code, shot + ".jpg")):
        phone = '\n  <div class="band__phone"><img src="%s" width="560" height="1125" loading="lazy" alt="%s"></div>' % (
            ctx.asset("images/screenshots/%s/%s.jpg" % (ctx.code, shot)), ctx.esc(shot_alt(ctx, shot)))
    return """<section class="band" id="%s" aria-labelledby="%s-h">
  <div class="band__main">
    <div class="band__head">%s<h2 id="%s-h">%s</h2><span class="pill pill--tag">%s</span></div>
    <p class="band__body">%s</p>
    <div class="band__actions">
      <a class="btn btn--primary" href="%s" target="_blank" rel="noopener">%s<span>%s</span></a>
      <button type="button" class="btn btn--iphone" disabled aria-disabled="true">%s<span>%s &middot; %s</span></button>
    </div>
  </div>%s
</section>""" % (BAND_ID, BAND_ID, P.icon("logo", 28), BAND_ID, ctx.esc(heading or t["heading"]), ctx.esc(t["free"]),
                 ctx.esc(body or t["body"]), ctx.play_link(), P.icon("download", 18), ctx.esc(t["button"]),
                 P.icon("iphone", 18), ctx.esc(t["iphone"]), ctx.esc(t["comingSoon"]), phone)


def byline(ctx):
    b = ctx.site["byline"]
    photo = ""
    if os.path.exists(os.path.join(B.ROOT, "images", "pablo.jpg")):
        photo = '\n  <img src="%s" alt="" width="80" height="80" loading="lazy">' % ctx.asset("images/pablo.jpg")
    return """<aside class="byline">%s
  <p class="byline__name">%s</p>
  <p class="byline__line">%s</p>
</aside>""" % (photo, ctx.esc(b["name"]), ctx.esc(b["line"]))


def related(ctx, ids):
    """Related pages as rows (.aside__row) under their heading."""
    for i in ids:
        if i not in B.S.by_id:
            raise B.BuildError("related(): %r is not in tool/pages.json" % i)
    items = [i for i in ids if i != ctx.page["id"] and ctx.has(i)]
    if not items:
        return ""
    links = "\n".join('    <li><a class="aside__row" href="%s"><span>%s</span>%s</a></li>' % (
        ctx.url(i), ctx.esc(ctx.label(i)), P.icon("chevron-right", 16)) for i in items)
    return """<aside class="related">
  <h2>%s</h2>
  <ul>
%s
  </ul>
</aside>""" % (ctx.esc(ctx.site["related"]["heading"]), links)
