// The built-in orchestra (public/eui-score/orchestra.js, #1040): the
// manifest read and refused, which instrument a staff plays, the
// articulations its marks pick, the MIDI given its bank and program
// changes, and a bank loaded, kept, refused — General MIDI whenever a bank
// is not there.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import init, { midi, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as Ch from "../../public/eui-score/channels.js";
import * as Sb from "../../public/eui-score/soundbank.js";
import * as O from "../../public/eui-score/orchestra.js";
import * as H from "../../public/eui-score/heard.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const root = new URL("../../", import.meta.url);
const SITE = JSON.parse(readFileSync(new URL("public/soundfonts/orchestra.json", root), "utf8"));
const FIXTURES = new URL("tests/fixtures/sounds/", root);
const FIXTURE = JSON.parse(readFileSync(new URL("orchestra.json", FIXTURES), "utf8"));
const TONE = readFileSync(new URL(FIXTURE.instruments[0].file, FIXTURES));
const AT = new URL("https://score.test/soundfonts/orchestra.json");

const read = (source) => {
  const score = M.fromParsed(JSON.parse(score_json(source))).score;
  score.meta = M.readMeta(source);
  return score;
};
const Q = M.WHOLE / 4;
/** The MIDI as Play writes it: every repeat played out, each staff on its channel. */
const played = (score) => Ch.assignChannels(score, midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0));
/** Channel `channel`'s bank selects and program changes, in order: ["bank 32", "program 1", …], each with its tick. */
const patches = (bytes, channel) =>
  F.readSmf(bytes)
    .tracks.flat()
    .filter((e) => e.data[0] === (0xc0 | channel) || (e.data[0] === (0xb0 | channel) && e.data[1] === 0))
    .sort((a, b) => a.tick - b.tick)
    .map((e) => [e.tick, e.data[0] >> 4 === 0xc ? `program ${e.data[1]}` : `bank ${e.data[2]}`]);
const noteTicks = (bytes, channel) =>
  F.readSmf(bytes)
    .tracks.flat()
    .filter((e) => e.data[0] === (0x90 | channel) && e.data[2] > 0)
    .map((e) => e.tick)
    .sort((a, b) => a - b);
const staff = (sound, music, name = "") => `\\new Staff \\with { ${name ? `instrumentName = "${name}" ` : ""}midiInstrument = "${sound}" } { ${music} }`;

const site = O.readManifest(SITE, AT);
const byId = (id) => site.instruments.find((i) => i.id === id);

// ---- The manifest ---------------------------------------------------------------------------

test("the site's manifest: every instrument well-formed, its file named after its digest, an offset of its own", () => {
  assert.equal(site.instruments.length, SITE.instruments.length, "none refused");
  assert.ok(site.instruments.length >= 20);
  const offsets = new Set(site.instruments.map((i) => i.offset));
  assert.equal(offsets.size, site.instruments.length);
  // Never a bank MuseScore_General has presets in, never one of the own SoundFonts'.
  const taken = [0, 1, 8, 16, 17, 18, 20, 21, 25, 26, 30, 31, 40, 41, 50, 51];
  for (const i of site.instruments) {
    assert.ok(!taken.includes(i.offset) && i.offset < Math.min(...Sb.OFFSETS), `${i.id}: bank ${i.offset}`);
    assert.match(i.url, new RegExp(`^https://score\\.test/soundfonts/orchestra/${i.id}\\.${i.sha256.slice(0, 16)}\\.sf3\\?v=${i.sha256.slice(0, 16)}$`));
    assert.ok(i.size > 50_000 && i.size < 20_000_000, `${i.id}: ${i.size} bytes`);
    assert.ok(i.articulations.includes("sustain"));
    for (const [sound, start] of Object.entries(i.sounds)) {
      assert.ok(M.PROGRAMS.includes(sound), `${i.id}: ${sound} is a sound of Score's`);
      assert.ok(i.articulations.includes(start));
    }
    assert.ok(O.NAMES.includes(i.name), `${i.name} has its French`);
  }
  assert.equal(new Set(O.SLOTS).size, O.SLOTS.length);
  const total = site.instruments.reduce((sum, i) => sum + i.size, 0);
  assert.ok(total < 300 * 1048576, `${Math.round(total / 1048576)} MB in all`);
});

