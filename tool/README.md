# tool/

`build.py` writes every page of scalita.com from the content files;
`check.py` checks the result and the content.

```bash
python3 tool/build.py && python3 tool/check.py
```

No dependencies, no node, no install. Python 3 and nothing else.

**The generated HTML is committed and is what GitHub Pages serves.** The site is
still plain static HTML: nothing runs at request time. Every generated file
carries a comment at the top saying so, because the next build overwrites it.
Edit `tool/content/` instead.

## Why

Seven locales times every page is a lot of files that have to agree on the
navigation, the footer, the language menu and the hreflang links. Kept in sync
by hand they were already drifting: the Spanish pages had lost their accents,
the French support page still quoted dollars, and the language switcher was
three buttons after the app had shipped five languages.

## build.py

```bash
python3 tool/build.py                  # strict, writes into the repo root
python3 tool/build.py --out DIR        # writes the whole site into DIR instead
python3 tool/build.py --allow-missing  # skips, with a warning, what is not written yet
python3 tool/build.py --content DIR    # reads content from DIR, not tool/content
python3 tool/build.py --today 2026-11-02          # the date a changed page's lastmod gets
python3 tool/build.py --record-published          # see "URLs"
python3 tool/build.py --allow-missing --page-data vocal-range-test --locale es
```

- **Strict by default.** A registry page, a locale, a ui file, a template, a
  tool script or an export file that does not exist yet is an error. With
  `--allow-missing` it is skipped with a warning: a page without its content
  or template is not built, a locale without its `<loc>.json` is not built, a
  missing ui translation falls back to English, a link to a page that is not
  built keeps its words and loses the link. A key-parity mismatch, a bad slug
  or an unknown token is an error either way.
- **Build somewhere else while others work.** `--out DIR` writes the site, the
  sitemaps, `404.html`, `robots.txt`, `.nojekyll` and `DIR/tool/lastmod.json`
  into DIR and nothing into the repo. It links `css/ js/ images/ audio/ fonts/`
  into DIR, so `python3 -m http.server -d DIR` serves a working site and
  `check.py --site DIR` checks it. `--out` inside the repo is refused.
- **Clean.** A build removes the pages an earlier build wrote into the same
  directory and this one did not (files with the generated banner only, never
  `tool/` or `.git/`), so a renamed slug leaves no stray copy.
- **Same input, same bytes.** A rebuild with nothing changed rewrites every file
  identically. A build that fails writes nothing: every page renders before
  the first file is written.
- `--page-data PAGE_ID --locale xx` prints the page data that page carries and
  writes nothing: a tool's script can be developed against it before the
  page's template exists (without a template, it is built from the registry:
  the page's tool, plus a `main` player for its routine or scale).

What a full build writes:

| | |
|---|---|
| `index.html`, `privacy.html`, `terms.html`, `support.html`, and the same in `es/ fr/ pt/ de/ tr/ id/` | the four legacy pages, at their old `.html` URLs |
| `tools/`, `tools/<slug>/`, `guides/<slug>/`, and `<loc>/<section word>/...` | every other page, one directory each (`index.html` inside, never linked) |
| `sitemap.xml` | an index of `sitemap-core.xml` (legacy), `sitemap-tools.xml`, `sitemap-guides.xml` |
| `404.html` | one line in each language, with each language's home and section homes |
| stubs | a redirect page at every published URL whose page moved (see "URLs") |
| `robots.txt`, `.nojekyll` | `Disallow: /tool/`; no Jekyll, so `tool/` is not rendered as a page |
| `tool/lastmod.json` | see "lastmod" |

## Content layout

```
tool/content/<loc>.json             site-wide strings and the four legacy pages
tool/content/pages/<loc>/<id>.json  one page's copy (id from tool/pages.json)
tool/content/pages/<loc>/privacy-web.json   the privacy page's website section
tool/content/ui/<loc>/common.json   strings every tool shares
tool/content/ui/<loc>/mic.json      the microphone's failure states and level hints
tool/content/ui/<loc>/<toolId>.json one per tool UI: vocal-range-test,
                                    sing-in-tune-test, player, voice-break-finder
tool/content/ui/<loc>/templates.json the fixed headings and labels the page templates print
tool/data/app/*.json                the app's own data, exported (tool/data/README.md)
tool/pages.json                     the registry: which pages exist
```

