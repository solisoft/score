// Keyswitches, program changes and articulation maps (public/eui-score/sound.js,
// #670): kept on the meta line under `ks`, `ksmaps` and `ksopt`, never
// engraved and never notes of the score; laid into the MIDI the real
// engraver writes, each a little before its note, on its staff's channel.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json, svg } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as Snd from "../../public/eui-score/sound.js";
import * as A from "../../public/eui-score/automation.js";
import * as R from "../../public/eui-score/piano-roll.js";
import * as F from "../../public/eui-score/feel.js";
import * as X from "../../public/eui-score/musicxml.js";
import * as Pr from "../../public/eui-score/practice.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => {
  const score = M.fromParsed(JSON.parse(score_json(source))).score;
  score.meta = M.readMeta(source);
  return score;
};
const Q = M.WHOLE / 4;
/** The MIDI as Play writes it: every repeat played out. */
const played = (score) => midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);
/** Each track's channel events: [{ tick, bytes }]. */
const channelEvents = (bytes) => F.readSmf(bytes).tracks.map((t) => t.filter((e) => e.data[0] < 0xf0).map((e) => ({ tick: e.tick, bytes: [...e.data] })));
const noteOns = (events) => events.filter((e) => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0);
/** The keys struck at velocity `velocity` (the keyswitches, in these tests): [[tick, key]]. */
const switches = (events, velocity = Snd.VELOCITY) => noteOns(events).filter((e) => e.bytes[2] === velocity).map((e) => [e.tick, e.bytes[1]]);
/** The keys of the music: everything louder. */
const music = (events, velocity = Snd.VELOCITY) => noteOns(events).filter((e) => e.bytes[2] !== velocity).map((e) => [e.tick, e.bytes[1]]);
/** File ticks `ms` before `tick`, by the file's tempo. */
const before = (bytes, tick, ms) => {
  const clock = Snd.clockOf(F.readSmf(bytes));
  return Math.max(0, Math.floor(clock.tickAt(clock.secAt(tick) - ms / 1000)));
};

test("kept on the meta line under ks, beside the curves; the engraver passes over it", () => {
  const score = read("{ c'4 d' e' f' }\n%% eui-score {\"cc\":{\"0\":{\"1\":[[0,5]]}}}\n");
  const kept = Snd.setSound(score, 0, { keys: [[Q, 300], [0, 12.4], [Q, 14], [-5, 1], ["x", 3]], programs: [[0, 40, 1, 2], [2 * Q, 41], [Q, 200]] });
  assert.deepEqual(kept.keys, [[0, 12], [Q, 14]], "sorted, in range, one a tick (the last wins)");
  assert.deepEqual(kept.programs, [[0, 40, 1, 2], [2 * Q, 41]]);
  const { source } = M.toLilyPond(score);
  const meta = M.readMeta(source);
  assert.deepEqual(meta.ks, { 0: { keys: [[0, 12], [Q, 14]], programs: [[0, 40, 1, 2], [2 * Q, 41]] } });
  assert.deepEqual(meta.cc, { 0: { 1: [[0, 5]] } }, "the curves kept");
  assert.deepEqual(JSON.parse(score_json(source)).warnings, [], "the engraver passes over it");
  // Emptied: the key goes.
  Snd.setSound(score, 0, { keys: [], programs: [] });
  assert.equal(M.readMeta(M.toLilyPond(score).source).ks, undefined);
  assert.throws(() => Snd.setSound(score, "x", { keys: [] }), /No such lane/);
});

test("never engraved, never a note of the score: the drawing, the roll, MusicXML and LilyPond's music are as without them", () => {
  const plain = "\\new Staff { \\set Staff.midiInstrument = \"violin\" c''4-. d''^\"pizz.\" e'' f''^\"arco\" }";
  const score = read(plain);
  Snd.setSound(score, 0, { keys: [[0, 12], [2 * Q, 13]], programs: [[0, 40]] });
  Snd.setMap(score, "m1", Snd.templateMap());
  Snd.setSound(score, 0, { map: "m1" });
  const { source } = M.toLilyPond(score);
  assert.match(source, /%% eui-score .*"ks"/);
  const bare = M.toLilyPond(read(plain)).source;
  assert.equal(source.replace(/^%% eui-score .*\n/m, ""), bare, "the music written is the same");
  const drawn = (text) => svg(text, 800, 7, "").replace(/es\d+-/g, "es-");
  assert.equal(drawn(source), drawn(bare), "the engraving is the same");
  const again = read(source);
  assert.deepEqual(R.rollNotes(again).map((n) => [n.t0, n.key]), R.rollNotes(read(bare)).map((n) => [n.t0, n.key]), "the roll's notes");
  assert.equal(X.toMusicXML(again), X.toMusicXML(read(bare)), "MusicXML");
  assert.deepEqual(music(channelEvents(played(again))[0], -1), music(channelEvents(played(read(bare)))[0], -1), "the engraver's MIDI");
});

