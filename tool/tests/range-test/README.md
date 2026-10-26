# Vocal range test

`js/tools/vocal-range-test.js` (the entry: the mount, idle, in-app and error
panes, `mic.js` only before a tap) and `js/tools/vocal-range-run.js` (loaded on
the first tap: the session, the listening view, the picker, the result). The
share image, `js/tools/share-card.js`, has its own suite in `../share/`.

```bash
node --test tool/tests/range-test/*.test.mjs   # logic, strings, budget; the fake-mic input at every window phase
python3 -B tool/tests/range-test/e2e.py         # the tool in headless Chromium through the fake microphone
```

| File | What it holds |
|---|---|
| `range.test.mjs` | the voice-type match against `voice_type_vectors.json`, a type named only for 12 to 35 semitones (`VoiceType.rangeNamesAType`) and the voice types a range of three octaves holds whole, as the app's picture counts them, the two phases over the app's lock (timing, the highest above the lowest, fry and whistle tallied and hinted, the hold-steady hint), every string the code names present in `ui/en/vocal-range-test.json` and none unused, the entry's static imports (`mic.js`, the run module on the tap) and the 15 KB budget, no dashes. With the takes present, each `fixtures.json` input through the real pitch reader at 16 window phases, 44.1 and 48 kHz |
| `e2e.py` | six runs, listed at its top: two takes on an Android phone, sine tones on a computer, an in-app browser, every error code, the keyboard-only path, the weight before a tap |
| `fixture.html` | the page the browser test serves at `/tools/vocal-range-test/`, filled with `tool/build.py --page-data` and the import map a built page has |
| `fixtures.json` | the fake-mic inputs as segments of takes, tones and silence, and the notes each must lock |

The takes are Pablo's voice. They stay in `scalita_app/test/detector/takes/`
and are read in place (`SCALITA_TAKES` overrides the folder); never copy one
here, because everything in this repo is publicly served. Composed WAVs go to
`SCALITA_SCRATCH`, else the system temp folder. Without the takes the
two-takes runs are skipped; the tones run needs nothing.

Of the 29 takes only three lock a note on the app's rules, and only
`18-50-13` (G4) locks at every window phase. The held G2 of `17-46-22` locks
at some phases only, so the input sings it four times with gaps that move it
a quarter window each time; `range.test.mjs` proves the pair locks G2 then G4
at all 32 phase and rate combinations before the browser ever runs it.

What the browser test leans on: each change of state fires `rangetest` on the
mount element with `{state, phase, low, high, micOn}`, and the element carries
`rangeTest` (`state`, `phase`, `settings`, `micOn`, `micLive()`, `start()`,
`stop()`). `mount(el, pageData, {createListener})` takes a stand-in listener,
which is how every error code is shown without a real failure.
