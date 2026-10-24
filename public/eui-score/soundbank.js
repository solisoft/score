// Your own SoundFont (#391): an SF2 or SF3 file loaded from disk, a staff
// playing one of its presets.
//
// The file stays in this browser, in IndexedDB, keyed by a digest of its
// bytes (SHA-256, the first 16 hex digits): the score keeps only its name,
// that digest and the preset chosen, on its `%% eui-score` line under
// `soundfont`, by lane:
//
//   "soundfont": { "1": { "name": "Strings.sf2", "hash": "3f2a…", "bank": 0, "program": 48, "preset": "Slow Strings" } }
//
// Opened where the file is not (another browser, another person), the staff
// plays its General MIDI instrument from the default sounds, and the editor
// says so. Files over `MAX_BYTES` are refused; every storage call is
// guarded: a private window, or a browser that keeps nothing, plays the
// file for this visit only.
//
// How it is heard: SpessaSynth (player.js `useBank`) takes the file as a
// second sound bank, its banks moved up by an offset (64, 80, 96, 112 — a
// score's first four files), and the staff's track gets that bank and the
// preset's program at its start (`applyPresets`) in place of its own. Save
// as MIDI keeps the General MIDI program. No DOM here but IndexedDB:
// tests/js/soundbank.test.mjs.

const V = new URL(import.meta.url).search;
const F = await import(`./feel.js${V}`);
const Ch = await import(`./channels.js${V}`);

/** The largest file kept: 100 MB. */
export const MAX_BYTES = 100 * 1024 * 1024;
/** The bank offsets of a score's files, in the order they are first used. */
export const OFFSETS = [64, 80, 96, 112];
const DB = "eui-score-soundfonts";
const STORE = "fonts";

const text = (b, at, length) => {
  let s = "";
  for (let i = at; i < at + length && b[i]; i++) s += String.fromCharCode(b[i]);
  return s.trim();
};
const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** True when `bytes` begin as a SoundFont (SF2 or SF3): a RIFF file of form "sfbk". */
export function isSoundFont(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length >= 12 && fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "sfbk";
}

/**
 * The presets of SoundFont `bytes`, from its preset headers (pdta › phdr):
 * [{ name, bank, program }], by bank and program, the drum kits (bank 128)
 * left out — a staff picks a melodic instrument. Throws on what is not a
 * SoundFont.
 */