test("in the MIDI: a keyswitch a little before its note, softly, let go when the note starts, on the staff's channel", () => {
  const score = read("<< \\new Staff { c'4 d' e' f' } \\new Staff { \\clef bass c4 d e f } >>");
  Snd.setSound(score, 1, { keys: [[0, 12], [2 * Q, 13]] });
  const bytes = played(score);
  const out = Snd.applySound(score, bytes);
  const tracks = channelEvents(out);
  assert.equal(tracks.length, 2, "no track added");
  assert.deepEqual(switches(tracks[0]), [], "not the other staff's");
  const ppq = F.readSmf(out).division;
  assert.deepEqual(switches(tracks[1]), [[0, 12], [before(out, 2 * ppq, Snd.LEAD_MS), 13]], "20 ms early, the first at the very start");
  assert.ok(before(out, 2 * ppq, 20) < 2 * ppq && before(out, 2 * ppq, 20) > 2 * ppq - ppq / 8, "a few ticks only");
  assert.ok(tracks[1].filter((e) => e.bytes[1] === 13).every((e) => (e.bytes[0] & 15) === 1), "on the staff's channel");
  const off = tracks[1].find((e) => (e.bytes[0] & 0xf0) === 0x80 && e.bytes[1] === 13);
  assert.equal(off.tick, 2 * ppq, "let go as its note starts");
  // At the very start, the keyswitch still comes before the note struck there.
  const atZero = tracks[1].filter((e) => e.tick === 0 && (e.bytes[0] & 0xf0) === 0x90);
  assert.deepEqual(atZero.map((e) => e.bytes[1]), [12, 48]);
  assert.deepEqual(music(tracks[1]), music(channelEvents(bytes)[1]), "the music's notes as they were");
  assert.equal(Snd.applySound(read("{ c'4 }"), played(read("{ c'4 }"))).length, played(read("{ c'4 }")).length, "nothing to add: the same bytes");
});

test("in the MIDI: a program change with its bank first; the lead and the velocity as the score sets them", () => {
  const score = read("{ c'4 d' e' f' }");
  Snd.setSound(score, 0, { programs: [[Q, 40, 1, 2], [3 * Q, 41]], keys: [[2 * Q, 24]] });
  assert.deepEqual(Snd.setOptions(score, { lead: 0, velocity: 64 }), { lead: 0, velocity: 64 });
  assert.deepEqual(M.readMeta(M.toLilyPond(score).source).ksopt, { lead: 0, velocity: 64 });
  const out = Snd.applySound(score, played(score));
  const events = channelEvents(out)[0];
  const ppq = F.readSmf(out).division;
  const atBeat = events.filter((e) => e.tick === ppq && (e.bytes[0] & 0xf0) !== 0x80).map((e) => e.bytes);
  assert.deepEqual(atBeat.slice(0, 4), [[0xb0, 0, 1], [0xb0, 32, 2], [0xc0, 40], [0x90, 62, atBeat[3][2]]], "MSB, LSB, program, then the note");
  assert.deepEqual(events.filter((e) => (e.bytes[0] & 0xf0) === 0xc0 && e.tick > 0).map((e) => [e.tick, e.bytes[1]]), [[ppq, 40], [3 * ppq, 41]]);
  assert.deepEqual(switches(events, 64), [[2 * ppq, 24]], "no lead: at the note, at velocity 64");
  // The defaults are not written; out of range: as they were.
  Snd.setOptions(score, { lead: Snd.LEAD_MS, velocity: Snd.VELOCITY });
  assert.equal(M.readMeta(M.toLilyPond(score).source).ksopt, undefined);
  assert.deepEqual(Snd.setOptions(score, { lead: 9999, velocity: 0 }), { lead: Snd.LEAD_MS, velocity: Snd.VELOCITY });
});