`<loc>` is one of `en es fr pt de tr id` (`pt` is Brazilian Portuguese).

**English is the reference.** Every other locale's file has exactly the English
key set at every depth, and lists of the same length (a translation keeps every
FAQ and every source, in order). The build fails otherwise. A `null` on either
side is not compared, for a box only one language fills.

Write real characters (`é`, `ı`, `c¹`), not entities. No em dashes, anywhere.

### Site-wide strings (`<loc>.json`)

The legacy keys are as they were. A few hold raw HTML because they contain links
or emphasis: `footer.madeBy`, `index.pricing.*.items`, the `body` of the
privacy, terms and support pages. Everything else is escaped on the way out.
`currency` feeds the home page's JSON-LD offer (price 0).

Added for the tools and guides (English in every file until a translator
replaces it; `check.py` lists the ones still in English):

| key | what it is |
|---|---|
| `nav.tools`, `nav.guides` | the nav links to the two sections |
| `footer.toolsHeading`, `footer.guidesHeading` | footer column headings |
| `sections.tools`, `sections.guides` | the URL words of the two sections: lowercase ASCII words joined by hyphens (`herramientas`, `guias`). Frozen once published |
| `langBar.text`, `langBar.close` | the language bar, in this file's language: "Ver esta página en español", and its close button's label |
| `breadcrumb.home`, `breadcrumb.label` | the breadcrumb's first item, and its `aria-label` |
| `cta.heading`, `cta.body`, `cta.button`, `cta.ios` | the call to action after the content; `cta.ios` is the line for iPhone and desktop readers |
| `credit.piano` | the Salamander CC BY 3.0 credit (HTML: it links the licence) |
| `byline.name`, `byline.line` | the author and his one line |
| `notFound.line`, `notFound.homes` | the 404 page's line, and its link to the home page |
| `related.heading`, `sources.heading`, `faq.heading` | section headings |

### Page files (`pages/<loc>/<id>.json`)

Common fields, on every page:

| field | kind | |
|---|---|---|
| `slug` | text | the URL word: lowercase ASCII words joined by single hyphens; the English slug is the page id. Absent on a section's root page (`tools`), whose URL is the section word |
| `label` | text | the short name the nav, footer, breadcrumb, cards and related links use (one to four words) |
| `title`, `description` | text | `<title>` and meta description, unique in the locale |
| `h1`, `lead` | text | |
| `sections` | list of `{heading: text, html: HTML}` | |
| `faq` | list of `{q: text, a: HTML}` | shown as text, no FAQPage markup |
| `sources` | list of `{label: text, url}` | full URLs, the same in every locale |
| `reviewed` | `YYYY-MM-DD` | |
| `writtenAgainst` | text or null | the export `hash` of the routine or scale the page was written against |

Per template:

| template | fields |
|---|---|
| `hub`, `voice_types_hub` | `intro` (HTML), `children` (page ids, the cards); on `voice_types_hub` a section may carry `voiceType`, an id from `voice_types.json` (the same in every locale): that section is the type's anchor and gets its keyboard and facts |
| `tool` | `toolId`, `instructions`, `sampleResult`, `notClaimed` (HTML) |
| `routine` | `routineId`, `whyOrder`, `whatToFeel`, `whenToStop`, `next` (HTML) |
| `exercise` | `syllables` (ids from `syllables.json`), `troubleshooting` (HTML) |
| `pattern` | `scaleId`, `localBox` (HTML or null) |
| `concept` | `shortAnswer`, `listenFor`, `misconceptions`, `seeProfessional` (HTML) |
| `library` | none beyond the common ones |

`routineId`, `scaleId`, `toolId`, `children`, `syllables`, `writtenAgainst` and
the source URLs are the same in every locale and match the registry's `data`.
Must not be empty: `label title description h1 lead reviewed` everywhere, and
the template's written fields (`check.py`, `FILLED`, has the list; sources are
required on every template but `hub`).

Word ceilings for an English page, every written word counted (not the title,
description, label or sources): routine 900, exercise and pattern 800, concept
1200, voice_types_hub 1300, library 500. Ceilings, not targets. A translation
may run a third longer.

