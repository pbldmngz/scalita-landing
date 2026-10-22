# tool/data/

`app/` holds the app's own data, exported from the Flutter repo so the site
never types a note name, a routine or a translation by hand. `build.py` reads
it and inlines what each page needs as `<script type="application/json"
id="page-data">`. Every file in `app/` is generated: do not edit it, rerun the
export.

## The command

```bash
# from this repo's root, with scalita_app checked out next to it
(cd ../scalita_app && flutter test test/web_export_test.dart --dart-define=SCALITA_WEB_EXPORT="$PWD/../scalita-landing/tool/data/app")
```

The export is a Flutter test (`scalita_app/test/web_export_test.dart`, helpers
in `test/web_export/`) because the data lives in Dart: it calls the app's own
functions (`MusicTheory`, `LocalizationHelper`, `SyllableDescriptions`,
`resolveStepRange`, `transpositionRoots`, `estimateRoutineDuration`,
`AppLocalizations` for each language) and copies nothing by hand. Without the
`--dart-define` it is skipped, so `flutter test` on the whole app never writes
here.

It checks before it writes: 88 keys per locale, middle C as the app writes it,
every localized value present and non-empty in all seven locales, the same key
set in every locale of `strings.json`, no em dash anywhere, the hand-written
Find My Warmup and onboarding mappings still matching the app's source, and
the piano files matching their sha256. A failed check writes nothing.

Rerun it after any app change to scales, routines, syllables, cues, voice
types, notation rules or ARB strings, and commit the result with the site.

## Format

- Keys sorted at every level, two-space indentation, UTF-8 (no `\u` escapes),
  a final newline. A rerun on the same app data writes the same bytes. Each
  file equals `json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False)
  + "\n"` in Python, so a check can tell a hand edit from an export.
- Locale keys are the site's codes: `en es fr pt de tr id`. `pt` is the app's
  `pt_BR`, built from `app_pt.arb`. `meta.json` lists the mapping.
- `{loc}` below means an object with exactly those seven keys.
- Pitches are MIDI numbers: 21 is A0, 60 middle C, 69 A440, 108 C8.
- Intervals are semitones from a pattern's first note; `-1000` is a rest
  (`Scale.restInterval`).
- `null` is written out, never left out: every entry of a list has the same
  keys.

## Files

### notes.json

Note names, from `MusicTheory`. Top level:

- `<loc>`: the 88 keys, A0 to C8, `[{midi, name, intl}]`. `name` is the
  locale's default notation and octave style, `intl` the scientific letter
  name (sharps as `#`). Middle C: en `C4`, es `Do4`, fr `Do3`, pt `Dó3`, de
  `c¹`, tr `Do4`, id `C4`. Pair them as the pages do: `Do3 (C4)`.
- `locales.<loc>`: `appLanguage`, `notation` (default), `octaveStyle`,
  `solfegeOctaveStyle`, `pitchLetters`, `fixedDo`, `notationOrder` (the
  pickers' order, default first), `movableNames` (do re mi as sung in that
  language), `middleC`, `a440`.
