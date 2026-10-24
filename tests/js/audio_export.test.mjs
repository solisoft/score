// The sound to files (public/eui-score/audio-export.js): a store-only zip
// any unzip reads, CRC-32, the MP3 encoder fed in frames, and the stems —
// each staff alone, the mixer put back after.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as X from "../../public/eui-score/audio-export.js";

const bytesOf = (text) => new TextEncoder().encode(text);

/** A zip read back by its central directory: [{ name, bytes, crc }], each checked against its local header. */
function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "the end of the central directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let k = 0; k < count; k++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "a central directory entry");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, "its local header");
    assert.equal(view.getUint16(local + 8, true), 0, "stored");
    assert.equal(view.getUint32(local + 14, true), crc);
    const start = local + 30 + view.getUint16(local + 26, true);
    files.push({ name, bytes: zip.subarray(start, start + size), crc });
    at += 46 + nameLength;
  }
  return files;
}

test("CRC-32: the standard check value", () => {
  assert.equal(X.crc32(bytesOf("123456789")), 0xcbf43926);
  assert.equal(X.crc32(new Uint8Array()), 0);
});

test("the zip: each file stored whole, its CRC right, UTF-8 names", () => {
  const files = [
    { name: "01 Piano.wav", bytes: bytesOf("RIFF one") },
    { name: "02 Violoncelle é.wav", bytes: new Uint8Array(1000).map((_, k) => k & 255) },
    { name: "03 empty.wav", bytes: new Uint8Array() },
  ];
  const zip = X.zip(files);
  const back = unzip(zip);
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  back.forEach((f, k) => {
    assert.deepEqual([...f.bytes], [...files[k].bytes]);
    assert.equal(f.crc, X.crc32(files[k].bytes));
  });
  assert.equal(X.zip([]).length, 22, "an empty zip is its end record");
});

test("stems are named for their staves, numbered in order, safe for a file system", () => {
  assert.deepEqual(X.stemNames(["Piano", "", "Voice: solo/1"]), ["01 Piano.wav", "02 Staff 2.wav", "03 Voice solo 1.wav"]);
  assert.equal(X.fileSafe('  a<b>c  '), "a b c");
});

test("MP3: the samples fed in frames of 1152, stereo or mono, the encoder flushed at the end", async () => {
  const calls = [];
  const lame = {
    Mp3Encoder: class {
      constructor(channels, rate, kbps) {
        calls.push(["new", channels, rate, kbps]);
      }
      encodeBuffer(left, right) {
        calls.push(["frame", left.length, right ? right.length : null, left[0]]);
        return new Int8Array([1, 2]);
      }
      flush() {
        calls.push(["flush"]);
        return new Int8Array([9]);
      }
    },
  };
  const samples = new Float32Array(3000).fill(0.5);
  samples[0] = -1;
  const buffer = { sampleRate: 44100, numberOfChannels: 2, getChannelData: () => samples };
  const progress = [];
  const parts = await X.encodeMp3(buffer, lame, { onProgress: (f) => progress.push(f), slice: 2304 });
  assert.deepEqual(calls[0], ["new", 2, 44100, 192]);
  assert.deepEqual(calls.filter((c) => c[0] === "frame").map((c) => c[1]), [1152, 1152, 696]);
  assert.equal(calls[1][3], -32768, "−1 as the lowest 16-bit sample");
  assert.equal(calls.at(-1)[0], "flush");
  assert.equal(parts.reduce((s, p) => s + p.length, 0), 3 * 2 + 1);
  assert.deepEqual(progress, [2304 / 3000, 1]);
  calls.length = 0;
  await X.encodeMp3({ sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples }, lame, { kbps: 128 });
  assert.deepEqual(calls[0], ["new", 1, 48000, 128]);
  assert.equal(calls[1][2], null, "mono: one channel");
  assert.deepEqual([...X.toInt16(Float32Array.from([2, 1, 0, -2]))], [32767, 32767, 0, -32768]);
});