test("the sources and their licences: both free to redistribute, the piano's credit required and said", () => {
  assert.deepEqual(Object.keys(SITE.sources).sort(), ["salamander", "vsco2ce"]);
  for (const s of Object.values(SITE.sources)) {
    assert.match(s.sha256, /^[0-9a-f]{64}$/);
    assert.match(s.url, /^https:\/\/github\.com\//);
    assert.ok(["CC0-1.0", "CC-BY-3.0"].includes(s.license), s.license);
  }
  const owed = O.credits(site);
  assert.deepEqual(owed.filter((c) => c.required).map((c) => [c.name, c.credit]), [["Salamander Grand Piano V3", "Alexander Holm"]]);
  assert.equal(owed.find((c) => c.license === "CC0-1.0").required, false);
  const said = O.creditText(site);
  assert.match(said, /Salamander Grand Piano V3 by Alexander Holm \(CC BY 3\.0\)/);
  assert.match(said, /VSCO 2 Community Edition by Versilian Studios \(Sam Gossner\) \(CC0 1\.0\)/);
  assert.equal(O.creditText(null), "");
  // Each instrument's licence is its source's.
  assert.equal(byId("piano").license, "CC-BY-3.0");
  assert.equal(byId("flute").license, "CC0-1.0");
});

test("no bank is in git: the manifest names files only scripts/sounds/build.py makes", () => {
  const ignored = readFileSync(new URL(".gitignore", root), "utf8");
  assert.match(ignored, /^\/public\/soundfonts\/orchestra\/$/m);
  const inFixtures = readdirSync(FIXTURES).filter((name) => name.endsWith(".sf3"));
  assert.deepEqual(inFixtures, [FIXTURE.instruments[0].file], "the specs' tiny instrument only");
  assert.ok(TONE.length < 20_000);
  assert.equal(createHash("sha256").update(TONE).digest("hex"), FIXTURE.instruments[0].sha256);
});

test("what is not a manifest, or not a well-formed instrument, is refused", () => {
  assert.equal(O.readManifest(null), null);
  assert.equal(O.readManifest([]), null);
  assert.equal(O.readManifest({ instruments: "x" }), null);
  const good = FIXTURE.instruments[0];
  const read = (patch) => O.readManifest({ ...FIXTURE, instruments: [{ ...good, ...patch }] }, AT).instruments;
  assert.equal(read({}).length, 1);
  assert.equal(read({ id: "../x" }).length, 0, "an id that is a path");
  assert.equal(read({ file: "https://elsewhere.test/x.sf3" }).length, 0, "a file that is an address");
  assert.equal(read({ file: "test-tone.0000000000000000.sf3" }).length, 0, "a name that is not the digest's");
  assert.equal(read({ sha256: "zz" }).length, 0);
  assert.equal(read({ articulations: ["staccato"] }).length, 0, "no sustained sound");
  assert.equal(read({ sounds: null }).length, 0);
  // An articulation it does not know is left out; a sound that starts in one it lacks too.
  const odd = read({ articulations: ["sustain", "growl"], sounds: { violin: "sustain", viola: "growl", cello: "pizzicato" } })[0];
  assert.deepEqual(odd.articulations, ["sustain"]);
  assert.deepEqual(odd.sounds, { violin: "sustain" });
  // Twice the same id: once. More instruments than slots: those that have one.
  assert.equal(O.readManifest({ ...FIXTURE, instruments: [good, good] }, AT).instruments.length, 1);
  const many = Array.from({ length: O.SLOTS.length + 3 }, (_, k) => ({ ...good, id: `tone${k}`, file: good.file.replace("test-tone", `tone${k}`) }));
  assert.equal(O.readManifest({ ...FIXTURE, instruments: many }, AT).instruments.length, O.SLOTS.length);
  // A base that is not a path of this site is not followed.
  assert.match(O.readManifest({ ...FIXTURE, base: "https://elsewhere.test/" }, AT).instruments[0].url, /^https:\/\/score\.test\/soundfonts\/orchestra\//);
});

// ---- Which instrument a staff plays ---------------------------------------------------------

test("each of Score's instruments: its built-in one, or General MIDI where neither library has it", () => {
  const expected = {
    Piano: "piano", Violin: "violin", Viola: "viola-section", Cello: "cello-section", "Double bass": "contrabass", Strings: "strings",
    Harp: "harp", Piccolo: "piccolo", Flute: "flute", Oboe: "oboe", "Clarinet in B♭": "clarinet", "Clarinet in A": "clarinet",
    Bassoon: "bassoon", "Trumpet in B♭": "trumpet", "Trumpet in C": "trumpet", "Horn in F": "horn", Trombone: "trombone", Tuba: "tuba",
    Timpani: "timpani", Glockenspiel: "glockenspiel", Xylophone: "xylophone", Marimba: "marimba", "Tubular bells": "tubular-bells", Organ: "organ",
  };
  const general = ["Electric piano", "Harpsichord", "Accordion", "Celesta", "Recorder", "English horn", "Soprano sax", "Alto sax", "Tenor sax",
    "Baritone sax", "Guitar", "Steel-string guitar", "Electric guitar", "Bass guitar", "Banjo", "Voice", "Soprano", "Alto", "Tenor", "Bass", "Vibraphone"];
  const melodic = M.INSTRUMENTS.filter((it) => !it.drums);
  assert.deepEqual(melodic.map((it) => it.name).sort(), [...Object.keys(expected), ...general].sort(), "every instrument of Score's is decided here");
  for (const it of melodic) {
    const score = read(staff(it.sound, "c'1"));
    assert.equal(O.instrumentFor(site, score, 0)?.instrument.id ?? "gm", expected[it.name] ?? "gm", it.name);
  }
  // A sound no instrument of the list has, but a built-in one plays: the strings plucked, or shaken.
  assert.deepEqual([O.instrumentFor(site, read(staff("pizzicato strings", "c'1")), 0)].map((f) => [f.instrument.id, f.start]), [["strings", "pizzicato"]]);
  assert.equal(O.instrumentFor(site, read(staff("tremolo strings", "c'1")), 0).start, "tremolo");
  assert.equal(O.instrumentFor(site, read(staff("muted trumpet", "c'1")), 0).instrument.id, "trumpet-muted");
});

test("a drum staff, a staff on the synthesizer or on a SoundFont of your own keep what they play", () => {
  const drums = read("\\new DrumStaff \\drummode { bd4 sn bd sn }");
  assert.equal(O.soundOf(drums, 0), null);
  assert.equal(O.instrumentFor(site, drums, 0), null);
  const score = read(`<< ${staff("flute", "c''1")} ${staff("oboe", "c''1")} ${staff("clarinet", "c''1")} >>`);
  score.meta = { synth: { 0: { preset: "pad" } }, soundfont: { 1: { name: "Mine.sf2", hash: "0123456789abcdef", bank: 0, program: 3 } } };
  assert.equal(O.instrumentFor(site, score, 0), null);
  assert.equal(O.instrumentFor(site, score, 1), null);
  assert.equal(O.instrumentFor(site, score, 2).instrument.id, "clarinet");
  assert.deepEqual(O.plan(site, score, M.channels(score)).files.map((i) => i.id), ["clarinet"]);
  // No manifest (the site has none, or it could not be read): General MIDI everywhere.
  assert.equal(O.instrumentFor(null, score, 2), null);
  assert.deepEqual(O.plan(null, score, M.channels(score)), { files: [], lanes: [] });
  // A lane that is no staff.
  assert.equal(O.instrumentFor(site, score, "audio-1"), null);
  assert.equal(O.instrumentFor(site, score, 9), null);
});

test("the violin: a soloist alone, a section when the score has several or the staff's name says so; the staff's choice first", () => {
  const solo = read(`<< ${staff("violin", "c''1", "Violin")} ${staff("acoustic grand", "c'1")} >>`);
  assert.equal(O.instrumentFor(site, solo, 0).instrument.id, "violin");
  const quartet = read(`<< ${staff("violin", "c''1")} ${staff("violin", "c''1")} ${staff("viola", "c'1")} ${staff("cello", "c1")} >>`);
  assert.deepEqual([0, 1, 2, 3].map((lane) => O.instrumentFor(site, quartet, lane).instrument.id), ["violin-section", "violin-section", "viola-section", "cello-section"]);
  for (const name of ["Violin I", "Violins", "Violons", "Violin 2"]) assert.equal(O.instrumentFor(site, read(staff("violin", "c''1", name)), 0).instrument.id, "violin-section", name);
  assert.equal(O.instrumentFor(site, read(staff("violin", "c''1", "Violino")), 0).instrument.id, "violin");
  // Chosen on the staff: the soloist in the quartet, General MIDI for the viola.
  assert.equal(O.setLaneChoice(quartet, 0, "violin"), "violin");
  assert.equal(O.setLaneChoice(quartet, 2, "gm"), "gm");
  assert.deepEqual([0, 1, 2].map((lane) => O.instrumentFor(site, quartet, lane)?.instrument.id ?? "gm"), ["violin", "violin-section", "gm"]);
  // Kept on the meta line, and read back from the text.
  const meta = M.readMeta(M.toLilyPond(quartet).source);
  assert.deepEqual(meta.orchestra, { 0: "violin", 2: "gm" });
  // An instrument that does not play the staff's sound is not followed; nor an id that is not one.
  O.setLaneChoice(quartet, 1, "tuba");
  assert.equal(O.instrumentFor(site, quartet, 1).instrument.id, "violin-section");
  assert.equal(O.setLaneChoice(quartet, 1, "../etc"), null);
  assert.equal(O.laneChoice({ meta: { orchestra: { 0: { id: "x" } } } }, 0), null);
  assert.equal(O.setLaneChoice(quartet, "audio-1", "violin"), null);
  // Back to what the sound gives: the key goes with the last.
  for (const lane of [0, 1, 2]) O.setLaneChoice(quartet, lane, null);
  assert.equal(quartet.meta.orchestra, undefined);
});

test("the score's choice: the built-in sounds unless it says General MIDI, kept on its meta line", () => {
  const score = read(staff("flute", "c''1"));
  assert.equal(O.choiceOf(score), "orchestra");
  assert.equal(O.instrumentFor(site, score, 0).instrument.id, "flute");
  assert.equal(O.setChoice(score, "gm"), "gm");
  assert.equal(O.instrumentFor(site, score, 0), null);
  assert.deepEqual(O.plan(site, score, M.channels(score)).lanes, []);
  assert.equal(M.readMeta(M.toLilyPond(score).source).sounds, "gm");
  O.setChoice(score, "orchestra");
  assert.equal("sounds" in score.meta, false);
  // Anything else on the line is not a choice: the built-in sounds.
  assert.equal(O.choiceOf({ meta: { sounds: "loud" } }), "orchestra");
  assert.equal(M.META_KEYS.sounds.clean("loud"), undefined);
  assert.deepEqual(M.META_KEYS.orchestra.clean({ 0: "violin", 1: "../x", x: "violin", 2: 7 }), { 0: "violin" });
});

// ---- Articulations --------------------------------------------------------------------------

test("the marks pick the articulation: plucked from pizz. to arco, a tremolo, a staccato — where the instrument has it", () => {
  const strings = byId("violin-section");
  const flute = byId("flute");
  const piano = byId("piano");
  const marks = (...list) => new Set(list);
  assert.equal(O.articulationOf(marks(), strings), "sustain");
  assert.equal(O.articulationOf(marks("staccato"), strings), "staccato");
  assert.equal(O.articulationOf(marks("staccatissimo"), strings), "staccato");
  assert.equal(O.articulationOf(marks("pizz"), strings), "pizzicato");
  assert.equal(O.articulationOf(marks("pizz", "staccato"), strings), "pizzicato", "a dot on a plucked note is still plucked");
  assert.equal(O.articulationOf(marks("tremolo", "staccato"), strings), "tremolo");
  assert.equal(O.articulationOf(marks("arco", "legato", "accent"), strings), "sustain");
  // The flute has no pizzicato and no tremolo; the piano nothing but its notes.
  assert.equal(O.articulationOf(marks("pizz"), flute), "sustain");
  assert.equal(O.articulationOf(marks("tremolo"), flute), "sustain");
  assert.equal(O.articulationOf(marks("staccato"), flute), "staccato");
  assert.equal(O.articulationOf(marks("staccato", "pizz", "tremolo"), piano), "sustain");
  // A staff that starts plucked (pizzicato strings) stays plucked under a dot, and is shaken by a tremolo.
  assert.equal(O.articulationOf(marks("staccato"), byId("strings"), "pizzicato"), "pizzicato");
  assert.equal(O.articulationOf(marks("tremolo"), byId("strings"), "pizzicato"), "tremolo");
});

test("where a staff changes articulation: a program change of its bank at the note, none while nothing changes", () => {
  const strings = byId("violin-section");
  const score = read(staff("violin", "c''4-. d''-. e'' f''^\"pizz.\" | g''4-. a'' b''^\"arco\" c''' | d'''2:16 e'''2", "Violin I"));
  const bank = strings.offset;
  // 0–1 staccato, 2 sustained, 3–5 plucked (the dot on the fifth changes nothing), 6–7 bowed, 8 tremolo, 10 bowed.
  assert.deepEqual(O.switches(score, 0, strings), [[0, 1, bank], [2 * Q, 0, bank], [3 * Q, 2, bank], [6 * Q, 0, bank], [8 * Q, 3, bank], [10 * Q, 0, bank]]);
  // A first note that is sustained says so: a repeat that comes back to it is sustained again.
  assert.deepEqual(O.switches(read(staff("violin", "c''4 d''-. e'' f''")), 0, strings).map(([tick, program]) => [tick / Q, program]), [[0, 0], [1, 1], [2, 0]]);
  assert.deepEqual(O.switches(read(staff("violin", "c''4 d'' e'' f''")), 0, strings), [], "nothing marked: no change");
  assert.deepEqual(O.switches(score, 0, byId("piano")), [], "an instrument with one articulation never changes");
  // The flute on the same notes: its staccato only.
  assert.deepEqual(O.switches(score, 0, byId("flute")).map(([tick, program]) => [tick / Q, program]), [[0, 1], [2, 0], [4, 1], [5, 0]]);
  assert.deepEqual(O.switches(read(staff("flute", "c''1")), 0, byId("flute")), []);
});

test("the MIDI heard: the staff's track on its bank from its start, a program change a little before each note that changes", () => {
  const score = read(`<< ${staff("violin", "c''4-. d'' e''^\"pizz.\" f''", "Violin I")} ${staff("alto sax", "c'1")} >>`);
  const channels = M.channels(score);
  const bytes = played(score);
  const wanted = O.plan(site, score, channels);
  assert.deepEqual(wanted.files.map((i) => i.id), ["violin-section"], "the saxophone keeps General MIDI");
  assert.deepEqual(wanted.lanes.map((l) => [l.lane, l.channel, l.instrument.id, l.start, l.alone]), [[0, channels[0].channel, "violin-section", "sustain", true]]);
  const out = O.apply(score, bytes, wanted.lanes, { passes: M.playback(score) });
  const bank = byId("violin-section").offset;
  const got = patches(out, channels[0].channel);
  const notes = noteTicks(out, channels[0].channel);
  // Its start: the bank and the sustained program, in place of the engraver's violin (40).
  assert.deepEqual(got.slice(0, 2), [[0, `bank ${bank}`], [0, "program 0"]]);
  assert.ok(!got.some(([, what]) => what === "program 40"));
  // Then staccato for the first note, sustained for the second, plucked from the third — each on the bank.
  assert.ok(got.every(([, what]) => what.startsWith("program") || what === `bank ${bank}`));
  assert.deepEqual(got.slice(2).filter(([, what]) => what.startsWith("program")).map(([, what]) => what), ["program 1", "program 0", "program 2"]);
  const changes = got.slice(2).filter(([, what]) => what.startsWith("program")).map(([tick]) => tick);
  assert.ok(changes[0] <= notes[0] && changes[1] <= notes[1] && changes[1] > notes[0] && changes[2] <= notes[2] && changes[2] > notes[1], "each before its own note, after the one before");
  assert.deepEqual(noteTicks(out, channels[0].channel), noteTicks(bytes, channels[0].channel), "not a note moved");
  // The saxophone's track is as it was.
  assert.deepEqual(patches(out, channels[1].channel), patches(bytes, channels[1].channel));
  // Nothing loaded: the bytes as they were.
  assert.equal(O.apply(score, bytes, []), bytes);
});

test("a repeat played out: the articulation in effect is sent again where the music jumps back", () => {
  const score = read(staff("cello", "\\repeat volta 2 { c4 d e^\"pizz.\" f } g1^\"arco\""));
  const channels = M.channels(score);
  const wanted = O.plan(site, score, channels);
  const out = O.apply(score, played(score), wanted.lanes, { passes: M.playback(score) });
  const programs = patches(out, channels[0].channel).filter(([, what]) => what.startsWith("program")).map(([, what]) => what);
  // The track's start, then: bowed, plucked — back to the start: bowed again, plucked again — then bowed.
  assert.deepEqual(programs, ["program 0", "program 0", "program 2", "program 0", "program 2", "program 0"]);
});

test("a staff that changes instrument on the way keeps its General MIDI sounds", () => {
  const score = read(staff("flute", "c''4 d'' e'' f'' | R1 | R1 | c''4 d'' e'' f''"));
  M.changeInstrument(score, 0, M.barStart(score, 3), M.INSTRUMENTS.findIndex((it) => it.name === "Piccolo"));
  const channels = M.channels(score);
  const bytes = played(score);
  assert.deepEqual([...O.changingChannels(bytes)], [channels[0].channel]);
  const wanted = O.plan(site, score, channels);
  assert.equal(wanted.lanes.length, 1);
  assert.deepEqual(O.apply(score, bytes, wanted.lanes, { passes: M.playback(score) }), bytes);
});

// ---- Loading --------------------------------------------------------------------------------

const tone = () => O.readManifest(FIXTURE, AT).instruments[0];
const bodyOf = (bytes, chunk = 4000) => ({
  getReader() {
    let at = 0;
    return { read: async () => (at >= bytes.length ? { done: true } : { done: false, value: bytes.subarray(at, (at += chunk)) }) };
  },
});
/** A site: `files` by address; counts what is asked for. */
function site_(files) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    const found = files[String(url)];
    if (found === "offline") throw new TypeError("Failed to fetch");
    if (!found) return { ok: false, status: 404 };
    return { ok: true, status: 200, body: bodyOf(found), json: async () => JSON.parse(new TextDecoder().decode(found)) };
  };
  return { fetch, asked };
}
/** Cache Storage, in memory. */
function storage() {
  const kept = new Map();
  const cache = {
    match: async (url) => (kept.has(String(url)) ? { arrayBuffer: async () => kept.get(String(url)).slice(0) } : undefined),
    put: async (url, response) => void kept.set(String(url), await response.arrayBuffer()),
    delete: async (url) => kept.delete(String(url.url ?? url)),
    keys: async () => [...kept.keys()].map((url) => ({ url })),
  };
  return { open: async () => cache, kept };
}
const player = () => {
  const used = [];
  return { used, useBank: async (id, buffer, offset) => void used.push([id, buffer.byteLength, offset]) };
};
const pianoScore = () => read(`<< ${staff("acoustic grand", "c'4-. d' e' f'")} ${staff("alto sax", "c'1")} >>`);