**Two tokens**, in any string of a page or ui file:

- `{{note:C4}}` writes the key in the locale's notation with the international
  name: `Do3 (C4)` in French, `c¹ (C4)` in German, `C4` in English. Scientific
  names (`F#3`, `Bb2`) or MIDI numbers (`{{note:60}}`); `{{note:C4:local}}` and
  `{{note:C4:intl}}` give one half. Note names in copy are never typed by hand.
- `href="page:vocal-range-test"` (or `page:voice-types#tenor`) links another
  page of the site in the same locale. A link to the site in any other form is
  an error: slugs differ per locale.

`privacy-web.json`: `heading` (text) and `html` (HTML), appended to the privacy
page as `<h2 id="website">`.

### ui files (`ui/<loc>/<name>.json`)

Strings a script shows. The English of `common.json` belongs to the generator,
`mic.json` to the pitch engine, each tool file to that tool's script. Flat or
nested, the same keys in every locale. Variables are `{name}` placeholders the
script fills in; a translation keeps the same placeholders. No verdict words
(`check.py` has the list per language): a tool reports a measurement, never a
judgement of the voice.

`common.json`: `start stop listening tooQuiet allow result share save
openInBrowser androidOnly lastTime tryAgain play loading next back close copyLink
copied privacyLine noScript`. `androidOnly` is a short label ("Android only");
the full sentence is page data's `androidOnlyLine`.

`templates.json` is not a tool's: it holds the fixed headings, table headers and
labels the page templates print ("Why this order", "Scale", "First shift"),
read through `ctx.ui["templates"]`. App terms in it are copied from the ARB.

## Registry (`tool/pages.json`)

A list, in the order the footer, sitemaps and builds use:

```json
{"id": "vocal-range-test", "section": "tools", "template": "tool",
 "data": {"toolId": "vocal-range-test"}, "hub": false, "parent": "tools"}
```

- `id`: the English slug, also the `utm_campaign` of the page's Play links.
- `section`: `tools`, `guides` or `legacy` (the four old pages, templates
  `legacy-home` and `legacy-text`, built inside `build.py`).
- `template`: a module in `tool/templates/`.
- `data`: `{toolId}`, `{routineId}` or `{scaleId}`, or `{}`.
- `hub`: a hub page (no Article markup, cards for its children).
- `parent`: the page above it in the breadcrumb, or null.
- `root: true` (optional, one per section): the section's index, at the
  section word's own URL. `tools` has it.

The nav's Tools link goes to the section's root page, Guides to its first hub
(`vocal-warm-ups`). The footer lists every page of both sections. Pages are
added by hand, on purpose: no page per key, range or phrasing.

## URLs

| page | English | Spanish |
|---|---|---|
| legacy | `/privacy.html` | `/es/privacy.html` |
| section root | `/tools/` | `/es/herramientas/` |
| any other | `/guides/lip-trills/` | `/es/guias/vibracion-de-labios/` |

Every canonical, internal link, hreflang and sitemap entry uses exactly that
string: root-absolute, a trailing slash, never `index.html`. Assets are
root-absolute too (`/css/style.css?v=...`).

**Slugs freeze once published.** `tool/published-urls.txt` lists every URL that
is or was live (`path page-id locale`). When a listed URL is no longer built,
the build writes a stub there (meta refresh 0, a canonical to the page's new
URL, a plain link) if the page still exists, and fails if it does not: then
point that line at another page id. Before the commit that publishes new pages,
run `python3 tool/build.py --record-published` to add their URLs.

## Template contract (`tool/templates/<name>.py`)

```python
def render(ctx):
    return {"body": html, "jsonld": [], "head_extra": "", "page_data": {...}}
```

`body` is the page's main content. `build.py` puts it inside `<main id="main">`
after the visible breadcrumb, and adds the head (title, description,
canonical, hreflang, Open Graph), the nav, the footer, the language bar, the
scripts and the page data. Do not emit those, a breadcrumb or `#page-data`
yourself. `jsonld` is extra JSON-LD objects; `build.py` already emits
BreadcrumbList on every page and Article on guides (not on hubs), with the
dates from `lastmod`. No FAQPage, no HowTo, and no WebApplication on the tools:
Google's software app markup needs a rating or a review, so it would only be
listed as invalid.
`head_extra` goes into `<head>`. `page_data` adds to the page data (below).
Templates import shared pieces with `import _parts`.

