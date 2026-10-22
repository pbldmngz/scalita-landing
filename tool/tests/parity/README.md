# Pitch engine tests

`js/audio/yin.js`, `pitch.js`, `mic.js`, `capture.worklet.js` and `listener.js`
held to the app's own pitch code.

```bash
node --test tool/tests/parity/*.test.mjs    # rules, error codes, hints, worklet, size (no audio files needed)
node tool/tests/parity/parity.mjs           # YIN against the app's yin.dart on every take (needs dart)
python3 tool/tests/parity/fakemic.py        # the listener in headless Chromium, fed a take through the fake mic
```

| File | What it holds |
|---|---|
| `golden.dart` | runs the app's `lib/core/audio/yin.dart`, imported by relative path from `../scalita_app`, over the takes |
| `parity.mjs` | 0 voiced or unvoiced mismatches and under 1e-6 cents on every window of every take |
| `stability.test.mjs` | the 0.04 gate, the accept window, stability (steady, glide, octave slip), fry and whistle flags, the 600 ms lock |
| `mic.test.mjs` | every error code and hint through a fake browser, the order of the Start tap, the worklet's hops and channel pick, `mic.json` covering every code |
| `budget.test.mjs` | the five files under 12 KB gzipped, no em dashes |
| `fakemic.py` | processing flags off, the locked notes and note runs of one take, nothing fetched while listening |
| `fixtures.json` | the take list and the fake-mic expectations |

The takes are Pablo's voice. They stay in `scalita_app/test/detector/takes/`
and are read in place (`SCALITA_TAKES` overrides the folder); never copy one
here, because everything in this repo is publicly served. The golden and the
padded take go to `SCALITA_SCRATCH`, or the system temp folder.

On the app's rules a note locks only after it has been held steadily for
about a second (ten readings to become stable after a break, then 600 ms),
so the moving scales in the takes lock rarely: of the 29, only
`16-03-35`, `17-46-22` and `18-50-13` lock anything. The fake-mic test uses
`18-50-13`, whose lock and note runs hold at every window phase.