test("a bank: downloaded with its progress, checked against the manifest, kept, and not asked for again", async () => {
  O.useManifest(FIXTURE, AT);
  const instrument = tone();
  const { fetch, asked } = site_({ [instrument.url]: new Uint8Array(TONE) });
  const caches = storage();
  const seen = [];
  assert.equal(await O.isKept(instrument, { caches }), false);
  const got = await O.bank(instrument, { fetch, caches, onProgress: (n) => seen.push(n) });
  assert.equal(got.byteLength, TONE.length);
  assert.deepEqual(seen, [4000, 8000, TONE.length], "its bytes as they come");
  assert.deepEqual([...caches.kept.keys()], [instrument.url], "kept under its address");
  assert.equal(O.isLoaded(instrument), true);
  assert.equal(await O.isKept(instrument, { caches }), true);
  await O.bank(instrument, { fetch, caches });
  assert.equal(asked.length, 1, "in this tab already");
  // Another visit (the tab's memory gone): from the browser, without the network.
  O.useManifest(FIXTURE, AT);
  const offline = site_({ [instrument.url]: "offline" });
  assert.equal((await O.bank(instrument, { fetch: offline.fetch, caches })).byteLength, TONE.length);
  assert.equal(offline.asked.length, 0);
});

test("a bank that is not the file named, not on the site, or out of reach: none, and tried again later", async () => {
  O.useManifest(FIXTURE, AT);
  const instrument = tone();
  const caches = storage();
  const wrong = new Uint8Array(TONE);
  wrong[wrong.length - 1] ^= 1;
  assert.equal(await O.bank(instrument, { fetch: site_({ [instrument.url]: wrong }).fetch, caches }), null, "one bit off");
  assert.equal(caches.kept.size, 0, "nothing kept of it");
  assert.equal(await O.bank(instrument, { fetch: site_({}).fetch, caches }), null, "a 404");
  assert.equal(await O.bank(instrument, { fetch: site_({ [instrument.url]: "offline" }).fetch, caches }), null, "no network");
  assert.equal(O.isLoaded(instrument), false);
  // A kept copy that went bad is thrown away and fetched again.
  caches.kept.set(instrument.url, wrong.buffer);
  const good = site_({ [instrument.url]: new Uint8Array(TONE) });
  assert.equal((await O.bank(instrument, { fetch: good.fetch, caches })).byteLength, TONE.length);
  assert.equal(good.asked.length, 1);
  assert.deepEqual(new Uint8Array(caches.kept.get(instrument.url)), new Uint8Array(TONE));
  // A browser with no Cache Storage plays it all the same.
  O.useManifest(FIXTURE, AT);
  const none = { open: async () => { throw new Error("SecurityError"); } };
  assert.equal((await O.bank(instrument, { fetch: good.fetch, caches: none })).byteLength, TONE.length);
});