test("a repeat sends its bars' markers again; a jump back sends what the music has there", () => {
  const score = read("{ c'1 \\repeat volta 2 { d'1 e'1 } f'1 }");
  Snd.setSound(score, 0, { keys: [[0, 12], [2 * M.WHOLE, 14]], programs: [[0, 40], [2 * M.WHOLE, 41]] });
  const events = Snd.soundEvents(score);
  const at = (kind) => events.filter((e) => e.kind === kind).map((e) => [e.at / M.WHOLE, e.key ?? e.program]);
  // Bars as played: 0, 1, 2, 1, 2, 3. The jump back to bar 1 lands where 12 and 40 were in effect.
  assert.deepEqual(at("key"), [[0, 12], [2, 14], [3, 12], [4, 14]]);
  assert.deepEqual(at("program"), [[0, 40], [2, 41], [3, 40], [4, 41]]);
});

test("the marks of a staff's notes: articulations, tremolo, slurs, and the words that last until changed", () => {
  const score = read("<< \\new Staff { c'4-.( d'-- e'-> f') g'2:16 a'4-^ b'-! | c''4^\"pizz.\" d'' e''^\"arco\" f''^\"sul pont.\" | g''4~ g'' a''^\"ord.\" b''^\"con sord.\" | c'''1^\"senza sord.\" } >>");
  const marks = Snd.onsetsOf(score, 0).map((n) => [n.tick / Q, [...n.marks].sort().join(",")]);
  assert.deepEqual(marks, [
    [0, "legato,staccato"], [1, "legato,tenuto"], [2, "accent,legato"], [3, "legato"],
    [4, "tremolo"], [6, "marcato"], [7, "staccatissimo"],
    [8, "pizz"], [9, "pizz"], [10, "arco"], [11, "arco,sulpont"],
    // The tied note is struck once.
    [12, "arco,sulpont"], [14, "arco"], [15, "arco,consord"],
    [16, "arco,senzasord"],
  ]);
  assert.deepEqual(Snd.techniqueOf("Pizz."), { bow: "pizz" });
  assert.deepEqual(Snd.techniqueOf("dolce"), {});
  assert.deepEqual(Snd.techniqueOf("ordinary"), {}, "a word that only starts like ord. is not one");
});

test("an articulation map: the keyswitch of each note's mark before it, the default when the mark ends, only where it changes", () => {
  const score = read("{ c'4-. d'-. e' f'^\"pizz.\" | g'4-. a' b'^\"arco\" c''( | d''4) e''2:16 f''4 }");
  Snd.setMap(score, "strings", { name: "Strings", default: { key: 24 }, rules: [{ mark: "pizz", key: 26 }, { mark: "staccato", key: 25 }, { mark: "tremolo", key: 27, cc: 21, value: 90 }, { mark: "legato", key: 28 }] });
  Snd.setSound(score, 0, { map: "strings" });
  const events = Snd.soundEvents(score).map((e) => [e.at / Q, e.kind === "key" ? e.key : `cc${e.number}=${e.value}`]);
  // 0 staccato, 2 none (the default), 3 pizz., 4 pizz. still — it wins over the staccato on it, the
  // first rule a note carries — 6 arco (the default), 7 under a slur, 9 tremolo, 11 none.
  assert.deepEqual(events.filter(([, x]) => typeof x === "number"), [[0, 25], [2, 24], [3, 26], [6, 24], [7, 28], [9, 27], [11, 24]]);
  assert.deepEqual(events.filter(([, x]) => typeof x === "string"), [[9, "cc21=90"]], "a rule's controller with its keyswitch");
  assert.ok(Snd.soundEvents(score).findIndex((e) => e.kind === "cc") < Snd.soundEvents(score).findIndex((e) => e.kind === "key" && e.key === 27), "the controller before the keyswitch");
  // In the file: each before its note, the music untouched.
  const out = Snd.applySound(score, played(score));
  const track = channelEvents(out)[0];
  const ppq = F.readSmf(out).division;
  assert.deepEqual(switches(track).map(([, k]) => k), [25, 24, 26, 24, 28, 27, 24]);
  for (const [t, k] of switches(track)) assert.ok(music(track).some(([u]) => u > t && u - t <= ppq / 8) || t === 0, `${k} just before a note`);
});