`ctx` carries:

| | |
|---|---|
| `loc`, `code`, `lang` | the LOCALES row, the locale code (`pt`), the `<html lang>` (`pt-BR`) |
| `site` | the locale's `<loc>.json` |
| `page` | the registry entry |
| `copy` | the page's content file, tokens filled in |
| `data` | the export: `ctx.data["routines"]` as written, `.get(stem)`, `.entry(stem, id)`, `.local(stem, id=None)` localized |
| `ui` | `ctx.ui["common"]`: a ui file in this locale |
| `alternates` | `{code: absolute URL}` of this page in every locale it is built in |
| `registry` | every registry entry |

and helpers: `url(id, frag="")` (root-relative), `url_abs(id)`, `has(id)` (built
in this locale), `label(id)`, `copy_of(id)` (another page's copy), `asset(path)`,
`play_link()` (escaped for an attribute) and `play_url()`, `inline_json(obj)`,
`esc(s)`, `breadcrumbs()` (`[(label, url)]`), `note(midi)` (`(local, intl)`),
`note_label(midi)` (`Do3 (C4)`, escaped), `localize(obj)`, `player_data(kind,
id)`, and the blocks `cta()`, `credit()`, `byline()`, `related(ids)`.

Markup `build.py` writes (W0-CSS styles it):

```html
<nav class="breadcrumb" aria-label="..."><div class="container"><ol>
  <li><a href="/es/">Inicio</a></li> ... <li aria-current="page">...</li>
</ol></div></nav>
<aside class="cta-block"><h2/><p/><p><a class="btn btn-primary"/></p><p class="cta-block__other"/></aside>
<p class="credit">...</p>
<aside class="byline"><img/>?<p class="byline__name"/><p class="byline__line"/></aside>
<aside class="related"><h2/><ul><li><a/></li></ul></aside>
<section class="notfound"><div class="container"><h1>404</h1><ul><li lang><p/><p class="notfound__links"><a/>...</p></li></ul></div></section>
<div class="lang-bar" data-nosnippet lang="es"><p><a hreflang/></p><button class="lang-bar__close" aria-label/></div>
```

The language bar is created by the page's script only when it is shown (the
browser prefers another language this page exists in, and no choice is stored
under `scalita-lang-choice`), appended to `<body>`, fixed at the bottom. On the
home page, step 1 of "how it works" gains `<p class="step-link"><a/></p>` to the
range test, and catalog entries with a page of their own become links
(`<a class="tag">` and `<strong><a></a></strong>`).

## Page data contract

Every page whose body has a tool mount point carries one
`<script type="application/json" id="page-data">` before its scripts, written
by `build.py` (a template adds to it with `page_data`). Read it with
`JSON.parse(document.getElementById('page-data').textContent)`. No `<`
survives inside it.

Mount points: `<div data-tool="<toolId>">`, and for the player
`<div data-tool="player" data-player="<key>">`. For every toolId on a page the
build adds `<script type="module" src="/js/tools/<toolId>.js?v=<hash>">`, after an
import map that versions every file under `js/`. Tool modules are ES modules
with no bundler and no runtime dependencies. Each mounts itself on every
`[data-tool="<toolId>"]` once the DOM is ready (on `DOMContentLoaded`, or at
once if it has passed) and exports `mount(el, pageData)` for tests. Engines live
in `js/audio/`. Import them by root-absolute or relative path; the import map
adds the version. A worklet is not reached by import maps: load it from
`pageData.assets['/js/audio/capture.worklet.js']`. No user-facing string in JS:
every one comes from `strings`.