test("an older version of an instrument leaves the browser when the new one is kept", async () => {
  O.useManifest(FIXTURE, AT);
  const instrument = tone();
  const caches = storage();
  const old = "https://score.test/soundfonts/orchestra/test-tone.0123456789abcdef.sf3?v=0123456789abcdef";
  const other = "https://score.test/soundfonts/orchestra/test-tone-two.0123456789abcdef.sf3?v=0123456789abcdef";
  const main = "https://score.test/soundfonts/MuseScore_General.sf3?v=0.2";
  for (const url of [old, other, main]) caches.kept.set(url, new ArrayBuffer(4));
  await O.bank(instrument, { fetch: site_({ [instrument.url]: new Uint8Array(TONE) }).fetch, caches });
  assert.deepEqual([...caches.kept.keys()].sort(), [instrument.url, other, main].sort());
});

test("Play: a bank not there yet leaves its staff on General MIDI and comes meanwhile; the next Play uses it", async () => {
  O.useManifest(FIXTURE, AT);
  const instrument = tone();
  const score = pianoScore();
  const channels = M.channels(score);
  const caches = storage();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const real = site_({ [instrument.url]: new Uint8Array(TONE) });
  const slow = async (url) => {
    await gate;
    return real.fetch(url);
  };
  const P = player();
  const progress = [];
  const first = await O.prepare(P, score, channels, { io: { fetch: slow, caches }, onProgress: (p) => progress.push(p) });
  assert.deepEqual(first.lanes, [], "nothing to play it with yet");
  assert.deepEqual(first.pending.map((i) => i.id), ["test-tone"]);
  assert.deepEqual(P.used, []);
  const bytes = played(score);
  assert.equal(O.apply(score, bytes, first.lanes), bytes, "the MIDI as it was: General MIDI");
  release();
  assert.equal(await first.done, 1);
  assert.deepEqual(progress.at(-1), { received: TONE.length, total: TONE.length, count: 1 });
  const second = await O.prepare(P, score, channels, { io: { fetch: slow, caches } });
  assert.deepEqual(second.lanes.map((l) => [l.lane, l.instrument.id]), [[0, "test-tone"]]);
  assert.deepEqual(second.pending, []);
  assert.deepEqual(P.used, [["orchestra:test-tone", TONE.length, instrument.offset]]);
  assert.equal(real.asked.length, 1);
  // The piano's staccato dots: the tone's second program, on its bank.
  const out = O.apply(score, bytes, second.lanes, { passes: M.playback(score) });
  assert.deepEqual(patches(out, channels[0].channel).filter(([, what]) => what.startsWith("program")).map(([, what]) => what), ["program 0", "program 1", "program 0"]);
});