test("a keyswitch placed by hand wins at its tick, and holds until the map's rule next changes", () => {
  const score = read("{ c'4-. d'-. e'-. f' | g'4 a' b'-. c'' }");
  Snd.setMap(score, "m", { name: "M", default: { key: 24 }, rules: [{ mark: "staccato", key: 25 }] });
  Snd.setSound(score, 0, { map: "m", keys: [[Q, 30], [5 * Q, 31]] });
  const keys = Snd.soundEvents(score).filter((e) => e.kind === "key").map((e) => [e.at / Q, e.key]);
  // 0: staccato (map); 1: by hand (the map's rule there is the same: it waits); 3: default (map);
  // 5: by hand, where the map has nothing new; 6: staccato (map); 7: default (map).
  assert.deepEqual(keys, [[0, 25], [1, 30], [3, 24], [5, 31], [6, 25], [7, 24]]);
  // By hand where the map changes: the hand's, and the map's change is not sent there.
  Snd.setSound(score, 0, { keys: [[3 * Q, 40]] });
  const now = Snd.soundEvents(score).filter((e) => e.kind === "key").map((e) => [e.at / Q, e.key]);
  assert.deepEqual(now, [[0, 25], [3, 40], [6, 25], [7, 24]]);
});

test("maps kept in the score: cleaned when read, the staves that followed one let go when it goes", () => {
  const score = read("{ c'4 }");
  const kept = Snd.setMap(score, "m1", { name: "  <b>Mine</b>\u0007 ", default: { key: 300 }, rules: [{ mark: "pizz", key: 26 }, { mark: "nonsense", key: 1 }, { mark: "staccato" }, { mark: "tenuto", cc: 21, value: 64 }, { mark: "accent", cc: 21 }] });
  assert.deepEqual(kept, { name: "<b>Mine</b>", rules: [{ mark: "pizz", key: 26 }, { mark: "tenuto", cc: 21, value: 64 }] }, "a rule that sends nothing goes; a key out of range is none");
  Snd.setSound(score, 0, { map: "m1", keys: [[0, 12]] });
  assert.equal(Snd.soundOf(score, 0).map, "m1");
  Snd.setMap(score, "m1", null);
  assert.deepEqual(Snd.soundOf(score, 0), { keys: [[0, 12]], programs: [], map: null });
  assert.equal(M.readMeta(M.toLilyPond(score).source).ksmaps, undefined);
  assert.throws(() => Snd.setMap(score, "bad id!", {}), /No such map/);
  const id = Snd.newMapId(score, 42);
  assert.match(id, /^m[0-9a-z]+$/);
  Snd.setMap(score, id, { name: "x", rules: [] });
  assert.notEqual(Snd.newMapId(score, 42), id, "an id the score does not use");
});

test("a meta line written by anyone: no markup drawn, nothing out of range sent (#537)", () => {
  const payload = "<img src=x onerror=alert(1)>";
  const ks = { 0: { keys: [[0, payload], [Q, 300], [2 * Q, 13], "x"], programs: [[0, "<b>"], [Q, 5, payload]], map: payload }, "<i>": { keys: [[0, 1]] } };
  const ksmaps = { m1: { name: payload, rules: [{ mark: payload, key: 1 }, { mark: "pizz", key: payload }] }, [payload]: { name: "x", rules: [] } };
  const score = read(`{ c'4 d' e' f' }\n%% eui-score ${JSON.stringify({ ks, ksmaps, ksopt: { lead: payload, velocity: -4 } })}\n`);
  assert.deepEqual(Snd.soundsOf(score), { 0: { keys: [[2 * Q, 13]], programs: [[Q, 5]] } });
  assert.deepEqual(Object.keys(Snd.mapsOf(score)), ["m1"]);
  assert.deepEqual(Snd.mapsOf(score).m1.rules, []);
  assert.deepEqual(Snd.optionsOf(score), { lead: Snd.LEAD_MS, velocity: Snd.VELOCITY });
  Snd.setSound(score, 0, { map: "m1" });
  const geo = R.rollLayout(score, { layout: "tracks" });
  const drawn = Snd.drawLane(score, geo, 0);
  assert.doesNotMatch(drawn, /<img|NaN|undefined/);
  assert.match(drawn, /&lt;img/);
});

