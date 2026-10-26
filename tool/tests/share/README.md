# Share images

`js/tools/share-card.js` (the vocal range image, and the save and share
helpers) and `js/tools/share-tune.js` (the sing-in-tune image). Both draw on
a 1080 x 1920 canvas on the reader's device, in Sora, to section 4 of the site
redesign spec and its mockups (`SH3-range-b-strong`, `SH3-range-b-modest`,
`SH4-range-b-wide`, `SH-B-tune-strong`, `SH-B-tune-modest`).

```bash
node --test tool/tests/share/*.test.mjs        # API, imports, no words, no dashes, helpers, weight
python3 -B tool/tests/share/e2e.py              # every case in every locale, the references, WebKit
python3 -B tool/tests/share/e2e.py --update     # draw the references again, then look at them once
```

| File | What it holds |
|---|---|
| `share.test.mjs` | the exports the tools call, share-tune.js importing only share-card.js, no word and no dash in either module, `resample`, `clamp`, `num` and `day` without a canvas, the weight |
| `e2e.py` | serves `js/`, `fonts/` and this folder, draws each case of `cases.json` in headless Chromium in all seven locales, with each locale's strings and with the English copy 40% longer in each locale's notes, numbers and dates, and judges each drawing; compares the reference cases, drawn with the strings frozen in `cases.json`, to their PNGs; draws without `ctx.filter`; drives WebKit through `webkit.mjs` |
| `fixture.html`, `fixture.mjs` | the page: builds a case's data from a locale's page data the way the tools do, draws it with the real modules, records every text, fill and stroke, and judges the record |
| `webkit.mjs` | the WebKit part, through Node and a playwright-core whose WebKit is installed |
| `cases.json` | the cases; the contours are the mockups' own lines read back as cents, design data and nobody's voice; the English strings the references are drawn with, frozen, so a translation landing never moves a reference |

The judge fails a drawing with any text outside the frame, on another text,
on a key, on a voice's line or on a landing, any text squeezed, or any
placeholder left. The reference PNGs are about 1.5 MB each, so they live in
`SCALITA_SCRATCH/share` (else the temp folder), never here: a missing one is
drawn and kept, and should be looked at once. On one machine the drawing is
the same every time, so the comparison is tight enough to notice one word.

## The data

`drawRangeCard(canvas, data)`, as `js/tools/vocal-range-run.js` builds it:

```js
{
  lang, low, high,                            // MIDI
  names: {low: {local, intl}, high: {local, intl}, a4},   // a4: MIDI 69's local name
  labels: {48: 'C3', 60: 'C4'},               // the Cs of the range, local names
  hz: {low, high}, date: 'YYYY-MM-DD',
  semitones, octaves,                          // numbers
  bracket: {big, small} | null,                // what the whole range holds, beside the roll
  trails: {low, high},                         // cents over the hold's last 1.5 s, or null
  text: {kicker, ref, semitones, octaves, caption, ask, site, hz},
}
```

`drawTuneCard(canvas, data)`, as `js/tools/sing-in-tune.js` builds it:

```js
{
  lang, date, off, judged, total, inTune, close, wobble,
  notes: [{name, cents: number | null, path: number[] | null}],   // five, in order
  text: {title, cents, typical, line2, bandClose, bandIn, theNote, lines, ask, site},
}
```

The bracket follows the main thread's amendment at the top of spec 4.2
(Pablo's final range image, 2026-10-26, the app's `RangeShareCard`): no type
line above the roll, and one bracket over the whole range, from the high
note's row to the low note's. From 12 to 35 semitones its large line is the
voice type or the two the result card names (`typeOr`) over `typical`; from
36, the voice types whose ranges lie wholly inside (`allTypes`, `typesOne`,
`typesMany` over `typesSpan` or `oneTypeWhole`, or `beyondOneType` over the
range). Under 12 the image draws none, whatever comes in.

Each resolves with the canvas. Every word arrives in `text`; the modules
format only numbers and the date (`Intl`, day first in English as the site
writes dates). A line is drawn only from a real recording: a note without
one gets its landing alone, and the range image's caption, which says the
lines are the singer's voice, shows only when both are.

## Where the drawing reads the spec more closely than its letter

The mockups and the eleven decisions outrank the spec's own inferences, and
a few of those inferences would have broken a case:

- **The two notes' fit.** The spec kept 300 px between them, which shrinks
  the mockup's own A2 to C5 to 212 px. The room is the count's real width,
  or its bracket's 204, plus 15 clear on each side; the mockup comes out at
  its 236 px. When even 150 px leaves no room, the count moves under the
  notes onto the international names' row, centred between them (the spec's
  536 and 566 would put the international names on the octave count).
- **The international names** sit under the notes' ink, never less than 40
  below the baseline (530 at full size): a German `g²` has a descender.
- **Blur** is always the shadow of a copy drawn off the canvas, the same
  Gaussian as the mockups' `feGaussianBlur` in Chromium and WebKit alike.
  `ctx.filter`, which the spec named, is missing in Safari before 18, where
  the spec's fallback would have drawn hard lines.
- **A landing** is the line's last point, as the mockups draw it (the row's
  centre without a line), and the Hz labels follow it.
- **Key labels** centre on the C's head, as in the mockups, and a solfege
  name a size or two too wide comes down to fit it.
- **The bracket's large line** comes down 2 px at a time to 30 to fit 640,
  as the app's does, and past that a pixel at a time rather than squeeze;
  the caption is one line at 24 to 20 px, else two at 20 to 16.
- **The reference pitch** is in capitals except its note, whose case is
  meaningful in German.
- **The tune image's glow** is the taller one, centred at y 1070, when any
  line (not only a landing) goes under y 1200, as `SH-B-tune-modest` has it.
- **Tabular figures** have no canvas setting; the Hz labels use Sora's own.
- **Weight.** The spec estimated 4 KB gzipped for each module. share-tune.js
  is about 2.4 KB; share-card.js about 7.5 KB, of which some 5.7 KB is code
  (the roll, its fitting, and the text and blur helpers both images share),
  so no trimming of comments brings it to 4 KB. Both load only after a
  result, never before a tap; `share.test.mjs` holds them where they are.
