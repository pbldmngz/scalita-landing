"""Checks the web piano's MP3s against their manifest, their tags and the app's FLACs.

  python3 -B tool/tests/piano/samples_test.py    or
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider tool/tests/piano/samples_test.py

Needs ffmpeg (imageio-ffmpeg). The checks against the FLACs, and the fresh
render that must match the shipped bytes, need the app checkout
(SCALITA_APP, default the scalita_app checkout next to this repo) and skip
without it.
"""

import hashlib
import importlib.util
import json
import os
import struct
import sys
import tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parents[3]
WEB = SITE / "audio" / "piano-web"
APP_PIANO = Path(os.environ.get("SCALITA_APP", SITE.parent / "scalita_app")) / "assets" / "audio" / "piano"
CHORD = ["60_C4.mp3", "64_E4.mp3", "67_G4.mp3"]
BUDGET = 700_000

sys.dont_write_bytecode = True  # everything in this repo is served: leave no __pycache__
spec = importlib.util.spec_from_file_location("render_web_piano", SITE / "tool" / "render_web_piano.py")
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
FFMPEG = render.find_ffmpeg()
MANIFEST = json.loads((WEB / "manifest.json").read_text())


class Skip(Exception):
    pass


def need_app():
    if not APP_PIANO.is_dir():
        try:
            import pytest
            pytest.skip("no app checkout at %s" % APP_PIANO)
        except ImportError:
            raise Skip("no app checkout")


def id3_frames(data):
    assert data[:3] == b"ID3", "no ID3v2 tag"
    assert data[3] == 3, "ID3v2.%d, not 2.3" % data[3]
    size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
    frames, i = {}, 10
    while i + 10 <= 10 + size and data[i:i + 4] != b"\x00\x00\x00\x00":
        fid = data[i:i + 4].decode("ascii")
        (length,) = struct.unpack(">I", data[i + 4:i + 8])
        frames[fid] = data[i + 10:i + 10 + length]
        i += 10 + length
    return frames


def check_tag(path, midi):
    f = id3_frames(path.read_bytes())
    assert f["TIT2"] == b"\x00Piano " + render.intl_name(midi).encode(), path.name
    assert f["TPE1"] == b"\x00Alexander Holm", path.name
    assert f["COMM"] == b"\x00eng\x00" + render.COMMENT.encode(), path.name


def test_set_and_budget():
    midis = [n["midi"] for n in MANIFEST["notes"]]
    assert midis == list(range(33, 91, 3)), midis
    total = 0
    for n in MANIFEST["notes"]:
        path = WEB / n["file"]
        assert n["file"] == render.app_name(n["midi"]) + ".mp3"
        data = path.read_bytes()
        assert len(data) == n["bytes"], n["file"]
        assert hashlib.sha256(data).hexdigest() == n["sha256"], n["file"]
        total += len(data)
    assert total < BUDGET, "%d bytes" % total
    assert sorted(p.name for p in WEB.glob("*.mp3")) == sorted(n["file"] for n in MANIFEST["notes"])


def test_tags():
    for n in MANIFEST["notes"]:
        check_tag(WEB / n["file"], n["midi"])
    for name in CHORD:
        check_tag(SITE / "audio" / name, int(name.split("_")[0]))


def test_gapless_length():
    for n in MANIFEST["notes"]:
        got = render.decode(FFMPEG, WEB / n["file"])
        assert len(got) == round(n["duration"] * render.RATE) == render.CUT_SAMPLES, n["file"]
    for name in CHORD:
        assert len(render.decode(FFMPEG, SITE / "audio" / name)) == render.CUT_SAMPLES, name


def test_sources_and_onsets():
    need_app()
    for n in MANIFEST["notes"]:
        src = APP_PIANO / (render.app_name(n["midi"]) + ".flac")
        assert render.sha256(src) == n["sourceSha256"], "%s is not the FLAC it was made from" % n["file"]
        ref = render.decode(FFMPEG, src, limit=render.CUT_SAMPLES)
        got = render.decode(FFMPEG, WEB / n["file"])
        drift = render.onset(got) - render.onset(ref)
        assert abs(drift) <= render.ONSET_TOLERANCE, "%s onset %+d samples" % (n["file"], drift)


def test_render_is_reproducible():
    need_app()
    with tempfile.TemporaryDirectory() as tmp:
        out, chord = Path(tmp) / "web", Path(tmp) / "chord"
        argv = sys.argv
        sys.argv = ["render_web_piano.py", str(APP_PIANO), str(out), "--chord-out", str(chord)]
        try:
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):
                render.main()
        finally:
            sys.argv = argv
        for p in sorted(out.iterdir()):
            assert p.read_bytes() == (WEB / p.name).read_bytes(), "%s differs from a fresh render" % p.name
        for name in CHORD:
            assert (chord / name).read_bytes() == (SITE / "audio" / name).read_bytes(), name


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Skip as e:
                print("skip", name, e)
            except AssertionError as e:
                failed += 1
                print("FAIL", name, e)
    sys.exit(1 if failed else 0)