test("Save the sound waits for every bank; a first Play waits as long as the default sounds take", async () => {
  O.useManifest(FIXTURE, AT);
  const instrument = tone();
  const score = pianoScore();
  const channels = M.channels(score);
  const io = { fetch: site_({ [instrument.url]: new Uint8Array(TONE) }).fetch, caches: storage() };
  const waited = await O.prepare(player(), score, channels, { wait: true, io });
  assert.deepEqual([waited.lanes.length, waited.pending.length], [1, 0]);
  // The default sounds still loading: the bank comes first, and is played.
  O.useManifest(FIXTURE, AT);
  let ready;
  const until = new Promise((resolve) => (ready = resolve));
  const io2 = { fetch: site_({ [instrument.url]: new Uint8Array(TONE) }).fetch, caches: storage() };
  const raced = await O.prepare(player(), score, channels, { until, io: io2 });
  assert.deepEqual([raced.lanes.length, raced.pending.length], [1, 0]);
  ready();
  // The default sounds come first: Play does not wait for the bank.
  O.useManifest(FIXTURE, AT);
  const never = { fetch: () => new Promise(() => {}), caches: storage() };
  const quick = await O.prepare(player(), score, channels, { until: Promise.resolve(), io: never });
  assert.deepEqual([quick.lanes.length, quick.pending.map((i) => i.id)], [0, ["test-tone"]]);
  // A moment's patience: a bank that comes within it is played, one that does not is not waited for.
  O.useManifest(FIXTURE, AT);
  const real = site_({ [instrument.url]: new Uint8Array(TONE) });
  const soon = { fetch: (url) => new Promise((resolve) => setTimeout(() => resolve(real.fetch(url)), 10)), caches: storage() };
  const patient = await O.prepare(player(), score, channels, { until: Promise.resolve(), patience: 2000, io: soon });
  assert.deepEqual([patient.lanes.length, patient.pending.length], [1, 0]);
  O.useManifest(FIXTURE, AT);
  const began = Date.now();
  const late = await O.prepare(player(), score, channels, { patience: 30, io: never });
  assert.deepEqual([late.lanes.length, late.pending.length], [0, 1]);
  assert.ok(Date.now() - began < 1500, "not waited for");
});