```js
{
  "locale": "fr",                 // the site code: en es fr pt de tr id
  "lang": "fr",                   // BCP 47 for Intl and <html lang>: pt-BR for pt
  "pageId": "vocal-range-test",
  "strings": {                    // one object per ui file, by file name
    "common": {...},              // ui/<loc>/common.json
    "mic": {...},                 // ui/<loc>/mic.json, one key per mic.js error code
    "vocal-range-test": {...}     // ui/<loc>/<toolId>.json for each tool mounted
  },
  "notes": {"21": ["La-2", "A0"], ..., "60": ["Do3", "C4"], ..., "108": ["Do7", "C8"]},
                                  // MIDI 21 to 108 as keys: [local name, international name].
                                  // Pair them as "Do3 (C4)"; where both are equal show one
  "voiceTypes": [                 // voice_types.json, localized, VoiceType order
    {"id": "soprano", "name": "Soprano", "rangeLow": 60, "rangeHigh": 84,
     "presetId": "soprano", "presetLow": 60, "presetHigh": 84,
     "primo": 65, "secondo": 77, "isMaleVoice": false}
  ],
  "registers": [                  // registers.json, localized
    {"id": "subharmonic", "name": "...", "description": "...", "low": 33, "high": 41,
     "floor": ..., "ceiling": ..., "minSpan": ..., "routinesUsing": [...]}
  ],
  "playLink": "https://play.google.com/store/apps/details?id=com.scalita.app&hl=fr&referrer=utm_source%3Dscalita_fr%26utm_medium%3Dweb%26utm_campaign%3Dvocal-range-test",
  "androidOnlyLine": "...",       // the site's cta.ios: for iPhone and desktop readers
  "piano": {
    "base": "/audio/piano-web/",
    "manifest": {                 // audio/piano-web/manifest.json, trimmed
      "credit": "...", "license": "...", "maxShift": 1,
      "notes": [{"midi": 33, "file": "33_A1.mp3", "duration": 5.0, "v": "b7f13a0cef"}]
    }                             // null while the samples are missing; fetch base + file + "?v=" + v
  },
  "links": {"index": "/fr/", "vocal-range-test": "/fr/outils/test-tessiture-voix/", ...},
                                  // every page built in this locale, by id
  "assets": {"/js/audio/pitch.js": "/js/audio/pitch.js?v=...", ...},
                                  // every file under js/ with its versioned URL
  "players": {                    // what each player mount plays, by data-player key
    "main": {...}                 // ctx.player_data(kind, id), below
  }
}
```

Localized export data follows one rule: every `{loc: value}` map becomes the
page locale's value, and under `names`, `descriptions`, `labels` and
`syllableByLocale` it moves to `name`, `description`, `label` and
`syllableLocal`. Everything else is as `tool/data/README.md` describes it.

A player entry, `ctx.player_data("routine", "pre_performance")`, is the
routine's `routines.json` entry localized plus `kind` and `scales`:

```js
{"kind": "routine", "id": "pre_performance", "hash": "...", "name": "...",
 "description": "...", "isRegisterRoutine": false,
 "setupCues": [{"id": "...", "label": "...", "description": "..."}],
 "steps": [{"scaleId": "five_note", "syllable": "Trr", "syllableLocal": "Trr",
            "tips": "...", "trill": "tongue", "tempo": 100, "style": "smooth",
            "direction": "mirror", "repeatCount": 1, "span": null, "useVocalRange": true,
            "semitoneStep": null, "register": null, "anchorHigh": false,
            "passaggioIntent": "none", "badges": [{"id": "sovt", "intensity": null, "label": "..."}]}],
 "presets": {"tenor": {"roots": [[50, 51, ...], ...], "durationMs": 432000, "minutes": 8}},
 "scales": {"five_note": {"id": "five_note", "name": "...", "intervals": [...], "beats": ...,
            "naturalDirection": "...", "noteCount": 9, "span": 7, "depth": 0, "movableDo": {...}}}}
```

`ctx.player_data("scale", "five_note")` is `{"kind": "scale"}` plus the scale's
`scales.json` entry localized, its `presets` included (one per voice type:
`startMidi endMidi comfortMidi semitoneStep span depth tempo direction roots`).
A template may put more keys in an entry; the player reads what it needs.

A mount that plays one of several routines or scales (the warm-up piano, the
warm-ups hub) gets a chooser instead, written by `_parts.player_entries()`:

```js
{"kind": "chooser",
 "items": [{"kind": "scale", "id": "five_note", ...}, {"kind": "routine", "id": "pre_performance", ...}],
 "selected": "scale:five_note"}   // "<kind>:<id>" of the item it opens on
```

Each item is a `player_data()` entry as above. With a single item the mount
gets that entry itself, not a chooser.