test("Save the stems: each staff alone through the mixer, the others muted, the mixer back after", async () => {
  const tracks = [{ lane: 0, channel: 0, name: "Flute" }, { lane: 2, channel: 1, name: "Piano" }];
  const alone = [];
  const rendered = [];
  const P = {
    renderWav: async (midi, { muted }) => {
      rendered.push({ muted, alone: alone.at(-1) });
      return new Blob([`wav for ${alone.at(-1)}`]);
    },
  };
  let saved = null;
  const said = [];
  const zip = await X.saveStems({ P, midi: new Uint8Array([1]), tracks, alone: (lane) => alone.push(lane), name: "Song", say: (t) => said.push(t), download: (blob, name, type) => (saved = { blob, name, type }) });
  assert.deepEqual(alone, [0, 2, null]);
  assert.deepEqual(rendered.map((r) => r.muted), [[1], [0]]);
  assert.equal(saved.name, "Song - stems.zip");
  assert.equal(saved.type, "application/zip");
  const files = unzip(zip);
  assert.deepEqual(files.map((f) => [f.name, new TextDecoder().decode(f.bytes)]), [["01 Flute.wav", "wav for 0"], ["02 Piano.wav", "wav for 2"]]);
  assert.match(said.at(-1), /2 WAV files/);
});

test("Save the stems: a render that fails says so, and the mixer is put back", async () => {
  const alone = [];
  const said = [];
  const P = { renderWav: async () => { throw new Error("no sounds"); } };
  const out = await X.saveStems({ P, midi: new Uint8Array(), tracks: [{ lane: 0, channel: 0, name: "A" }], alone: (l) => alone.push(l), name: "S", say: (t, bad) => said.push([t, bad]), download: () => assert.fail("nothing saved") });
  assert.equal(out, null);
  assert.deepEqual(alone, [0, null]);
  assert.deepEqual(said.at(-1), ["The stems could not be made: no sounds", true]);
  await X.saveStems({ P, midi: new Uint8Array(), tracks: [], alone: () => {}, name: "S", say: (t, bad) => said.push([t, bad]), download: () => {} });
  assert.deepEqual(said.at(-1), ["No staff to save.", true]);
});

test("Save the sound as MP3: rendered, encoded, saved; or the reason it could not be", async () => {
  const fake = { Mp3Encoder: class { encodeBuffer() { return new Int8Array([7]); } flush() { return new Int8Array(); } } };
  globalThis.lamejs = fake;
  try {
    const samples = new Float32Array(10);
    const P = { renderAudio: async (midi, { muted }) => ({ sampleRate: 44100, numberOfChannels: 2, getChannelData: () => samples, muted }) };
    let saved = null;
    const blob = await X.saveMp3({ P, midi: new Uint8Array(), muted: [3], name: "Song", say: () => {}, download: (b, name, type) => (saved = { name, type }) });
    assert.deepEqual(saved, { name: "Song.mp3", type: "audio/mpeg" });
    assert.equal(blob.size, 1);
    const said = [];
    const failing = { renderAudio: async () => { throw new Error("no sounds"); } };
    assert.equal(await X.saveMp3({ P: failing, midi: new Uint8Array(), muted: [], name: "S", say: (t, bad) => said.push([t, bad]), download: () => assert.fail() }), null);
    assert.deepEqual(said.at(-1), ["The MP3 file could not be made: no sounds", true]);
  } finally {
    delete globalThis.lamejs;
  }
});

test("lamejs is loaded once, from a pinned version, checked by its digest", async () => {
  assert.match(X.LAME_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/lamejs@1\.2\.1\//);
  assert.match(X.LAME_SRI, /^sha384-/);
  const added = [];
  const doc = { createElement: () => ({}), head: { append: (s) => added.push(s) } };
  const loading = X.loadLame(doc);
  assert.equal(X.loadLame(doc), loading, "one load at a time");
  assert.equal(added.length, 1);
  assert.equal(added[0].integrity, X.LAME_SRI);
  assert.equal(added[0].crossOrigin, "anonymous");
  added[0].onerror();
  await assert.rejects(loading, /needs the network/);
  // Failed: the next save tries again.
  const again = X.loadLame(doc);
  globalThis.lamejs = { Mp3Encoder: class {} };
  added[1].onload();
  assert.equal(await again, globalThis.lamejs);
  assert.equal(await X.loadLame(doc), globalThis.lamejs, "loaded: at once");
  delete globalThis.lamejs;
});
