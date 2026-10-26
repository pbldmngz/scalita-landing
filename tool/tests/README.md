# tool/tests/

Tests for the site's scripts and pages. Nothing here is built into the site,
and nothing a test writes lands in this repo: everything in it is publicly
served. Composed audio, goldens and screenshots go to `SCALITA_SCRATCH`, else
the system temp folder. Run everything from the repo root.

## One command: the built site, end to end

```bash
python3 tool/build.py --allow-missing      # or a strict build once every locale is in
python3 -B tool/tests/e2e/run.py
```

`tool/tests/e2e/run.py` serves the site in the repo root the way GitHub Pages
does (a directory answers with its `index.html`, anything missing with
`404.html`, nothing cached) and drives the real built pages in Chromium,
Firefox and WebKit. It builds nothing. It prints one `ok` or `FAIL` line per
check and ends with `PASS` or `FAIL` and the counts; the exit code is 0 only
when nothing failed.

```bash
python3 -B tool/tests/e2e/run.py --site DIR          # a site built with tool/build.py --out DIR
python3 -B tool/tests/e2e/run.py --only range,tune   # some groups
python3 -B tool/tests/e2e/run.py --locales en,es     # the page sweep for some locales
python3 -B tool/tests/e2e/run.py --all               # the unit and per-tool suites below first
```