test("a bank that cannot be had is missing, not pending: its staff plays General MIDI, and the music plays", async () => {
  O.useManifest(FIXTURE, AT);
  const score = pianoScore();
  const P = player();
  const out = await O.prepare(P, score, M.channels(score), { wait: true, io: { fetch: site_({}).fetch, caches: storage() } });
  assert.deepEqual([out.lanes, out.pending, out.missing.map((i) => i.id)], [[], [], ["test-tone"]]);
  assert.deepEqual(P.used, []);
});

test("nothing is asked of the site for a score on General MIDI, one with no built-in instrument, or no score", async () => {
  O.useManifest(FIXTURE, AT);
  const { fetch, asked } = site_({});
  const io = { fetch, caches: storage() };
  const gm = pianoScore();
  O.setChoice(gm, "gm");
  const sax = read(staff("alto sax", "c'1"));
  for (const score of [gm, sax, null]) {
    const out = await O.prepare(player(), score, score ? M.channels(score) : [], { wait: true, io });
    assert.deepEqual([out.lanes, out.pending, out.missing], [[], [], []]);
    assert.equal(await out.done, 0);
  }
  assert.deepEqual(asked, []);
});

test("the manifest: read once from the site; a site without one plays General MIDI and is asked again next time", async () => {
  O.useManifest(null);
  const there = site_({ [AT.href]: new TextEncoder().encode(JSON.stringify(FIXTURE)) });
  const first = await O.manifest({ fetch: there.fetch, url: AT });
  assert.deepEqual(first.instruments.map((i) => i.id), ["test-tone"]);
  await O.manifest({ fetch: there.fetch, url: AT });
  assert.equal(there.asked.length, 1);
  O.useManifest(null);
  const gone = site_({});
  assert.equal(await O.manifest({ fetch: gone.fetch, url: AT }), null);
  assert.equal(await O.manifest({ fetch: site_({ [AT.href]: "offline" }).fetch, url: AT }), null);
  assert.equal(await O.manifest({ fetch: there.fetch, url: AT }) !== null, true, "there again: read");
  const score = pianoScore();
  O.useManifest(null);
  const out = await O.prepare(player(), score, M.channels(score), { io: { fetch: gone.fetch, caches: storage(), url: AT } });
  assert.deepEqual(out.lanes, []);
  O.useManifest(null);
});

