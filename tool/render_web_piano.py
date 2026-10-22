#!/usr/bin/env python3
"""Render the web piano: twenty MP3s cut from the app's retuned piano samples.

  python3 tool/render_web_piano.py APP_PIANO_DIR OUT_DIR [--chord-out DIR]

For this repo:

  python3 tool/render_web_piano.py \\
      ../scalita_app/assets/audio/piano audio/piano-web \\
      --chord-out audio

WHAT IT DOES

Notes. Salamander records A, C, D# and F#, so the app's chromatic set is
made from those 30 pitches, each note at most one semitone from its
recording. The web set takes the recorded ones in the singing span: MIDI 33
(A1) to 90 (F#6), every third semitone, twenty files. js/audio/piano.js
plays the notes between with playbackRate 2^(n/12), one semitone at most,
the same shift the app's own render makes. That covers MIDI 32 to 91.

Cut. The app's files run up to 10 s. Here each is cut to 5 s with a 0.4 s
linear fade at the end (4.6 to 5.0 s), sample exact. The sources start on
the attack and are already level matched and tuned to the fundamental
(scalita_app/test/fixtures/piano/manifest.json), so nothing else changes:
no gain, no resampling, no trim at the start.

Encoding. MP3, LAME VBR -V4 (ffmpeg -q:a 4), mono, 44.1 kHz, through the
imageio-ffmpeg binary. The encoder delay is recorded in the LAME header,
which decoders read to drop it again; the run checks that the decoded file
is exactly 5 s long and starts where the FLAC does. Output is deterministic:
same sources and same ffmpeg, same bytes.

Credit. Salamander Grand Piano V3 is CC BY 3.0, by Alexander Holm. Each
file carries an ID3v2.3 tag written here (ffmpeg can only write a comment as
a TXXX frame): TIT2 title, TPE1 "Alexander Holm", and a COMM frame naming
the work, the licence and the changes.

Manifest. OUT_DIR/manifest.json lists every note: midi, file, bytes,
sha256, sourceSha256 (the FLAC it came from) and duration in seconds.

--chord-out also writes the home page's chord, 60_C4.mp3, 64_E4.mp3 and
67_G4.mp3, the same way (those three are not in the manifest).
"""

import argparse
import array
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

NOTES = list(range(33, 91, 3))  # A1, C2, D#2, F#2 ... F#6: recorded pitches only
CHORD = (60, 64, 67)
RATE = 44100
CUT_SAMPLES = 5 * RATE  # 5 s
FADE_SAMPLES = int(0.4 * RATE)  # 0.4 s
VBR_QUALITY = 4  # LAME -V4
ARTIST = "Alexander Holm"
COMMENT = ("Salamander Grand Piano V3, CC BY 3.0, retuned, shortened and "
           "compressed for scalita.com")
CREDIT = "Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/"

# The app's file names (MusicTheory.midiToFilename): 's' for sharp, MIDI not padded.
APP_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
INTL_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

ONSET_THRESHOLD = 0.01  # first sample over -40 dBFS
ONSET_TOLERANCE = 44  # samples, 1 ms