| Group | What it holds |
|---|---|
| `pages` | every page in the sitemaps, and `404.html`, on a 360 px phone (a touch screen: pointer coarse), English at 1280 px too: no console error or warning, no failed request, nothing wider than the screen, every tool mount filled with no `undefined`, `NaN` or `{placeholder}` on it, the page data contract of `tool/README.md`, every Play link tagged with the page's locale and id and the iPhone "Coming soon" beside each one that shows (decision 8), the band's buttons each on one line, no audio before a tap; the navigation of the page's context (decision 2: on landing pages today's menu, Features, Pricing, Download, Tools, Guides, Support, the language menu and Get the app, folded behind a toggle on a phone, and the full footer, compact on the 404; on the tools hub and the tools Home and the four tools as one switcher on a desktop and five floating tabs on a phone, no tab's name cut, the compact footer, the web app manifest, the full screen control on a desktop tool page), Get the app reaching a Play link, `theme-color`; no piano key with a border, an outline, an inset line or an end rounder than a quarter of its width (6 px white, 4 px black; decision 5, computed style, the hub's drawn keys never stroked); no layout shift while it loads (0.01 at most); scripts before a tap 15 KB gzipped at most at either width, a tool page's HTML 15 KB gzipped at most and the tools hub's 18 (a guide over 15 is printed, not failed: the budget is a tool page's), every page's stylesheets 20 KB gzipped together (decision 11); the home page's chord loads its three notes on the tap, not before |
| `links` | every local URL those pages name (links, assets, canonical, hreflang, `og:image`) answers 200 without a redirect |
| `notfound` | `404.html` is noindex and names only root-absolute URLs that answer; a missing deep URL gets it, styled, with nothing else missing |
| `langbar` | a browser that prefers Spanish gets the bar in Spanish on the English home, closed it stays closed after a reload, none in the browser's own language; a tool page offers Spanish only once it exists in Spanish |
| `chrome` | a phone's landing menu opens from its toggle (six rows and Get the app), Escape closes it and gives the toggle its focus back, a row closes it; on each desktop tool page Full screen leaves only the tool and the switcher with the focus on Exit, its script loading on that click and never before, Escape brings the page back; the mode holds over a reload and from tool to tool, Exit and Home leave it; in every locale the tools header is one row at 960, 1024, 1280, 1366, 1440, 1600 and 1920 px, in the page and in full screen, with nothing scrolled out of the switcher or the bar, the tab bar's short names where the full ones do not fit and the full ones at 1920, each tool's link named by its full name (`aria-label` and `title`); a phone has no Full screen and loads none of it; every locale's web app manifest (Scalita, standalone, the tools hub as its start, the locale as its scope, every icon there at its size, a maskable one) and Chromium finding the tools installable; no service worker anywhere (decision 4) |
| `decode` | the manifest lists every MP3 in `audio/piano-web/` and only those; each decodes in Chromium to 5 s, mono, with its attack within 1 ms of where ffmpeg puts it |
| `range` | the vocal range test on an Android phone, fed two takes through the fake microphone (`range-test/fixtures.json`, `twoTakes`): G2 and G4 lock, the three processing flags are off, no request reaches the server while the tool listens or while any microphone track is live, nothing but GETs of the site's own files all session, nothing on the screen moves from the load to the second lock (at 360, 768 and 900 px: no layout shift, and the page under the stage stays where Start found it, a push the layout shift API forgives in the half second after a tap), the track stops, the result names a voice type, the page's band takes the result's line with the one tagged Play link and the iPhone beside it, the share image saves as a 1080 x 1920 PNG; on the keyboard, C2 to C5 (three octaves) names no single voice type but the three it holds whole, bass to tenor, on the card and in the image, and the wide-range note (decision 6, spec 4.2's amendment), its image saves at 1080 x 1920 too, and a key with the keyboard's focus glows with no outline; an Instagram browser gets the open-in-your-browser panel. The keyboard run needs no takes |
| `tune` | sing this note with a steady A4 against A3 and A4: within 2 cents, five of five within 10, the piano and the microphone never at once (watched from outside the tool), one microphone opening per note, no request while the tool listens or any track is live, nothing sent all session, nothing on the screen moving through the round and its result (at 360, 768 and 900 px, the page under the stage included), one Play link (the band's, tagged) with the iPhone beside it, the share image saved as a 1080 x 1920 PNG |
| `player` | Pre-Performance Quick for the tenor preset on the quick warm-up page plays `routines.json`'s roots step by step; the warm-up piano opens on the five-note scale and plays `scales.json`'s soprano roots; nothing under `/audio/` before Play, piano samples only after |
| `finder` | the voice break finder by its buttons: the climb's keys have no border, the result is the felt note and `voice_type.dart`'s type, kept in this browser, and the warm-up piano is then built around it |
| `locales` | every tool in every other built locale, to its result without a microphone (the keyboard, the listening check, the finder, the piano): nothing stray on it, nothing wider than 360 px, no key with a border, console clean |
| `firefox` | through geckodriver: every English page loads with its tools mounted, no console error, no missing file and nothing wider than the window (headless Firefox will not go under 500 px); the free tuner reads Firefox's fake 1 kHz tone as B5, about 21 cents sharp; the warm-up piano plays the soprano roots; every MP3 decodes (5 s within 60 ms, the attack within 30 ms of ffmpeg's: Firefox 158 keeps LAME's encoder delay, so every attack comes 13 ms late, all by the same amount) |
| `webkit` | through Node and a `playwright-core` whose WebKit is installed: every English page loads at 360 px with its tools mounted, no console error, no missing file, nothing too wide; every MP3 decodes (5 s within 60 ms and the attack within 30 ms: Linux WebKit decodes through GStreamer, which keeps the whole encoder delay, 25 ms, so this proves the files decode, not Safari's timing); the warm-up piano plays Pre-Performance Quick for tenor with the export's roots |

What it needs, and what happens without it:

- Playwright for Python and its Chromium (`python3 -m playwright install
  chromium`). Required.
- The takes, for `range`: Pablo's voice, read in place from
  `../scalita_app/test/detector/takes/` (`SCALITA_TAKES` names another
  folder). Never copy one here. Without them `range` is skipped.
- ffmpeg from `imageio-ffmpeg`, for the attack times of `decode`, `firefox`
  and `webkit`. Without it the lengths and levels are still checked.
- `geckodriver` and Firefox, for `firefox` (the snap's geckodriver works).
  Skipped without them.
- Node and a `playwright-core` whose WebKit build is installed, for
  `webkit`: the one `SCALITA_PLAYWRIGHT_CORE` names, else Playwright for
  Python's own driver once `python3 -m playwright install webkit` has run,
  else one found in `~/projects/*/node_modules` or the npx cache. Skipped
  without one.

The browsers run headless and muted (Chromium `--mute-audio`, Firefox
`media.volume_scale` 0, WebKit through a silent gain), so a run makes no
sound. With every locale built a run takes about ten minutes, most of it
the page sweep and the tools playing at 10 and 25 times their speed
(`data-rate`, set on the mount before the module reads it); `--all` adds
about five.

Requests are judged by the server's own log, on the same clock as the page's events: a worklet's fetch never shows in the page's resource timing, and that is how the capture worklet was once found loading while the first microphone track was already live. Every script a tool loaded, the worklet included, must carry the `?v=` of its page data.

The hooks the suite leans on are the tools' own: the `rangetest`,
`scalita:player` and `scalita:finder` events on the mount, `rangeTest` on the
range test's mount element, `window.__scalitaTest` for the sing-in-tune
test's targets, and `data-rate` on the player and the finder.

## The packages' own suites

Each engine and tool has unit tests in Node and a browser test against a
fixture page. `run.py --all` runs them before its own groups.

```bash
node --test tool/tests/parity/*.test.mjs tool/tests/piano/*.test.mjs tool/tests/scheduler/*.test.mjs \
  tool/tests/player/*.test.mjs tool/tests/range-test/*.test.mjs tool/tests/sing-in-tune/*.test.mjs \
  tool/tests/share/*.test.mjs
python3 -B tool/tests/range-test/e2e.py       # the range test through the fake microphone
python3 -B tool/tests/sing-in-tune/e2e.py     # sing this note, the tuner, the listening check
python3 -B tool/tests/player/smoke.py         # the warm-up piano and the voice break finder
python3 -B tool/tests/piano/smoke_test.py     # piano.js and the web samples
python3 -B tool/tests/piano/samples_test.py   # the MP3s against their FLACs (needs the app repo)
python3 -B tool/tests/parity/fakemic.py       # the listener through the fake microphone
python3 -B tool/tests/share/e2e.py            # both share images in every locale, the references, WebKit
node tool/tests/parity/parity.mjs             # YIN against the app's yin.dart (needs dart)
```

| Folder | README |
|---|---|
| `parity/` | the pitch engine: YIN parity with the app, stability, `mic.js` error codes, size |
| `piano/` | `piano.js`, the ring times, the web samples |
| `scheduler/`, `player/` | the scheduler's ports, the warm-up piano and the voice break finder |
| `range-test/` | the vocal range test |
| `sing-in-tune/` | the sing-in-tune test (its docstring lists the runs) |
| `share/` | the two share images, `share-card.js` and `share-tune.js` |
| `e2e/` | this page's suite |