test("the lane: a flag per marker on its row, the map's keyswitches drawn pale, where a click lands", () => {
  const score = read("{ c'4-. d' e' f' }");
  Snd.setMap(score, "m", Snd.templateMap());
  Snd.setSound(score, 0, { keys: [[Q, 13]], programs: [[0, 40, 1]], map: "m" });
  const geo = R.rollLayout(score, { layout: "tracks" });
  const drawn = Snd.drawLane(score, geo, 0, { chosen: { row: "keys", index: 0 } });
  assert.equal(drawn.match(/data-ks-row="keys"/g).length, 1);
  assert.equal(drawn.match(/data-ks-row="programs"/g).length, 1);
  assert.match(drawn, /ks-chosen/);
  assert.match(drawn, />C♯0</, "the keyswitch by its name");
  assert.match(drawn, />P40 bank 1\/–</);
  assert.match(drawn, /class="ks-mapped"/);
  assert.equal(Snd.rowAt(Snd.ROWS.keys.top + 2), "keys");
  assert.equal(Snd.rowAt(Snd.ROWS.programs.top + 2), "programs");
  assert.equal(Snd.rowAt(Snd.ROWS.map.top + 2), "map");
  assert.equal(Snd.rowAt(-3), null);
  assert.equal(Snd.markerAt(geo, [[0, 1], [Q, 2]], geo.x(Q) + 3), 1);
  assert.equal(Snd.markerAt(geo, [[0, 1], [Q, 2]], geo.x(Q) + 30), -1);
  assert.equal(Snd.keyText(12), "C0 (12)");
});

test("the template: named generically, its notes said to be examples, every mark one the maps know", () => {
  const map = Snd.templateMap();
  assert.equal(map.name, "Keyswitches from C0 (template)");
  assert.match(Snd.TEMPLATE.description, /keyswitch chart/);
  assert.match(Snd.TEMPLATE.description, /arbitrary/);
  assert.equal(map.rules.length, Snd.TEMPLATE.rules.length, "every rule kept");
  assert.deepEqual(map.default, { key: 12 });
  assert.doesNotMatch(JSON.stringify(Snd.TEMPLATE), /eastwest|spitfire|vienna|orchestral tools|kontakt|play\b/i, "no vendor's name");
});

test("the staff's lanes move with it: a staff removed takes its markers, a line added before it moves them", () => {
  const score = read("<< \\new Staff { c'4 } \\new Staff { d'4 } \\new Staff { e'4 } >>");
  Snd.setSound(score, 0, { keys: [[0, 12]] });
  Snd.setSound(score, 2, { keys: [[0, 14]], map: "m" });
  M.removeStaff(score, 0);
  assert.deepEqual(Object.keys(score.meta.ks), ["1"]);
  assert.deepEqual(Snd.soundOf(score, 1).keys, [[0, 14]]);
  M.addChordStaff(score, 0);
  assert.deepEqual(Object.keys(score.meta.ks), ["2"]);
  M.removeStaff(score, 2);
  assert.equal(score.meta.ks, undefined, "emptied: gone");
});

test("practice transposes the music, never a keyswitch; humanize never strikes a note before its keyswitch", () => {
  const score = read("{ c'4 d' e' f' }");
  Snd.setSound(score, 0, { keys: [[Q, 12]] });
  const raised = Snd.applySound(score, Pr.applyPractice(played(score), { transpose: 2 }));
  assert.deepEqual(switches(channelEvents(raised)[0]).map(([, k]) => k), [12]);
  assert.deepEqual(music(channelEvents(raised)[0]).map(([, k]) => k), [62, 64, 66, 67]);
  // Humanized up to 30 ms either way: the keyswitch still before the note it goes with.
  const felt = F.feel(played(score), { score, passes: M.playback(score), humanize: { time: 30, seed: 3 } });
  const out = Snd.applySound(score, felt, { early: 30 });
  const track = channelEvents(out)[0];
  const [[on]] = switches(track);
  const d = music(track).find(([, k]) => k === 62)[0];
  assert.ok(on < d, `the keyswitch (${on}) before the note (${d})`);
});

