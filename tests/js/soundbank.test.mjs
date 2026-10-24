// Your own SoundFont (public/eui-score/soundbank.js, #391): its presets read
// from the file, what the score keeps of it, the staff's track given its
// bank and program, and the file kept in this browser — or not, when the
// browser keeps nothing.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as Sb from "../../public/eui-score/soundbank.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

// ---- A SoundFont, made here: RIFF sfbk › LIST INFO, LIST sdta, LIST pdta › phdr ----------

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u16 = (n) => [n & 255, (n >> 8) & 255];
const chunk = (id, body) => [...ascii(id), ...u32(body.length), ...body, ...(body.length & 1 ? [0] : [])];
const list = (type, chunks) => chunk("LIST", [...ascii(type), ...chunks.flat()]);
const header = (name, program, bank) => [...ascii(name.padEnd(20, "\0").slice(0, 20)), ...u16(program), ...u16(bank), ...u16(0), ...u32(0), ...u32(0), ...u32(0)];

function soundFont(presets) {
  const phdr = chunk("phdr", [...presets.flatMap(([name, program, bank]) => header(name, program, bank)), ...header("EOP", 0, 0)]);
  const body = [...ascii("sfbk"), ...list("INFO", [chunk("ifil", [...u16(2), ...u16(1)]), chunk("INAM", ascii("Test\0"))]), ...list("sdta", [chunk("smpl", [0, 0, 0, 0])]), ...list("pdta", [phdr])];
  return new Uint8Array([...ascii("RIFF"), ...u32(body.length), ...body]);
}

const FONT = soundFont([["Warm Pad", 89, 0], ["Strings", 48, 0], ["Kit", 0, 128], ["Bright Strings", 48, 1]]);

test("a SoundFont's presets: by bank and program, the drum kits left out", () => {
  assert.equal(Sb.isSoundFont(FONT), true);
  assert.deepEqual(Sb.presetsOf(FONT), [
    { name: "Strings", bank: 0, program: 48 },
    { name: "Warm Pad", bank: 0, program: 89 },
    { name: "Bright Strings", bank: 1, program: 48 },
  ]);
  // From an ArrayBuffer too.
  assert.equal(Sb.presetsOf(FONT.buffer).length, 3);
});

test("what is not a SoundFont, too big or empty is refused, saying why", () => {
  assert.equal(Sb.isSoundFont(new TextEncoder().encode("RIFF....WAVEfmt ")), false);
  assert.throws(() => Sb.presetsOf(new TextEncoder().encode("not a soundfont at all")), /not a SoundFont/);
  // A RIFF sfbk with no preset headers.
  const bare = new Uint8Array([...ascii("RIFF"), ...u32(4), ...ascii("sfbk")]);
  assert.throws(() => Sb.presetsOf(bare), /lists no preset/);
  assert.equal(Sb.refusal("a.sf2", FONT.buffer), null);
  assert.equal(Sb.refusal("a.sf2", new ArrayBuffer(0)), "a.sf2 is empty.");
  assert.match(Sb.refusal("song.mp3", new TextEncoder().encode("ID3...").buffer), /song.mp3 is not a SoundFont/);
  // One byte over the limit; the limit itself passes the size check.
  const over = { byteLength: Sb.MAX_BYTES + 1 };
  assert.match(Sb.refusal("huge.sf2", over), /the most a SoundFont may be here is 100 MB/);
  assert.notEqual(Sb.refusal("max.sf2", new Uint8Array(16)), null, "not a SoundFont, whatever its size");
});

test("a file's digest: 16 hex digits, the same for the same bytes, another for others", async () => {
  const a = await Sb.hashOf(FONT);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(await Sb.hashOf(FONT.slice()), a);
  assert.notEqual(await Sb.hashOf(soundFont([["Other", 1, 0]])), a);
});