export function presetsOf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isSoundFont(b)) throw new Error("not a SoundFont (SF2 or SF3) file");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const end = Math.min(b.length, 8 + v.getUint32(4, true));
  for (let at = 12; at + 8 <= end; ) {
    const id = fourcc(b, at);
    const size = v.getUint32(at + 4, true);
    if (id === "LIST" && fourcc(b, at + 8) === "pdta") {
      for (let p = at + 12; p + 8 <= at + 8 + size; ) {
        const sub = fourcc(b, p);
        const length = v.getUint32(p + 4, true);
        if (sub === "phdr") {
          const out = [];
          // 38 bytes a header; the last, "EOP", only ends the list.
          for (let h = p + 8; h + 38 <= p + 8 + length - 38; h += 38) {
            const bank = v.getUint16(h + 22, true);
            if (bank >= 128) continue;
            out.push({ name: text(b, h, 20) || `Preset ${v.getUint16(h + 20, true)}`, bank, program: v.getUint16(h + 20, true) & 127 });
          }
          return out.sort((x, y) => x.bank - y.bank || x.program - y.program);
        }
        p += 8 + length + (length & 1);
      }
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("this SoundFont lists no preset");
}

/** The digest a file is kept under: the first 16 hex digits of its SHA-256. */
export async function hashOf(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Why a file cannot be used, or null: too big, empty, or not a SoundFont. */
export function refusal(name, bytes) {
  const size = bytes?.byteLength ?? 0;
  if (!size) return `${name} is empty.`;
  if (size > MAX_BYTES) return `${name} is ${(size / 1048576).toFixed(0)} MB: the most a SoundFont may be here is ${MAX_BYTES / 1048576} MB.`;
  if (!isSoundFont(bytes)) return `${name} is not a SoundFont: an .sf2 or .sf3 file.`;
  return null;
}

// ---- What the score keeps ----------------------------------------------------------------

/** Lane `lane`'s SoundFont preset, as kept: { name, hash, bank, program, preset }, or null. */
export function soundfontOf(score, lane) {
  // A staff's lane only: an audio track ("audio-1", #390) plays no preset.
  if (!/^\d+$/.test(String(lane))) return null;
  const s = score?.meta?.soundfont?.[lane];
  if (!s || typeof s !== "object" || !/^[0-9a-f]{16}$/.test(String(s.hash))) return null;
  return {
    name: String(s.name ?? "SoundFont").slice(0, 120),
    hash: s.hash,
    bank: Math.max(0, Math.min(127, Math.round(Number(s.bank) || 0))),
    program: Math.max(0, Math.min(127, Math.round(Number(s.program) || 0))),
    preset: String(s.preset ?? "").slice(0, 40),
  };
}

/** Lane `lane` set to play `value` (soundfontOf's shape), or its General MIDI instrument again with null. */
export function setSoundfont(score, lane, value) {
  if (!/^\d+$/.test(String(lane))) return null;
  const all = { ...(score.meta?.soundfont ?? {}) };
  if (value == null) delete all[lane];
  else {
    all[lane] = { name: value.name, hash: value.hash, bank: value.bank, program: value.program, preset: value.preset };
    if (!soundfontOf({ meta: { soundfont: all } }, lane)) delete all[lane];
  }
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.soundfont = all;
  else delete score.meta.soundfont;
  return all[lane] ?? null;
}

/**
 * What the score's SoundFonts make of its staves (`channels`, score-model.js
 * `channels`), given `available` (a Set of the digests this browser has):
 * `{ fonts: [{ hash, name, offset }], presets: [{ channel, bank, program }],
 * missing: [{ lane, name }] }` — a file this browser does not have plays
 * the default sounds. A score's fifth file and on are not heard either.
 */
export function plan(score, channels, available) {
  const fonts = [];
  const presets = [];
  const missing = [];
  for (const { lane, channel } of channels) {
    const s = soundfontOf(score, lane);
    if (!s) continue;
    let font = fonts.find((f) => f.hash === s.hash);
    if (!font && available.has(s.hash) && fonts.length < OFFSETS.length) fonts.push((font = { hash: s.hash, name: s.name, offset: OFFSETS[fonts.length] }));
    if (!font) {
      missing.push({ lane, name: s.name });
      continue;
    }
    presets.push({ channel, bank: Math.min(127, font.offset + s.bank), program: s.program });
  }
  return { fonts, presets, missing };
}

/**
 * `bytes` with each channel of `presets` ([{ channel, bank, program }])
 * playing that preset: its program changes and bank selects taken out, and
 * a bank select (CC 0) and a program change put at its start.
 */
export function applyPresets(bytes, presets) {
  if (!presets.length) return bytes;
  const smf = F.readSmf(bytes);
  const by = new Map(presets.map((p) => [p.channel, p]));
  for (const events of smf.tracks) {
    const port = Ch.portOf(events);
    const channelOf = (e) => (e.data[0] < 0xf0 ? 16 * port + (e.data[0] & 15) : null);
    const mine = new Set(events.map(channelOf).filter((c) => c != null && by.has(c)));
    if (!mine.size) continue;
    const kept = events.filter((e) => {
      const c = channelOf(e);
      if (c == null || !mine.has(c)) return true;
      const kind = e.data[0] & 0xf0;
      return !(kind === 0xc0 || (kind === 0xb0 && (e.data[1] === 0 || e.data[1] === 32)));
    });
    const head = [...mine].flatMap((c) => {
      const p = by.get(c);
      const n = c & 15;
      return [
        { tick: 0, data: [0xb0 | n, 0, p.bank] },
        { tick: 0, data: [0xb0 | n, 32, 0] },
        { tick: 0, data: [0xc0 | n, p.program] },
      ];
    });
    // After a port event, if any: the channels are that port's.
    const at = kept.findIndex((e) => !(e.data[0] === 0xff && e.data[1] === 0x21));
    kept.splice(at < 0 ? kept.length : at, 0, ...head);
    events.splice(0, events.length, ...kept);
  }
  F.sortTracks(smf);
  return F.writeSmf(smf);
}

// ---- Kept in this browser ----------------------------------------------------------------

function open() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "hash" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Keeps a file: true when it is kept, false when this browser keeps nothing (it plays for this visit only). */
export async function keep({ hash, name, bytes, presets }) {
  try {
    await run("readwrite", (store) => store.put({ hash, name, size: bytes.byteLength, presets, bytes, kept: Date.now() }));
    return true;
  } catch (error) {
    return false;
  }
}

/** A kept file: { hash, name, size, presets, bytes }, or null. */
export async function load(hash) {
  try {
    return await run("readonly", (store) => store.get(hash));
  } catch (error) {
    return null;
  }
}

/** The files kept, without their bytes: [{ hash, name, size, presets }]. */
export async function list() {
  try {
    const all = await run("readonly", (store) => store.getAll());
    return (all ?? []).map(({ bytes, ...rest }) => rest).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    return [];
  }
}

/** Forgets a kept file; true when it went. */
export async function forget(hash) {
  try {
    await run("readwrite", (store) => store.delete(hash));
    return true;
  } catch (error) {
    return false;
  }
}