// ---- Outside the editor (heard.js: the read page, the shared pages, the examples) -------------

/** What score.js hands heard.js: eui-score.js's toMidi and the engraver's reading, its spans in. */
const tools = {
  midi: async (source, { bpm = 100, beat = 4 } = {}) => midi(source, bpm, beat, 0),
  parse: (source) => {
    const parsed = JSON.parse(score_json(source));
    parsed.spans = JSON.parse(source_spans(source));
    return parsed;
  },
};

test("a page's Play: the score's staves on their built-in instruments, as in the editor; General MIDI when anything fails", async () => {
  const instrument = tone();
  const src = staff("acoustic grand", "c'4-. d' e' f'");
  const wasFetch = globalThis.fetch;
  const wasCaches = globalThis.caches;
  try {
    O.useManifest(FIXTURE, AT);
    globalThis.caches = storage();
    globalThis.fetch = site_({ [instrument.url]: new Uint8Array(TONE) }).fetch;
    const heard = await H.heardMidi(src, tools);
    assert.equal(heard.score.staves.length, 1, "the score as read comes with the bytes");
    assert.equal(heard.passes.length, 1);
    const P = player();
    const out = await H.withOrchestra(heard, P, { patience: 2000 });
    assert.deepEqual(P.used, [["orchestra:test-tone", TONE.length, instrument.offset]]);
    assert.deepEqual(patches(out, 0).filter(([, what]) => what.startsWith("program")).map(([, what]) => what), ["program 0", "program 1", "program 0"]);
    assert.deepEqual(noteTicks(out, 0), noteTicks(heard.bytes, 0));
    // A section played over and over: the instrument's first articulation throughout, no change on the way.
    const looped = await H.heardMidi(src, { ...tools, loop: { bars: 1, time: "4/4" } });
    assert.ok(looped.turns > 1);
    const turned = await H.withOrchestra(looped, P);
    assert.deepEqual(patches(turned, 0), [[0, `bank ${instrument.offset}`], [0, "program 0"]]);
    // The score says General MIDI: the bytes as they were.
    const general = await H.heardMidi(`${src}\n%% eui-score {"sounds":"gm"}\n`, tools);
    assert.equal(await H.withOrchestra(general, P), general.bytes);
    // A source the model does not read has no score: as written.
    assert.equal(await H.withOrchestra({ bytes: heard.bytes, turns: 1, score: null, passes: [] }, P), heard.bytes);
    // A player that cannot take the bank: the music plays all the same.
    const broken = { useBank: async () => { throw new Error("no worklet"); } };
    assert.equal(await H.withOrchestra(heard, broken), heard.bytes);
    // The bank not on the site: General MIDI.
    O.useManifest(FIXTURE, AT);
    globalThis.caches = storage();
    globalThis.fetch = site_({}).fetch;
    assert.equal(await H.withOrchestra(heard, player(), { patience: 2000 }), heard.bytes);
  } finally {
    globalThis.fetch = wasFetch;
    globalThis.caches = wasCaches;
    O.useManifest(null);
  }
});