- `systems.<letter|solfege|germanLetter|numbers>`: `relative` (true only for
  numbers), `sharp` and `flat` (the twelve table spellings, unaccented, null
  for numbers), `degrees` (`1` to `7`, numbers only), and per locale: `label`,
  `example`, `regions` (the notation picker's own texts), `octaveStyle`,
  `pitchClasses` (twelve names from C, the language's accents), `keyNames`
  (what a key label calls each do, `do = Bb`), `names` (all 88 keys in that
  notation). Numbers name no pitch, so its `names` and `keyNames` are the
  letters the language names a pitch with: German letters in German, English
  letters elsewhere.
- `octaveStyles.<scientific|francoBelgian|helmholtz>`: `labels` (scientific
  octave `0` to `8` as that style writes it; Helmholtz writes the octave's C,
  `c¹`), `middleC`, `a440`, `lowest`, `highest`, and `usedBy`
  (`[{locale, notation}]`, every pair that writes it).

### voice_types.json

Six entries, `VoiceType` order: `{id, rangeLow, rangeHigh, presetId,
presetLow, presetHigh, primo, secondo, isMaleVoice, names: {loc}}`.
`rangeLow/rangeHigh` is the type's typical range, what the range test's
"typical for" line compares against (`VoiceType.closestForRange`, midpoints).
`presetLow/presetHigh` is the range onboarding gives a singer who picks the
type (`VocalRangePresets`); every preset below is played on it. They differ
for bass: typical F2 to F4 (41 to 65), preset E2 to E4 (40 to 64).
`isMaleVoice` is the app's own field for the break finder's question; the
site words that question as lower voice and higher voice.

### registers.json

Three entries: `{id, low, high, floor, ceiling, minSpan, names: {loc},
descriptions: {loc}, routinesUsing}`. `low/high` is the default span
(subharmonic A1 to F2, flageolet G5 to E6, whistle F6 to C7), what the app
offers first and what a register step resolves to while no span is declared.

### scales.json

The 21 built-in scales a singer browses (the nine Listen & Repeat figures are
left out), app order: `{id, hash, intervals, beats, naturalDirection,
noteCount, span, depth, names: {loc}, movableDo, routinesUsing, stepsUsing,
presets}`.

- `span`: semitones from the lowest note to the highest; `depth`: how far the
  pattern goes under its first note (0 for all 21).
- `movableDo`: `MusicTheory.readMovableDo` on the pattern: `doOffset`,
  `minor`, and `degrees`, one per interval as written (null for a rest),
  `{number, accidental, octave, numeral}`. `octave` counts dots: 1 above, -1
  below.
- `presets.<voiceTypeId>`: what the single scale player plays for that
  preset: `{startMidi, endMidi, comfortMidi, semitoneStep, span, depth, tempo,
  direction, roots}`. `roots` are the keys in playback order, comfort first,
  as the engine plays them; the pattern runs once on each.

### routines.json

The 15 built-in routines, app order: `{id, hash, isRegisterRoutine, names:
{loc}, descriptions: {loc}, setupCues: {loc: [{id, label, description}]},
steps, presets}`. Names and descriptions are the ARB texts the app shows.

- `steps[]`: `{scaleId, syllable, syllableByLocale: {loc}, tips: {loc},
  trill, tempo, style, direction, repeatCount, span, useVocalRange,
  semitoneStep, register, anchorHigh, passaggioIntent, badges: [{id,
  intensity, labels: {loc}}]}`. `syllable` is the stored key; show
  `syllableByLocale`. `tips` is the app's tip for that syllable (null where it
  has none). `trill` is `tongue`, `lip` or null. `span` is the step's own
  window in semitones, null when it sweeps the singer's whole range or, for a
  register step, the whole register span. `semitoneStep` null means the
  singer's setting. `style`: `struck|normal|smooth`; `direction`:
  `normal` (up), `inverted` (down), `mirror` (up then down); names for both
  are in `strings.json`.
- `presets.<voiceTypeId>`: `{roots, durationMs, minutes}`. `roots` has one
  list per step, the keys in playback order; each key plays the step's
  pattern `repeatCount` times. `durationMs` is `estimateRoutineDuration` in
  whole seconds times 1000, and `minutes` what the app's cards show
  (`estimateRoutineMinutes`), both with the arguments the routine screen
  passes. Register routines resolve on the default spans, as the app does
  before a span is declared.

### syllables.json

The 54 sounds the app has a tip for, app order: `{id, trill,
pitchCompatible, doReMi, tips: {loc}, respellings: {loc}, usage: {steps,
routines}}`. `respellings` are `SyllableDescriptions.localize`, `tips`
`SyllableDescriptions.describe`. The two trill keys from before v30, `Brrr`
and `Lip Trill`, are left out: no built-in routine uses them. `usage` counts
built-in steps whose stored syllable is exactly this one.

The trill rule, as the routines carry it: a routine's first trill is the
tongue trill `Trr`, every later one the lip trill `Prr`; Gentle / Recovery
uses the lip trill both times. Count it from `steps[].trill`.

### intake.json

Find My Warmup (`intake_flow_sheet.dart`): `title`, `subtitle`,
`blockedMessage` (all `{loc}`), `feelings` and `goals`, each `{label: {loc},
options: [...]}`, and `results`.

- `feelings.options[]`: `{id, label, description, tempoMultiplier,
  routineId}`. Only `tired` has a routine: it skips the second question and
  opens Gentle / Recovery.
- `goals.options[]`: `{id, label, description, routineId, appOnly,
  blockedWhen}`. `dynamic` is Adaptive Mode, app only. `blockedWhen: ["off"]`
  means the app refuses that goal to a voice that feels a bit off and shows
  `blockedMessage`.
- `results.<feeling>.<goal>`: `{routineId, tempoMultiplier, blocked}` for the
  seven goals with a routine.

### strings.json

Per locale, app strings the pages reuse, keyed by ARB key so translators can
find them: `range` (range test texts and its hedges), `numbers` (`octave`,
`octaves`, `decimalSeparator`), `breakFinder`, `listenFor` (the three signs
of the passaggio), `passaggioIntents.<id>.{name, description}`,
`styles.<id>.{name, description}`, `directions` (`label`, `up`, `down`, and
one per direction id), `step` (`tempo`, `bpm`, `repeatCount`),
`badges.<id>.{label, description}` (all 21 cues), `registers`. Placeholders
stay as `{name}`, the ARB's own names: `rangeTypicalFor` has `{voiceType}`,
`rangeTypicalForTwo` `{voiceType1}` and `{voiceType2}`, `rangeOctaves`
`{octaves}`, `youFeltSomethingAround` `{note}`, `matchesVoiceType`
`{voiceType}`. Write octave counts with `numbers.decimalSeparator`.

### transposition_vectors.json

200 seeded cases of `transpositionRoots()`
(`lib/core/audio/transposition_plan.dart`): `[{input: {startMidi, endMidi,
maxInterval, semitoneStep, comfortMidi, returnToComfort, settleFromMidi,
depth}, roots}]`. The port in `js/audio/scheduler.js` must match every case
exactly. The set covers the comfort anchor (inside, below and above the usable
roots), the closing leg, the settle, depth, the one-root fallback and the
empty result near the top of the piano.

### step_range_vectors.json

300 cases of what plays for a range a singer types in, for the custom-range
path of the player: one for every step of every routine, one for every scale,
then seeded random ones. `[{input: {kind, routineId, stepIndex, scaleId,
rangeLow, rangeHigh, primo, secondo}, range, tempo, direction, repeatCount,
roots}]`. `kind` is `routineStep` or `scale` (`routineId` and `stepIndex`
null for a scale). `range` is the resolved sweep: `{startMidi, endMidi,
semitoneStep, comfortMidi, span, depth, returnToComfort, settleFromMidi}`
(a scale never returns or settles). Steps go through
`resolveStepRange` (comfort note, span windows, passaggio intents, register
seams), scales through the single scale player's comfort note, both through
`buildStepPlan`. Settings are the app's defaults around the range; `primo`
and `secondo` are null in half the cases. A passaggio intent sweeps from the
voice break even outside the typed range, as the app does.

### voice_type_vectors.json

The app's matchers over every input that can give a different answer:
`closestForRange` (`[{low, high, types}]`, one or two types; it reads only
the midpoint, so one pair per half semitone covers it, ties included),
`closestForPrimoAndGender` (`[{primo, isMaleVoice, type}]`) and
`closestForPrimo` (`[{primo, type}]`), primo from C2 to C6.

### piano_source.json

The twenty FLACs the web piano is rendered from: the recorded pitches (no
shift) from A1 to F#6, MIDI 33 to 90 in steps of three. `{about, channel,
sampleRate, notes: [{midi, file, asset, sha256, bytes, frames, onsetFrame,
source, velocity, shift, speedRatio, correctionCents, f0Cents, yinCents,
peakDb, loudnessDb, gainDb, cutDb}]}`. `sha256` is the file's own, checked
against `test/fixtures/piano/manifest.json`, which explains every field.

### meta.json

`appVersion`, `locales` (`[{site, app, arb, endonym}]`), `settings` (the app
defaults every preset and vector assumes), `constants` (`midiMin`,
`midiMax`, `a4Midi`, `a4Frequency`, `restInterval`, `maxCurrentCueBpm`, the
passaggio search windows), `seeds`, and `files.<name>.{sha256, bytes}`.

## Hashes

`routines[].hash` and `scales[].hash` are what a page's `writtenAgainst`
records, so `check.py` can warn when the app changes under a page. Each is
the sha256, in hex, of compact canonical JSON (sorted keys, no whitespace,
UTF-8) of:

- a scale: `{id, intervals, naturalDirection, beats}`;
- a routine: `{id, steps, setupCues, scales}`, where `steps` is each
  `RoutineStep.toJson()`, `setupCues` the standing cue ids, and `scales` maps
  every scale id the routine uses to its scale hash input.

No localized text goes in, so a translation fix does not move a hash; a
changed step, cue, tempo or pattern does.