test("the score keeps the file's name, digest and preset, by lane; read back from its text", () => {
  const { score } = M.fromParsed(JSON.parse(score_json("<< \\new Staff { c''1 } \\new Staff { \\clef bass c1 } >>")));
  score.meta = {};
  assert.equal(Sb.soundfontOf(score, 1), null);
  const kept = Sb.setSoundfont(score, 1, { name: "Strings.sf2", hash: "0123456789abcdef", bank: 1, program: 48, preset: "Bright Strings", bytes: "never kept" });
  assert.deepEqual(kept, { name: "Strings.sf2", hash: "0123456789abcdef", bank: 1, program: 48, preset: "Bright Strings" });
  const meta = M.readMeta(M.toLilyPond(score).source);
  assert.deepEqual(meta.soundfont, { 1: kept });
  assert.deepEqual(Sb.soundfontOf({ meta }, 1), kept);
  // A digest that is not one is not kept, nor read.
  assert.equal(Sb.setSoundfont(score, 0, { name: "x", hash: "../../etc", bank: 0, program: 0 }), null);
  assert.equal(Sb.soundfontOf({ meta: { soundfont: { 0: { hash: "zz" } } } }, 0), null);
  // Out of range: held in range.
  assert.deepEqual(Sb.soundfontOf({ meta: { soundfont: { 0: { hash: "0123456789abcdef", bank: 300, program: -4 } } } }, 0).bank, 127);
  // Taken away: the key gone with the last.
  Sb.setSoundfont(score, 1, null);
  assert.equal(score.meta.soundfont, undefined);
  // A staff on its own SoundFont keeps its own channel.
  Sb.setSoundfont(score, 0, kept);
  const [first, second] = M.channels(score);
  assert.notEqual(first.channel, second.channel);
});

