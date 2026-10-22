# Warm-up piano, voice break finder and scheduler tests

`js/audio/scheduler.js`, `js/tools/player.js` and `js/tools/voice-break.js`
(`voice-break-finder.js` is its toolId alias) held to the app's own code.

```bash
node --test tool/tests/scheduler/*.test.mjs   # the ports and the sequence, no browser
node --test tool/tests/player/*.test.mjs      # finder matching, saved results, strings, size
python3 tool/tests/player/smoke.py            # both tools in headless Chromium (--webkit adds WebKit)
```

| File | What it holds |
|---|---|
| `../scheduler/scheduler.test.mjs` | `transpositionRoots()` on all 200 `transposition_vectors.json` cases; `resolveStepRange` and the single scale sweep on all 300 `step_range_vectors.json` custom ranges; every routine and scale preset recomputed for all six voice types; the ported estimator giving each preset's `durationMs` and `minutes` exactly; the sequence (count-in, first key without its chord, current and next chords to 160 bpm, fades, repeats, rests, minor cues, the 3 s pause); `play()` scheduling ahead, stopping, sliding after a stalled timer |
| `player.test.mjs` | the finder's voice type on hand-worked cases from `voice_type.dart` and every `closestForPrimoAndGender` vector; its start note; what the player accepts from localStorage; every string key and placeholder the scripts use; no em dash or verdict; under 15 KB gzipped before the first tap |
| `smoke.py` | fixture pages built in memory from `tool/build.py --page-data` (no template needed, nothing written): nothing under `/audio/` before the first tap; Tab and Enter drive the player; Pre-Performance Quick for the tenor preset plays the exact `routines.json` roots; a custom range plays a vector's roots; Stop; the chooser; the finder by keyboard, its result and what it keeps; a clean console |

Each player event also reaches its mount as a `scalita:player` CustomEvent
(`scalita:finder` for the finder), and `data-rate="25"` on a mount plays 25
times faster: the smoke test uses both.