test("a staff with keyswitches keeps a channel of its own, past fifteen staves", () => {
  const staves = Array.from({ length: 17 }, () => "\\new Staff { c'4 }").join(" ");
  const score = read(`<< ${staves} >>`);
  const shared = M.channels(score);
  assert.equal(shared[3].channel, shared[4].channel, "alike, two staves share one");
  Snd.setSound(score, 4, { programs: [[0, 3]] });
  const now = M.channels(score);
  assert.equal(now.filter((c) => c.channel === now[4].channel).length, 1, "its own");
});

test("a repeat back to the very start sends the map's keyswitch again when a hand's changed it on the way", () => {
  const score = read("{ \\repeat volta 2 { c'1 d'1 } e'1 }");
  Snd.setMap(score, "m", { name: "M", default: { key: 24 }, rules: [] });
  Snd.setSound(score, 0, { map: "m", keys: [[M.WHOLE, 14]] });
  const keys = Snd.soundEvents(score).filter((e) => e.kind === "key").map((e) => [e.at / M.WHOLE, e.key]);
  // Bars as played: 0, 1, 0, 1, 2 — the second pass starts on the default again, not on the hand's 14.
  assert.deepEqual(keys, [[0, 24], [1, 14], [2, 24], [3, 14]]);
});

test("on fast notes, a keyswitch never goes before the note struck ahead of its own", () => {
  const score = read("{ c'32-. d' e'-. f' g'-. a' b'-. c'' }");
  Snd.setMap(score, "m", { name: "M", default: { key: 24 }, rules: [{ mark: "staccato", key: 25 }] });
  Snd.setSound(score, 0, { map: "m" });
  Snd.setOptions(score, { lead: 200 });
  const out = Snd.applySound(score, played(score));
  const track = channelEvents(out)[0];
  const notes = music(track).map(([t]) => t);
  const keys = switches(track);
  assert.deepEqual(keys.map(([, k]) => k), [25, 24, 25, 24, 25, 24, 25, 24], "one a note: each changes the rule");
  // Keyswitch k sounds after note k − 1 is struck, and no later than note k.
  keys.forEach(([t], k) => {
    assert.ok(t <= notes[k], `keyswitch ${k} at or before its note`);
    if (k > 0) assert.ok(t > notes[k - 1], `keyswitch ${k} after the note before`);
  });
  // A slow passage keeps the whole lead.
  const slow = read("{ c'4-. d' }");
  Snd.setMap(slow, "m", { name: "M", default: { key: 24 }, rules: [{ mark: "staccato", key: 25 }] });
  Snd.setSound(slow, 0, { map: "m" });
  const slowOut = Snd.applySound(slow, played(slow));
  const ppq = F.readSmf(slowOut).division;
  assert.deepEqual(switches(channelEvents(slowOut)[0]), [[0, 25], [before(slowOut, ppq, Snd.LEAD_MS), 24]]);
});

test("a device Play starts, loops or seeks past the start is sent the keyswitch in effect there", () => {
  const score = read("<< \\new Staff { c'4 d' e' f' | g'1 } \\new Staff { \\clef bass c1 | d1 } >>");
  Snd.setSound(score, 0, { keys: [[0, 12], [2 * Q, 13], [M.WHOLE, 14]] });
  Snd.setSound(score, 1, { keys: [[0, 30]] });
  const passes = M.playback(score);
  const times = Snd.keyswitchTimes(score, { passes });
  const beat = 60 / passes[0].bpm;
  const lead = Snd.LEAD_MS / 1000;
  assert.deepEqual(times.map((t) => [Math.round((t.sec + lead) / beat * 1000) / 1000, t.channel, t.key]), [[0, 0, 12], [0, 1, 30], [2, 0, 13], [4, 0, 14]], "at its note, less the lead");
  const at = (sec) => Snd.keysAt(times, sec).sort((a, b) => a.channel - b.channel).map((k) => [k.channel, k.key]);
  assert.deepEqual(at(beat), [[0, 12], [1, 30]]);
  assert.deepEqual(at(2 * beat), [[0, 13], [1, 30]], "the keyswitch due on the very note started from: sent, the file has it just before");
  assert.deepEqual(at(5 * beat), [[0, 14], [1, 30]]);
  assert.deepEqual(Snd.keysAt([], 3), []);
});