test("what is heard: each file an offset of its own, a file this browser lacks played with the default sounds", () => {
  const score = { staves: [{}, {}, {}], meta: { soundfont: {
    0: { name: "A.sf2", hash: "aaaaaaaaaaaaaaaa", bank: 0, program: 5 },
    1: { name: "B.sf2", hash: "bbbbbbbbbbbbbbbb", bank: 2, program: 7 },
    2: { name: "A.sf2", hash: "aaaaaaaaaaaaaaaa", bank: 1, program: 9 },
  } } };
  const channels = [{ lane: 0, channel: 0 }, { lane: 1, channel: 1 }, { lane: 2, channel: 2 }];
  const out = Sb.plan(score, channels, new Set(["aaaaaaaaaaaaaaaa"]));
  assert.deepEqual(out.fonts, [{ hash: "aaaaaaaaaaaaaaaa", name: "A.sf2", offset: 64 }]);
  assert.deepEqual(out.presets, [{ channel: 0, bank: 64, program: 5 }, { channel: 2, bank: 65, program: 9 }]);
  assert.deepEqual(out.missing, [{ lane: 1, name: "B.sf2" }]);
  // Both there: the second file the next offset.
  assert.deepEqual(Sb.plan(score, channels, new Set(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"])).presets[1], { channel: 1, bank: 82, program: 7 });
  // None: all three play the default sounds.
  assert.equal(Sb.plan(score, channels, new Set()).missing.length, 3);
});

test("a staff's track plays the preset: its own program and bank selects replaced by the file's, at its start", () => {
  const track = [
    { tick: 0, data: [0xff, 0x03, 1, 65] },
    { tick: 0, data: [0xb2, 0, 8] },
    { tick: 0, data: [0xc2, 40] },
    { tick: 0, data: [0x92, 60, 90] },
    { tick: 480, data: [0xc2, 41] },
    { tick: 480, data: [0x82, 60, 0] },
    { tick: 480, data: [0xff, 0x2f, 0] },
  ];
  const other = [{ tick: 0, data: [0xc0, 0] }, { tick: 0, data: [0x90, 64, 80] }, { tick: 480, data: [0x80, 64, 0] }, { tick: 480, data: [0xff, 0x2f, 0] }];
  const bytes = F.writeSmf({ format: 1, division: 480, tracks: [other, track] });
  const out = F.readSmf(Sb.applyPresets(bytes, [{ channel: 2, bank: 65, program: 48 }]));
  assert.deepEqual(out.tracks[1].map((e) => [e.tick, ...e.data]), [
    [0, 0xb2, 0, 65],
    [0, 0xb2, 32, 0],
    [0, 0xc2, 48],
    [0, 0xff, 0x03, 1, 65],
    [0, 0x92, 60, 90],
    [480, 0x82, 60, 0],
    [480, 0xff, 0x2f, 0],
  ]);
  assert.deepEqual(out.tracks[0], F.readSmf(bytes).tracks[0], "another channel's track untouched");
  assert.equal(Sb.applyPresets(bytes, []), bytes);
  // On a second port, after its port event.
  const ported = F.writeSmf({ format: 1, division: 480, tracks: [[{ tick: 0, data: [0xff, 0x21, 1, 1] }, { tick: 0, data: [0x93, 60, 90] }, { tick: 480, data: [0xff, 0x2f, 0] }]] });
  const second = F.readSmf(Sb.applyPresets(ported, [{ channel: 19, bank: 64, program: 3 }])).tracks[0].map((e) => e.data);
  assert.deepEqual(second.slice(0, 4), [[0xff, 0x21, 1, 1], [0xb3, 0, 64], [0xb3, 32, 0], [0xc3, 3]]);
  assert.equal(F.readSmf(Sb.applyPresets(ported, [{ channel: 3, bank: 64, program: 3 }])).tracks[0].length, 3, "port 0's channel 3 is another channel");
});

test("with no IndexedDB (a private window, node): nothing kept, nothing thrown", async () => {
  assert.equal(globalThis.indexedDB, undefined);
  assert.equal(await Sb.keep({ hash: "aaaaaaaaaaaaaaaa", name: "A.sf2", bytes: FONT.buffer, presets: [] }), false);
  assert.equal(await Sb.load("aaaaaaaaaaaaaaaa"), null);
  assert.deepEqual(await Sb.list(), []);
  assert.equal(await Sb.forget("aaaaaaaaaaaaaaaa"), false);
});

// ---- A small IndexedDB: one database, object stores keyed by a path ---------------------

function fakeIndexedDB({ failWrites = false } = {}) {
  const stores = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const request = (run) => {
    const r = { result: undefined, error: null };
    later(() => {
      try {
        r.result = run();
        r.onsuccess?.();
      } catch (error) {
        r.error = error;
        r.onerror?.();
      }
    });
    return r;
  };
  const db = {
    createObjectStore(name, { keyPath }) {
      stores.set(name, { keyPath, rows: new Map() });
    },
    transaction(name, mode) {
      const store = stores.get(name);
      const tx = {};
      const ops = [];
      const objectStore = {
        put(value) {
          ops.push(() => {
            if (mode !== "readwrite" || failWrites) throw new Error("QuotaExceededError");
            store.rows.set(value[store.keyPath], structuredClone(value));
            return value[store.keyPath];
          });
          return (ops.at(-1).request = { result: undefined });
        },
        get(key) {
          ops.push(() => (store.rows.has(key) ? structuredClone(store.rows.get(key)) : undefined));
          return (ops.at(-1).request = { result: undefined });
        },
        getAll() {
          ops.push(() => [...store.rows.values()].map((v) => structuredClone(v)));
          return (ops.at(-1).request = { result: undefined });
        },
        delete(key) {
          ops.push(() => store.rows.delete(key) && undefined);
          return (ops.at(-1).request = { result: undefined });
        },
      };
      tx.objectStore = () => objectStore;
      later(() => {
        try {
          for (const op of ops) op.request.result = op();
          tx.oncomplete?.();
        } catch (error) {
          tx.error = error;
          tx.onabort?.();
        }
      });
      return tx;
    },
    close() {},
  };
  let made = false;
  return {
    open() {
      return request(() => {
        if (!made) {
          made = true;
          db.createObjectStore("fonts", { keyPath: "hash" });
        }
        return db;
      });
    },
  };
}

test("kept in this browser: listed without its bytes, loaded whole, forgotten; a full browser keeps nothing", async () => {
  globalThis.indexedDB = fakeIndexedDB();
  try {
    const hash = await Sb.hashOf(FONT);
    const presets = Sb.presetsOf(FONT);
    assert.equal(await Sb.keep({ hash, name: "Pads.sf2", bytes: FONT.buffer, presets }), true);
    assert.equal(await Sb.keep({ hash: "bbbbbbbbbbbbbbbb", name: "Alpha.sf3", bytes: new ArrayBuffer(8), presets: [] }), true);
    const listed = await Sb.list();
    assert.deepEqual(listed.map((f) => f.name), ["Alpha.sf3", "Pads.sf2"], "by name");
    assert.equal(listed[1].size, FONT.byteLength);
    assert.equal("bytes" in listed[1], false, "no bytes in the list");
    const back = await Sb.load(hash);
    assert.deepEqual(new Uint8Array(back.bytes), FONT);
    assert.deepEqual(back.presets, presets);
    assert.equal(await Sb.load("cccccccccccccccc"), null, "not kept");
    assert.equal(await Sb.forget(hash), true);
    assert.equal((await Sb.list()).length, 1);
    // A browser out of room: refused, and said so by false.
    globalThis.indexedDB = fakeIndexedDB({ failWrites: true });
    assert.equal(await Sb.keep({ hash, name: "Pads.sf2", bytes: FONT.buffer, presets }), false);
    assert.deepEqual(await Sb.list(), []);
  } finally {
    delete globalThis.indexedDB;
  }
});