## lastmod

`tool/lastmod.json` holds, per URL, a hash of the page's main content (the
`<main>` body, or the legacy pages' sections, without `?v=` versions), its
`lastmod` and `since` (first built). A build gives a page today's date only
when that hash changed, so the sitemaps' `<lastmod>` (and an Article's
`dateModified`) moves only for pages whose content did. A build into the repo
updates the file; one with `--out` writes `DIR/tool/lastmod.json` and leaves
the repo's alone. It was seeded with the legacy pages' dates from git.

Local builds date a change the day they see it, which is not the day it goes
live. `--record-published` fixes that for the commit that publishes: every URL
whose `lastmod` is later than the last commit (`git log -1 --format=%cs`) gets
`--today`, and every URL not yet in `tool/published-urls.txt` gets `--today` as
its `since` (an Article's `datePublished`).

## check.py

```bash
python3 tool/check.py                          # the repo root and tool/content
python3 tool/check.py --site DIR --content DIR # a build made with --out (and --content)
python3 tool/check.py --content-only [--locale es]
python3 tool/check.py --strict                 # warnings fail too
```

Errors fail; warnings are fine while the site is being written and wrong once
it is published (`--strict` turns them into errors, run it before publishing);
notes never fail.

Content: JSON parses; key parity with English for site, page, ui and privacy
files; required fields present and filled per template; field types; slugs
(the rule, unique per locale, English slug equals the id, none on a root page);
section words; ids, data and source URLs the same as English and matching the
registry; hub children exist; tokens valid; HTML fields close what they open;
no site link outside `page:`; ui placeholders match English; word ceilings; no
em dash; verdict words (an error in ui files and sample results, a warning in
prose; the tone-deaf words are fine in prose, where a page asks the reader's
question, never as a result); English left in a translation (an error),
English placeholders (a warning); a section's `voiceType` known to the export
and the same as English; export-hash drift (a warning, also for a page whose
`writtenAgainst` names a routine its registry entry does not play); titles and
descriptions measured with their note tokens filled in (a note); 80% main-text
similarity between two pages of a locale.

Site: every page parses and closes its tags, ids unique; `<html lang>` matches
the locale; one self canonical, equal to its sitemap `<loc>`; hreflang sets
equal to the sitemap's, complete, reciprocal, `pt` beside `pt-BR`, x-default
present; titles and descriptions unique per locale; no keywords meta; JSON-LD,
page data and import map parse with no raw `<`; no FAQPage or HowTo, WebSite on
`/` only, BreadcrumbList on every new page, no Offer but price 0; every Play
link, `installUrl` and `playLink` opens `id=com.scalita.app`, with `hl` in
every locale but English and the referrer `utm_source=scalita_<code>&utm_medium=web&utm_campaign=<page id>`; every local
asset exists and is root-absolute, `?v=` hashes current (a warning); links only
to canonical page URLs (never `index.html`, never a stub), anchors exist; no
orphans; every page within 3 clicks of its locale's home; sitemap index and
children well formed, no priority or changefreq, lastmods matching
`tool/lastmod.json`; stubs point at pages; every published URL still answers;
`robots.txt` disallows `/tool/` and names the index; `.nojekyll` and `404.html`
exist, the 404 root-absolute and noindex; 80% similarity on the rendered main
text; no em dash in any output or in `js/`, `css/`, `tool/`.

## The app's data

`tool/data/app/` is exported from the Flutter repo; `tool/data/README.md` has
the schema. After any app change to scales, routines, syllables, cues, voice
types, notation or strings:

```bash
# from this repo's root, with scalita_app checked out next to it
(cd ../scalita_app && flutter test test/web_export_test.dart --dart-define=SCALITA_WEB_EXPORT="$PWD/../scalita-landing/tool/data/app")
python3 tool/build.py && python3 tool/check.py
```

then read the drift warnings: a page written against a routine that changed
says so.

## Publishing

1. `python3 tool/build.py` (strict, in place) and `python3 tool/check.py --strict`.
2. On the day you push: `python3 tool/build.py --record-published`. It adds the
   new URLs to `tool/published-urls.txt` and dates what this push changes
   today (see "lastmod").
3. Commit and push; Pages serves it within ten minutes.
