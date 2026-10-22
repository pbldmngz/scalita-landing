// Runs the Scalita app's own YIN over WAV files and writes every window's
// reading as one JSON line, for parity.mjs to hold js/audio/yin.js against.
//
//   dart run tool/tests/parity/golden.dart --out <file.jsonl> <take.wav>...
//
// Imports the app's yin.dart by relative path from the sibling checkout
// (scalita_app next to scalita-landing), so the golden is always the code
// that ships in the app. Windows of 2048 samples every 1024, at 44.1 kHz.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../../../../scalita_app/lib/core/audio/yin.dart';

const size = 2048;
const hop = 1024;

/// 16-bit PCM mono samples of a WAV, walking the chunks rather than
/// assuming a 44-byte header.
Float64List readWav(String path) {
  final bytes = File(path).readAsBytesSync();
  final view = ByteData.sublistView(bytes);
  var pos = 12;
  while (pos + 8 <= bytes.length) {
    final id = String.fromCharCodes(bytes.sublist(pos, pos + 4));
    final chunk = view.getUint32(pos + 4, Endian.little);
    if (id == 'fmt ') {
      final channels = view.getUint16(pos + 10, Endian.little);
      final rate = view.getUint32(pos + 12, Endian.little);
      final bits = view.getUint16(pos + 22, Endian.little);
      if (channels != 1 || rate != 44100 || bits != 16) {
        throw StateError('$path: want 44.1 kHz 16-bit mono, got '
            '$rate Hz $bits-bit x$channels');
      }
    } else if (id == 'data') {
      final n = chunk ~/ 2;
      final out = Float64List(n);
      for (var i = 0; i < n; i++) {
        out[i] = view.getInt16(pos + 8 + i * 2, Endian.little) / 32768.0;
      }
      return out;
    }
    pos += 8 + chunk + (chunk.isOdd ? 1 : 0);
  }
  throw StateError('no data chunk in $path');
}

void main(List<String> args) {
  final i = args.indexOf('--out');
  if (i < 0 || i + 1 >= args.length) {
    stderr.writeln('usage: golden.dart --out <file.jsonl> <take.wav>...');
    exit(64);
  }
  final out = File(args[i + 1]).openWrite();
  final paths = [...args.take(i), ...args.skip(i + 2)];
  final yin = Yin(size: size, sampleRate: 44100, threshold: 0.20);
  var windows = 0;
  for (final path in paths) {
    final x = readWav(path);
    final name = path.split('/').last;
    for (var off = 0; off + size <= x.length; off += hop) {
      final r = yin.analyse(x, off);
      windows++;
      out.writeln(jsonEncode({
        'f': name,
        'o': off,
        'hz': r?.frequency,
        'ap': r?.aperiodicity,
        'v': r?.voiced,
      }));
    }
  }
  out.close().then((_) => stderr.writeln('golden: $windows windows'));
}