def app_name(midi):
    return "%d_%s%d" % (midi, APP_NAMES[midi % 12], midi // 12 - 1)


def intl_name(midi):
    return "%s%d" % (INTL_NAMES[midi % 12], midi // 12 - 1)


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        exe = shutil.which("ffmpeg")
        if not exe:
            sys.exit("needs ffmpeg with libmp3lame: pip install imageio-ffmpeg")
        return exe


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def decode(ffmpeg, path, limit=None):
    """Mono float samples at 44.1 kHz, as the decoder hands them out."""
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(RATE)]
    if limit:
        cmd += ["-af", "atrim=end_sample=%d" % limit]
    out = subprocess.run(cmd + ["-"], check=True, capture_output=True).stdout
    samples = array.array("f")
    samples.frombytes(out)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def onset(samples):
    for i, x in enumerate(samples):
        if abs(x) > ONSET_THRESHOLD:
            return i
    return -1


def encode(ffmpeg, src):
    """The MP3 stream with no tag: cut, faded, LAME -V4 mono."""
    filters = []
    frames = len(decode(ffmpeg, src))
    if frames > CUT_SAMPLES:
        filters = ["atrim=end_sample=%d" % CUT_SAMPLES,
                   "afade=t=out:start_sample=%d:nb_samples=%d"
                   % (CUT_SAMPLES - FADE_SAMPLES, FADE_SAMPLES)]
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", str(src), "-map_metadata", "-1"]
    if filters:
        cmd += ["-af", ",".join(filters)]
    # To a seekable file, not a pipe: ffmpeg writes the LAME header, which
    # holds the encoder delay and padding, last, by seeking back to it.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "stream.mp3"
        cmd += ["-ac", "1", "-ar", str(RATE), "-c:a", "libmp3lame",
                "-q:a", str(VBR_QUALITY), "-id3v2_version", "0", "-write_id3v1", "0",
                "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "mp3", str(out)]
        subprocess.run(cmd, check=True, capture_output=True)
        return out.read_bytes(), min(frames, CUT_SAMPLES)


def id3_frame(frame_id, payload):
    return frame_id.encode("ascii") + struct.pack(">IH", len(payload), 0) + payload


def id3_tag(title):
    """ID3v2.3, ISO-8859-1 text (every string here is ASCII)."""
    frames = (
        id3_frame("TIT2", b"\x00" + title.encode("latin-1"))
        + id3_frame("TPE1", b"\x00" + ARTIST.encode("latin-1"))
        + id3_frame("COMM", b"\x00" + b"eng" + b"\x00" + COMMENT.encode("latin-1"))
    )
    size = len(frames)
    synchsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + synchsafe + frames


def render(ffmpeg, midi, src, dst):
    stream, frames = encode(ffmpeg, src)
    dst.write_bytes(id3_tag("Piano " + intl_name(midi)) + stream)
    got = decode(ffmpeg, dst)
    ref = decode(ffmpeg, src, limit=CUT_SAMPLES)
    problems = []
    if len(got) != frames:
        problems.append("decodes to %d samples, not %d" % (len(got), frames))
    if abs(onset(got) - onset(ref)) > ONSET_TOLERANCE:
        problems.append("onset at sample %d, the FLAC's at %d" % (onset(got), onset(ref)))
    return len(got), onset(got) - onset(ref), problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("app_piano_dir", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--chord-out", type=Path, help="also write 60_C4, 64_E4, 67_G4 here")
    args = ap.parse_args()

    ffmpeg = find_ffmpeg()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    failed = []
    entries = []

    def one(midi, out_dir):
        src = args.app_piano_dir / (app_name(midi) + ".flac")
        if not src.is_file():
            sys.exit("missing source: %s" % src)
        dst = out_dir / (app_name(midi) + ".mp3")
        frames, drift, problems = render(ffmpeg, midi, src, dst)
        size = dst.stat().st_size
        print("%-12s %7d bytes  %.4f s  onset %+d samples%s"
              % (dst.name, size, frames / RATE, drift, "  " + "; ".join(problems) if problems else ""))
        failed.extend("%s: %s" % (dst.name, p) for p in problems)
        return src, dst, size, frames

    for midi in NOTES:
        src, dst, size, frames = one(midi, args.out_dir)
        entries.append({
            "midi": midi,
            "file": dst.name,
            "bytes": size,
            "sha256": sha256(dst),
            "sourceSha256": sha256(src),
            "duration": round(frames / RATE, 4),
        })
    total = sum(e["bytes"] for e in entries)
    print("%d notes, %d bytes" % (len(entries), total))

    manifest = {
        "credit": CREDIT,
        "license": LICENSE_URL,
        "encoding": "MP3 LAME -V%d, mono, %d Hz, cut to 5 s with a 0.4 s fade" % (VBR_QUALITY, RATE),
        "maxShift": 1,
        "notes": entries,
    }
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    if args.chord_out:
        args.chord_out.mkdir(parents=True, exist_ok=True)
        for midi in CHORD:
            one(midi, args.chord_out)

    if failed:
        sys.exit("FAILED:\n  " + "\n  ".join(failed))


if __name__ == "__main__":
    main()
