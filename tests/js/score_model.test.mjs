// The editor's model, engraved by the real engraver (the WebAssembly module
// the site ships): every edit must give LilyPond eui-score accepts, and a
// score must read back as itself.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** Engraves the score; answers the LilyPond and the view, or throws the refusal. */
function engrave(score) {
  const { source, items } = M.toLilyPond(score);
  let view;
  try {
    view = JSON.parse(editor_view(source, 900, 7, -1, -1));
  } catch (e) {
    throw new Error(`${e.message ?? e}\n${source}`);
  }
  // Every event of a staff's first voice is an item; a second voice's, in the bars it is written in.
  const upper = score.staves.reduce((n, st) => n + (st.voice === 2 ? 0 : st.events.length), 0);
  assert.equal(items.filter((it) => score.staves[it.staff].voice !== 2).length, upper, "one item per event");
  assert.ok(items.every((it) => score.staves[it.staff].events[it.index]), "every item is an event");
  assert.equal(new Set(items.map((it) => `${it.staff}:${it.index}`)).size, items.length, "no event twice");
  assert.equal(view.items.length, items.length, `the engraver sees every item\n${source}`);
  return { source, view };
}

/** The score read back from its own LilyPond. */
function reread(score) {
  const back = M.fromParsed(JSON.parse(score_json(M.toLilyPond(score).source)));
  assert.ok(back.score, `reads back: ${back.unsupported}`);
  return back.score;
}

const shape = (score) => score.staves.map((st) => st.events.map((e) => [e.rest ? "r" : e.pitches.map((p) => M.spellPitch(p.d, p.alter)).join("+"), M.ticksOf(e), e.tie]));
const C4 = { rest: false, pitches: [{ d: 7, alter: 0 }] };
const q = M.notated(4);

test("a new score is four bars of rest, engraved", () => {
  const s = M.newScore();
  assert.equal(M.barsOf(s), 4);
  engrave(s);
});

test("a note written over rests leaves the rest of the bar as rests", () => {
  const s = M.newScore();
  const i = M.write(s, 0, 0, q, C4);
  assert.equal(i, 0);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["c'", q, false], ["r", 3 * q, false]]);
  engrave(s);
});

test("a note longer than its bar is tied across the bar line", () => {
  const s = M.newScore();
  M.write(s, 0, 3 * q, 2 * q, C4);
  const events = shape(s)[0];
  assert.deepEqual(events[1], ["c'", q, true]);
  assert.deepEqual(events[2], ["c'", q, false]);
  engrave(s);
});

test("writing past the end adds bars", () => {
  const s = M.newScore();
  M.write(s, 0, 16 * q, q, C4);
  assert.equal(M.barsOf(s), 5);
  engrave(s);
});

test("a shorter value leaves a rest; a longer one writes over what follows", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  M.write(s, 0, q, q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  M.setDuration(s, 0, 0, 2, 0);
  assert.deepEqual(shape(s)[0][0], ["c'", 2 * q, false]);
  assert.equal(shape(s)[0][1][0], "r", "the E was written over");
  assert.throws(() => M.write(s, 0, undefined, q, C4), /nothing to write/);
  M.setDuration(s, 0, 0, 8, 0);
  assert.deepEqual(shape(s)[0][0], ["c'", q / 2, false]);
  engrave(s);
});

test("triplets and sextuplets, and writing into them", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  M.makeTuplet(s, 0, 0, 3);
  M.letter(s, 0, 1, 1);
  M.letter(s, 0, 2, 2);
  const { source } = engrave(s);
  assert.match(source, /\\tuplet 3\/2 \{ c'8 d'8 e'8 \}/);
  M.write(s, 0, q, q, C4);
  const i = M.eventAt(s.staves[0], q);
  M.makeTuplet(s, 0, i, 6);
  assert.match(engrave(s).source, /\\tuplet 6\/4 \{ c'16 r16 r16 r16 r16 r16 \}/);
  assert.equal(M.lengthOf(s.staves[0]) % M.barLength(s), 0);
  const back = reread(s);
  assert.deepEqual(shape(back), shape(s));
  M.removeTuplet(s, 0, 0);
  assert.deepEqual(shape(s)[0][0], ["c'", q, false]);
  engrave(s);
});

test("a tuplet written at the cursor takes the input's value, not the rest it falls in", () => {
  const s = M.newScore();
  const i = M.tupletAt(s, 0, 0, q, 3);
  assert.equal(i, 0);
  assert.deepEqual(s.staves[0].events.slice(0, 3).map((e) => [e.base, e.tuplet?.n]), [[8, 3], [8, 3], [8, 3]]);
  assert.equal(M.ticksOf(s.staves[0].events[3]), 3 * q, "the rest of the bar stays a rest");
  engrave(s);
});

test("the arrows, letters, chords and accidentals", () => {
  const s = M.newScore({ key: 1 });
  M.write(s, 0, 0, q, { rest: false, pitches: [{ d: 11, alter: 0 }] });
  M.move(s, 0, 0, "step", -1);
  assert.deepEqual(s.staves[0].events[0].pitches, [{ d: 10, alter: 1 }], "F is sharp in G major");
  M.move(s, 0, 0, "semitone", 1);
  assert.equal(M.spellPitch(...Object.values(s.staves[0].events[0].pitches[0])), "g'");
  M.letter(s, 0, 0, 6, true);
  M.letter(s, 0, 0, 1, true);
  assert.equal(s.staves[0].events[0].pitches.map((p) => M.spellPitch(p.d, p.alter)).join(" "), "g' b' d''");
  M.setAlter(s, 0, 0, -1, 1);
  assert.match(engrave(s).source, /<g' bes' d''>4/);
  M.remove(s, 0, 0, 1);
  assert.equal(s.staves[0].events[0].pitches.length, 2);
  M.remove(s, 0, 0);
  assert.ok(s.staves[0].events[0].rest);
  engrave(s);
});

test("ties, slurs, dynamics, hairpins, articulations, chord symbols, lyrics — and back", () => {
  const s = M.newScore({ header: { title: "Test", composer: "Me" } });
  for (const [k, d] of [7, 9, 11, 12].entries()) M.write(s, 0, k * q, q, { rest: false, pitches: [{ d, alter: 0 }] });
  M.write(s, 0, 4 * q, q, C4);
  M.toggleTie(s, 0, 3);
  M.toggleSlur(s, 0, 0, 2);
  M.setDynamic(s, 0, 0, "mf");
  M.setHairpin(s, 0, 1, 3, "<");
  M.toggleArticulation(s, 0, 2, "staccato");
  M.toggleArticulation(s, 0, 2, "accent");
  M.setChordSymbol(s, 0, 0, "C");
  // Under the slur (0–2) only the first note sings; the tied C takes nothing.
  M.setLyric(s, 0, 0, "Hel", true);
  M.setLyric(s, 0, 3, "world", false, true);
  const { source } = engrave(s);
  assert.match(source, /c'4\(\\mf\^"C"/);
  assert.match(source, /\\addlyrics \{ Hel -- world __ \}/);
  const back = reread(s);
  assert.deepEqual(shape(back), shape(s));
  const ev = back.staves[0].events;
  assert.equal(ev[0].dynamic, "mf");
  assert.equal(ev[0].chord, "C");
  assert.ok(ev[0].slurStart && ev[2].slurEnd);
  assert.deepEqual(ev[2].arts, ["staccato", "accent"]);
  assert.equal(ev[1].hairpin, "<");
  assert.deepEqual(ev.map((e) => e.lyric?.text ?? null).slice(0, 5), ["Hel", null, null, "world", null]);
  assert.equal(back.header.title, "Test");
});

test("a pitch changed on a tied note changes every note tied to it: a tie joins one pitch", () => {
  const s = M.newScore();
  // G tied over three bars, in D flat major: the flat on G is the key's.
  s.key = -5;
  M.write(s, 0, 0, 2 * q, { rest: false, pitches: [{ d: 11, alter: 0 }] });
  M.write(s, 0, 2 * q, 6 * q, { rest: false, pitches: [{ d: 11, alter: 0 }] });
  M.toggleTie(s, 0, 0);
  const tied = s.staves[0].events.filter((e) => !e.rest);
  assert.ok(tied.length >= 3 && tied.slice(0, -1).every((e) => e.tie));
  const last = s.staves[0].events.indexOf(tied[tied.length - 1]);
  M.setAlter(s, 0, last, -1);
  assert.ok(tied.every((e) => e.pitches[0].alter === -1), "every tied note is G flat");
  M.move(s, 0, 0, "step", 1);
  assert.ok(tied.every((e) => e.pitches[0].d === 12), "and moves with the first");
  M.letter(s, 0, last, 4);
  assert.ok(tied.every((e) => e.pitches[0].d === tied[0].pitches[0].d && e.tie === tied[0].tie || e === tied[tied.length - 1]));
  assert.equal(new Set(tied.map((e) => M.spellPitch(e.pitches[0].d, e.pitches[0].alter))).size, 1);
  engrave(s);
});

test("grace notes, arpeggios, glissandi, tremolos and ornaments: written, engraved, read back", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  M.write(s, 0, q, q, { rest: false, pitches: [{ d: 7, alter: 0 }, { d: 9, alter: 0 }, { d: 11, alter: 0 }] });
  M.write(s, 0, 2 * q, q, C4);
  M.write(s, 0, 3 * q, q, { rest: false, pitches: [{ d: 14, alter: 0 }] });
  M.setGrace(s, 0, 0, "acciaccatura");
  assert.deepEqual(s.staves[0].events[0].graces, [{ pitches: [{ d: 8, alter: 0 }], base: 8, dots: 0 }]);
  M.addGrace(s, 0, 0);
  M.moveGrace(s, 0, 0, "semitone", 1);
  assert.deepEqual(s.staves[0].events[0].graces.map((g) => [M.spellPitch(g.pitches[0].d, g.pitches[0].alter), g.base]), [["d'", 16], ["f'", 16]]);
  M.toggleArpeggio(s, 0, 1);
  M.toggleGlissando(s, 0, 2);
  M.setTremolo(s, 0, 3, 16);
  M.toggleArticulation(s, 0, 3, "trill");
  M.toggleArticulation(s, 0, 1, "mordent");
  const { source } = engrave(s);
  assert.match(source, /\\acciaccatura \{ d'16 f'16 \} c'4/);
  assert.match(source, /<c' e' g'>4\\mordent\\arpeggio/);
  assert.match(source, /c'4\\glissando/);
  assert.match(source, /c''4:16\\trill/);
  const back = reread(s).staves[0].events;
  assert.equal(back[0].grace, "acciaccatura");
  assert.equal(back[0].graces.length, 2);
  assert.ok(back[1].arpeggio && back[1].arts.includes("mordent"));
  assert.ok(back[2].gliss);
  assert.equal(back[3].tremolo, 16);
  assert.ok(back[3].arts.includes("trill"));
  // The kind changes; the same kind again takes them away.
  M.setGrace(s, 0, 0, "appoggiatura");
  assert.equal(s.staves[0].events[0].grace, "appoggiatura");
  M.setGrace(s, 0, 0, "appoggiatura");
  assert.equal(s.staves[0].events[0].graces.length, 0);
  // Played: the MIDI rolls the chord and slides to the next note.
  const keys = (bytes) => {
    const out = [];
    for (let k = 0; k + 2 < bytes.length; k++) if ((bytes[k] & 0xf0) === 0x90 && bytes[k + 2] > 0 && bytes[k + 1] < 128) out.push(bytes[k + 1]);
    return out;
  };
  const played = keys(midi(M.toLilyPond(s).source, 0, 4, 0));
  for (const key of [61, 62, 63]) assert.ok(played.includes(key), `the glissando plays ${key}`);
});

test("grace notes, arpeggios, glissandi and tremolos refuse what they cannot be", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  assert.throws(() => M.setGrace(s, 0, 1, "grace"), /select a note/);
  assert.throws(() => M.toggleArpeggio(s, 0, 0), /rolls a chord/);
  assert.throws(() => M.toggleGlissando(s, 0, 0), /next note/);
  assert.throws(() => M.setTremolo(s, 0, 0, 4), /eighths, sixteenths/);
  M.setDuration(s, 0, 0, 16, 0);
  assert.throws(() => M.setTremolo(s, 0, 0, 16), /shorter than the note/);
  M.setGrace(s, 0, 0, "grace");
  assert.throws(() => M.makeTuplet(s, 0, 0, 3), /grace notes/);
  M.removeGraces(s, 0, 0);
  assert.throws(() => M.removeGraces(s, 0, 0), /no grace note/);
  // A tremolo a split note cannot keep is dropped, not written wrong.
  M.write(s, 0, q, q, C4);
  M.setTremolo(s, 0, M.eventAt(s.staves[0], q), 8);
  M.setDuration(s, 0, M.eventAt(s.staves[0], q), 8, 0);
  assert.equal(s.staves[0].events[M.eventAt(s.staves[0], q)].tremolo, 0);
  // A note becomes a rest with nothing left on it.
  M.remove(s, 0, M.eventAt(s.staves[0], 0));
  engrave(s);
});

test("a slur makes a melisma: its notes after the first take no syllable", () => {
  const s = M.newScore();
  for (const [k, d] of [7, 9, 11, 12, 14].entries()) M.write(s, 0, k * q, q, { rest: false, pitches: [{ d, alter: 0 }] });
  M.toggleSlur(s, 0, 1, 3);
  M.setLyric(s, 0, 0, "one");
  M.setLyric(s, 0, 1, "two");
  M.setLyric(s, 0, 4, "three");
  assert.deepEqual(M.melismata(s.staves[0]).slice(0, 5), [false, false, true, true, false]);
  assert.match(engrave(s).source, /\\addlyrics \{ one two three \}/);
  assert.deepEqual(reread(s).staves[0].events.map((e) => e.lyric?.text ?? null).slice(0, 5), ["one", "two", null, null, "three"]);
});

test("a tie needs a note after it; a slur on one note goes to the next, and comes off whole", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  assert.throws(() => M.toggleTie(s, 0, 0), /next note/);
  assert.throws(() => M.toggleSlur(s, 0, 0, 0), /later note/, "no later note to slur to");
  M.write(s, 0, q, q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  M.toggleSlur(s, 0, 0, 0);
  assert.ok(s.staves[0].events[0].slurStart && s.staves[0].events[1].slurEnd);
  assert.match(engrave(s).source, /c'4\( e'4\)/);
  M.toggleSlur(s, 0, 1, 1);
  assert.ok(!s.staves[0].events[0].slurStart && !s.staves[0].events[1].slurEnd, "taken off from its end");
});

test("copy and paste, over a bar line, and no tie left hanging", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  M.write(s, 0, q, 2 * q, { rest: false, pitches: [{ d: 9, alter: 0 }] });
  const clip = M.copy(s, 0, 0, 1);
  M.paste(s, 0, 2 * q, clip);
  engrave(s);
  assert.deepEqual(shape(s)[0].slice(0, 6), [["c'", q, false], ["e'", q, false], ["c'", q, false], ["e'", q, true], ["e'", q, false], ["r", 3 * q, false]]);
});

test("a new metre lays the notes out again", () => {
  const s = M.newScore();
  M.write(s, 0, 0, 4 * q, C4);
  M.setTime(s, 3, 4);
  assert.deepEqual(shape(s)[0].slice(0, 2), [["c'", 3 * q, true], ["c'", q, false]]);
  engrave(s);
});

test("staves, groups and bars", () => {
  const s = M.newScore();
  M.addStaff(s, { name: "Bass", clef: "bass" });
  assert.equal(s.group, "bracket");
  M.addBars(s, 2);
  assert.equal(M.barsOf(s), 6);
  assert.equal(M.lengthOf(s.staves[1]), M.lengthOf(s.staves[0]));
  M.removeLastBar(s);
  assert.equal(M.barsOf(s), 5);
  engrave(s);
  s.group = "brace";
  assert.match(engrave(s).source, /\\new PianoStaff/);
  M.removeStaff(s, 1);
  engrave(s);
});

test("repeats: written around their bars, with their endings, and read back", () => {
  const s = M.newScore();
  for (const [k, d] of [7, 9, 11, 12].entries()) M.write(s, 0, k * 4 * q, 4 * q, { rest: false, pitches: [{ d, alter: 0 }] });
  M.toggleRepeat(s, 0, 1);
  assert.match(engrave(s).source, /\\repeat volta 2 \{ c'1 \| e'1 \} \| g'1 \| a'1/);
  assert.deepEqual(reread(s).repeats, [{ from: 0, to: 1, endings: [] }]);

  // The repeat's last bar becomes the first ending; an empty second follows.
  M.addEndings(s, 1, 1);
  assert.deepEqual(s.repeats, [{ from: 0, to: 0, endings: [1, 1] }]);
  assert.equal(M.barsOf(s), 5);
  const { source } = engrave(s);
  assert.match(source, /\\repeat volta 2 \{ c'1 \} \\alternative \{ \{ e'1 \} \{ r1 \} \} \| g'1/);
  assert.deepEqual(reread(s).repeats, s.repeats);
  assert.deepEqual(shape(reread(s)), shape(s), "the notes read back in place");

  // A third ending, written into like any bar.
  M.addEndings(s, 0, 0);
  assert.deepEqual(s.repeats[0].endings, [1, 1, 1]);
  M.write(s, 0, 2 * 4 * q, 4 * q, { rest: false, pitches: [{ d: 8, alter: 0 }] });
  assert.match(engrave(s).source, /\\repeat volta 3 \{ c'1 \} \\alternative \{ \{ e'1 \} \{ d'1 \} \{ r1 \} \}/);
  assert.deepEqual(reread(s).repeats, s.repeats);

  M.removeRepeat(s, 0);
  assert.deepEqual(s.repeats, []);
  engrave(s);
});

test("transposing: by an interval, the key with it, spelled as the new key spells", () => {
  const names = (score, s = 0) => score.staves[s].events.filter((e) => !e.rest).map((e) => e.pitches.map((p) => M.pitchName(p.d, p.alter)).join("+"));
  const interval = (name) => M.INTERVALS.find((i) => i.name === name);
  const s = M.newScore({ key: 2 });
  // D major: f♯ a d', and a chord symbol.
  for (const [k, [d, alter]] of [[7 + 3, 1], [7 + 5, 0], [14 + 1, 0]].entries()) M.write(s, 0, k * q, q, { rest: false, pitches: [{ d, alter }] });
  M.setChordSymbol(s, 0, 0, "F#m7/C#");
  const up = interval("major second");
  M.transpose(s, { steps: up.steps, semitones: up.semitones });
  assert.equal(s.key, 4, "D major up a major second is E major");
  assert.deepEqual(names(s).slice(0, 3), ["G♯4", "B4", "E5"]);
  assert.equal(s.staves[0].events[0].chord, "G#m7/D#");
  engrave(s);
  // Down a minor third, the selection only: the key stays.
  const m3 = interval("minor third");
  M.transpose(s, { steps: -m3.steps, semitones: -m3.semitones, s: 0, a: 1, b: 1 });
  assert.equal(s.key, 4);
  assert.deepEqual(names(s).slice(0, 3), ["G♯4", "G♯4", "E5"]);
  // Past seven sharps: C♯ major up a major second is E♭ major, not D♯ — and its notes are flats.
  const cs = M.newScore({ key: 7 });
  M.write(cs, 0, 0, q, { rest: false, pitches: [{ d: 7, alter: 1 }] });
  M.transpose(cs, { steps: up.steps, semitones: up.semitones });
  assert.equal(cs.key, -3);
  assert.deepEqual(names(cs).slice(0, 1), ["E♭4"]);
  // An octave changes no letter and no key.
  const o = interval("octave");
  M.transpose(cs, { steps: o.steps, semitones: o.semitones });
  assert.equal(cs.key, -3);
  assert.deepEqual(names(cs).slice(0, 1), ["E♭5"]);
  // Every interval up and back down gives the piece back.
  for (const it of M.INTERVALS) {
    const before = JSON.stringify(s);
    M.transpose(s, { steps: it.steps, semitones: it.semitones });
    M.transpose(s, { steps: -it.steps, semitones: -it.semitones });
    assert.equal(JSON.stringify(s), before, it.name);
  }
});

test("sharing: a score goes into a link and comes back the same", async () => {
  const text = readFileSync(new URL("../../scores/ensembles/symphony-5.ly", import.meta.url), "utf8") + "\n% Été, «ça», 𝄞\n";
  const code = await M.shareCode(text);
  assert.match(code, /^[A-Za-z0-9_-]+$/, "only what a URL keeps as it is");
  assert.ok(code.length < text.length, `smaller than the text (${code.length} for ${text.length})`);
  assert.equal(await M.fromShareCode(code), text);
  // A code that is not one is refused, not read as something else.
  await assert.rejects(() => M.fromShareCode("not-a-score"));
});

test("a refusal points at its line: the brace left open, or the engraver's own place", () => {
  const refusal = (text) => {
    try {
      editor_view(text, 900, 7, -1, -1);
    } catch (e) {
      return e.message ?? String(e);
    }
    return null;
  };
  // A brace opened on line 3 and never closed: the engraver says "character 0"; it is line 3.
  const text = '\\header { title = "Été { }" }\n\\new Staff {\n  c\'4 d\'4 { e\'4 f\'4\n';
  const said = refusal(text);
  assert.match(said, /never closed \(at character 0\)/);
  const place = M.refusalPlace(said, text);
  assert.equal(place.line, 3);
  assert.equal(text.slice(place.at, place.at + 1), "{");
  assert.match(place.message, /, line 3$/);
  assert.doesNotMatch(place.message, /at character|^score:/);
  assert.match(place.message, /^A '\{' that is never closed/);
  // A brace left open inside the staff, closed at the end at the staff's indentation: that brace, line 4.
  const inside = '\\header { title = "x" }\n\\new Staff {\n  \\clef treble\n  c\'4 d\'4 { e\'4 |\n  f\'1\n}\n';
  assert.equal(M.refusalPlace("score: a '{' that is never closed (at character 0)", inside).line, 4);
  // A brace inside a string or a comment is not one.
  assert.equal(M.refusalPlace("score: a '{' that is never closed (at character 0)", '% {\n"{" { c4').line, 2);
  // The engraver's own place, counted in characters past accented letters.
  const typo = '\\header { title = "Éé" }\n\\new Staff {\n  c\'4 d\'4\n} { e\'4 f\'4\n';
  const bad = refusal(typo);
  assert.ok(bad, "refused");
  assert.match(bad, /after the end of the music/);
  const where = M.refusalPlace(bad, typo);
  assert.equal(where.line, 4);
  assert.equal(typo.slice(where.at, where.at + 1), "{");
  // No place named: nothing to point at.
  assert.equal(M.refusalPlace("score: something went wrong", "c4"), null);
});

test("instruments: every one engraves, and plays its own sound", () => {
  const names = new Set();
  M.INSTRUMENTS.forEach((it, k) => {
    assert.ok(!names.has(it.name), `${it.name} once`);
    names.add(it.name);
    if (it.drums) return; // a drum staff of its own: see the drums' test
    const s = M.newScore();
    M.write(s, 0, 0, q, C4);
    M.setInstrument(s, 0, k);
    assert.equal(M.instrumentOf(s, 0), k, it.name);
    const { source } = engrave(s);
    // The program change on the staff's channel: 0, the piano, for a name the engraver does not know.
    const bytes = midi(source, 100, 4, 0);
    const at = bytes.findIndex((b, i) => b === 0xc0 && i > 0 && bytes[i - 1] === 0);
    assert.ok(at > 0, `${it.name}: a program change`);
    if (it.sound !== "acoustic grand") assert.notEqual(bytes[at + 1], 0, `${it.name}: "${it.sound}" is a General MIDI sound`);
    assert.equal(M.programOf(it.sound), bytes[at + 1], `${it.name}: the program the engraver writes`);
  });
});

test("drums: a drum staff read, written back in \\drummode, played on the drums' channel", () => {
  const src = '\\new DrumStaff \\with { instrumentName = "Drums" } \\drummode { \\time 4/4 \\tempo 4 = 112 << { hh8 hh <hh sn> hh hho hh <hh sn> hh } \\\\ { bd4 r bd8 bd r4 } >> | <cymc bd>4 tomh8 tommh tomml toml tomfh tomfl \\bar "|." }';
  const read = M.fromParsed(JSON.parse(score_json(src)));
  assert.ok(read.score, `read: ${read.unsupported}`);
  const s = read.score;
  assert.equal(s.staves[0].drums, true);
  assert.equal(s.staves.length, 2, "the kick in a second voice");
  const names = (lane) => s.staves[lane].events.filter((e) => !e.rest).map((e) => e.pitches.map((p) => p.drum).join("+"));
  assert.deepEqual(names(0).slice(0, 5), ["hh", "hh", "hh+sn", "hh", "hho"]);
  assert.deepEqual(names(1).slice(0, 3), ["bd", "bd", "bd"]);
  const { source } = engrave(s);
  assert.match(source, /\\new DrumStaff \\with \{ instrumentName = "Drums" \} \\drummode \{/);
  assert.match(source, /<hh sn>8/);
  assert.doesNotMatch(source, /\\clef|\\key|midiInstrument/);
  assert.deepEqual(shape(reread(s)).length, shape(s).length, "reads back");
  assert.deepEqual(names(0), M.fromParsed(JSON.parse(score_json(source))).score.staves[0].events.filter((e) => !e.rest).map((e) => e.pitches.map((p) => p.drum).join("+")));
  // The drums sound on General MIDI's tenth channel: note-ons 0x99, the kick's key 36.
  const bytes = midi(source, 100, 4, 0);
  assert.ok(bytes.some((x, i) => x === 0x99 && bytes[i + 1] === 36), "a kick on channel 10");
  assert.deepEqual(M.channels(s).map((c) => c.channel), [9]);
  // Strokes are written with the drum buttons; pitches are refused.
  assert.throws(() => M.letter(s, 0, 0, 2), /drums, not pitches/);
  assert.throws(() => M.move(s, 0, 0, "step", 1), /drums, not pitches/);
  assert.throws(() => M.setAlter(s, 0, 0, 1), /drums, not pitches/);
  M.drumHit(s, 0, 0, "cymc");
  assert.deepEqual(s.staves[0].events[0].pitches.map((p) => p.drum), ["cymc"]);
  M.drumHit(s, 0, 0, "bd", true);
  assert.deepEqual(s.staves[0].events[0].pitches.map((p) => p.drum), ["bd", "cymc"], "added, low to high");
  assert.throws(() => M.drumHit(s, 0, 0, "kazoo"), /no drum called kazoo/);
  // A transposed score leaves its drums where they are.
  const before = JSON.stringify(s.staves[0]);
  M.transpose(s, { steps: 1, semitones: 2 });
  assert.equal(JSON.stringify(s.staves[0]), before);
  assert.throws(() => M.transpose(s, { steps: 1, semitones: 2, s: 0, a: 0, b: 1 }), /drums, not pitches/);
});

test("drums: a drum kit is a staff of its own, never a staff of notes changed", () => {
  const kit = M.INSTRUMENTS.findIndex((it) => it.drums);
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  assert.throws(() => M.setInstrument(s, 0, kit), /does not become a drum kit/);
  assert.equal(s.staves[0].drums, undefined, "nothing changed");
  M.addStaff(s, { drums: true, name: "Drums", short: "Dr.", instrument: "", clef: "percussion" });
  assert.equal(M.instrumentOf(s, 1), kit);
  assert.throws(() => M.setInstrument(s, 1, 0), /stays a drum staff/);
  assert.throws(() => M.drumHit(s, 0, 0, "sn"), /on a drum staff/);
  M.drumHit(s, 1, 0, "sn");
  const { source } = engrave(s);
  assert.match(source, /\\new Staff [\s\S]*\\new DrumStaff/);
  assert.deepEqual(M.channels(s).map((c) => c.channel), [0, 9]);
});

test("instruments: a staff takes the sound, the clef and the names — never a name of its own", () => {
  const s = M.newScore();
  M.write(s, 0, 0, q, C4);
  const cello = M.INSTRUMENTS.findIndex((it) => it.name === "Cello");
  const piano = M.INSTRUMENTS.findIndex((it) => it.name === "Piano");
  // A new staff is the piano, unnamed.
  assert.equal(M.instrumentOf(s, 0), piano);
  M.setInstrument(s, 0, cello);
  assert.deepEqual([s.staves[0].name, s.staves[0].short, s.staves[0].instrument, s.staves[0].clef], ["Cello", "Vc.", "cello", "bass"]);
  // The piano keeps the staff's clef; the instrument's name replaces another instrument's.
  M.setInstrument(s, 0, piano);
  assert.deepEqual([s.staves[0].name, s.staves[0].instrument, s.staves[0].clef], ["Piano", "acoustic grand", "bass"]);
  // A name the person wrote stays.
  s.staves[0].name = "Left hand";
  s.staves[0].short = "L.H.";
  M.setInstrument(s, 0, cello);
  assert.deepEqual([s.staves[0].name, s.staves[0].short, s.staves[0].instrument], ["Left hand", "L.H.", "cello"]);
  // Voices share a sound: the name tells them apart.
  const tenor = M.INSTRUMENTS.findIndex((it) => it.name === "Tenor");
  s.staves[0].name = "";
  M.setInstrument(s, 0, tenor);
  assert.equal(M.instrumentOf(s, 0), tenor);
  assert.equal(s.staves[0].clef, "treble_8");
  // A sound the menu does not offer is no instrument of it; an unknown instrument is refused.
  s.staves[0].instrument = "bagpipe";
  assert.equal(M.instrumentOf(s, 0), -1);
  assert.throws(() => M.setInstrument(s, 0, M.INSTRUMENTS.length), /no such instrument/);
  assert.equal(s.staves[0].instrument, "bagpipe", "nothing changed");
});

test("playing: every repeat played out, each pass with its ending, timed bar by bar", () => {
  const s = M.newScore();
  for (const [k, d] of [7, 9, 11, 12].entries()) M.write(s, 0, k * 4 * q, 4 * q, { rest: false, pitches: [{ d, alter: 0 }] });
  // Nothing repeated: the bars as written.
  assert.deepEqual(M.playOrder(s), [0, 1, 2, 3]);

  // A repeat without endings sounds twice.
  M.toggleRepeat(s, 0, 1);
  assert.deepEqual(M.playOrder(s), [0, 1, 0, 1, 2, 3]);
  const twice = M.toLilyPond(s, { unfold: true }).source;
  assert.doesNotMatch(twice, /\\repeat|\\alternative/);
  assert.match(twice, /c'1 \| e'1 \| c'1 \| e'1 \| g'1 \| a'1 \\bar "\|\."/);
  midi(twice, 100, 4, 0);

  // With endings: the body, ending 1, the body, ending 2.
  M.removeRepeat(s, 0);
  M.toggleRepeat(s, 0, 1);
  M.addEndings(s, 1, 1);
  assert.deepEqual(s.repeats, [{ from: 0, to: 0, endings: [1, 1] }]);
  assert.deepEqual(M.playOrder(s), [0, 1, 0, 2, 3, 4]);
  assert.match(M.toLilyPond(s, { unfold: true }).source, /c'1 \| e'1 \| c'1 \| r1 \| g'1/);

  // Three passes, one ending each; LilyPond's own count is kept apart.
  M.addEndings(s, 0, 0);
  assert.deepEqual(M.playOrder(s), [0, 1, 0, 2, 0, 3, 4, 5]);
  assert.doesNotMatch(engrave(s).source, /c'1 \| e'1 \| c'1/, "the engraving keeps its repeat signs");

  // Timed at 100 a quarter when no tempo is set: 4/4 bars of 2.4 s.
  const passes = M.playback(s);
  assert.equal(passes.length, 8);
  assert.deepEqual(passes.map((p) => p.bar), M.playOrder(s));
  assert.ok(Math.abs(passes[7].end - 8 * 2.4) < 1e-9);
  // Bar 0's first beat sounds on each of the three passes; the third beat, 1.2 s later.
  assert.deepEqual(M.playedAt(s, passes, 0).map((x) => +x.toFixed(6)), [0, 4.8, 9.6]);
  assert.deepEqual(M.playedAt(s, passes, 2 * q).map((x) => +x.toFixed(6)), [1.2, 6, 10.8]);
  assert.equal(M.passAt(passes, 5).bar, 0);
  assert.equal(M.passAt(passes, 7.3).bar, 2);
  assert.equal(M.passAt(passes, 99).bar, 5);
  assert.equal(M.passAt([], 1), null);
});

test("playing: the metronome's beats follow the metre, the speed and the repeats", () => {
  const s = M.newScore();
  M.setTimeAt(s, 2, 3, 4);
  M.toggleRepeat(s, 0, 0);
  const passes = M.playback(s);
  assert.deepEqual(M.playOrder(s), [0, 0, 1, 2, 3, 4]);
  const b = M.beats(s, passes);
  // Bar 0 twice and bar 1 in 4/4, bars 2 to 4 in 3/4: 21 beats, 0.6 s each.
  assert.equal(b.length, 21);
  assert.deepEqual(b.filter((x) => x.down).map((x) => +x.sec.toFixed(6)), [0, 2.4, 4.8, 7.2, 9, 10.8]);
  assert.ok(Math.abs(b[20].sec - 12) < 1e-9);
});

test("playing: each staff's MIDI channel, as eui-score numbers them", () => {
  const s = M.newScore();
  for (let k = 0; k < 10; k++) M.addStaff(s, { name: k === 0 ? "Flute" : "" });
  const ch = M.channels(s);
  assert.equal(ch.length, 11);
  assert.deepEqual(ch.map((c) => c.channel), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11], "the tenth channel is the drums'");
  assert.equal(ch[1].name, "Flute");
  assert.equal(ch[0].name, "Staff 1");
  // Read back from the MIDI itself: the eleventh staff plays on channel 11.
  const bytes = midi(M.toLilyPond(s).source, 100, 4, 0);
  assert.ok(bytes.some((x, i) => x === 0xcb && i > 0), "a program change on channel 11");
  assert.ok(!bytes.some((x, i) => x === 0xc9 && bytes[i - 1] === 0), "none on the drums' channel");
});

test("playing: a jump back says again the speed and metre it returns to", () => {
  const s = M.newScore();
  M.ensureLength(s, 4 * 4 * q);
  M.setTempoAt(s, 1, { text: "", base: 4, bpm: 50 });
  M.toggleRepeat(s, 0, 1);
  // Bar 1 is twice as slow; back to bar 0, the speed is 100 again.
  const passes = M.playback(s);
  assert.deepEqual(passes.map((p) => +(p.end - p.start).toFixed(6)), [2.4, 4.8, 2.4, 4.8, 4.8, 4.8]);
  const source = M.toLilyPond(s, { unfold: true }).source;
  assert.match(source, /\\tempo 4 = 50 r1 \| \\tempo 4 = 100 r1 \| \\tempo 4 = 50 r1/);
  midi(source, 100, 4, 0);

  // A metre change inside the repeat: the bar played again is in its own metre.
  const m = M.newScore();
  M.ensureLength(m, 4 * 4 * q);
  M.setTempoAt(m, 1, { text: "", base: 4, bpm: 50 });
  M.setTimeAt(m, 1, 3, 4);
  M.toggleRepeat(m, 0, 1);
  const metre = M.toLilyPond(m, { unfold: true }).source;
  assert.match(metre, /\\time 3\/4 [^|]*\| \\time 4\/4 [^|]*r1 \| \\time 3\/4/);
  midi(metre, 100, 4, 0);
  const bar1 = M.playback(m)[1];
  assert.ok(Math.abs(bar1.end - bar1.start - 3.6) < 1e-9, "a 3/4 bar at 50 a quarter");
});

test("repeats refuse what does not fit, and follow the bars around them", () => {
  const s = M.newScore();
  M.toggleRepeat(s, 1, 2);
  assert.throws(() => M.toggleRepeat(s, 2, 3), /already in a repeat/);
  assert.throws(() => M.addEndings(s, 3, 3), /select the bars of a repeat/);
  assert.throws(() => M.addEndings(s, 1, 1), /up to its end/);
  M.insertBars(s, 0, 1);
  assert.deepEqual(s.repeats, [{ from: 2, to: 3, endings: [] }], "a bar before moves it along");
  M.toggleRepeat(s, 2, 3);
  M.toggleRepeat(s, 3, 4);
  assert.throws(() => M.removeLastBar(s), /in a repeat/);
  M.setTime(s, 2, 4);
  assert.deepEqual(s.repeats, [{ from: 6, to: 9, endings: [] }], "in 2/4, twice the bars");
  engrave(s);
  M.setTime(s, 4, 4);
  assert.deepEqual(s.repeats, [{ from: 3, to: 4, endings: [] }]);
  M.setTime(s, 2, 4);
  assert.throws(() => M.setTime(s, 3, 4), /inside bars/);
});

test("a repeat's edges move, and selected bars become its endings", () => {
  const s = M.newScore();
  M.addBars(s, 4);
  M.toggleRepeat(s, 0, 3);
  assert.equal(M.endingFromBars(s, 2, 3), 1);
  assert.deepEqual(s.repeats, [{ from: 0, to: 1, endings: [2, 2] }], "its last bars: ending 1., the two after: 2.");
  assert.equal(M.barsOf(s), 8, "the bars after it are taken, none added");
  assert.equal(M.endingFromBars(s, 6, 6), 2);
  assert.deepEqual(s.repeats, [{ from: 0, to: 1, endings: [2, 2, 1] }], "the bar after: ending 3.");
  assert.throws(() => M.endingFromBars(s, 9, 9), /right after a repeat/);
  assert.throws(() => M.setRepeat(s, 0, { endings: [1] }), /two endings/);
  M.setRepeat(s, 0, { endings: [1, 3] });
  assert.match(engrave(s).source, /\\repeat volta 2 \{ r1 \| r1 \} \\alternative \{ \{ r1 \} \{ r1 \| r1 \| r1 \} \}/);
  assert.deepEqual(reread(s).repeats, s.repeats);
  assert.throws(() => M.setRepeat(s, 0, { to: -1 }), /one bar/);
  assert.throws(() => M.setRepeat(s, 0, { endings: [1, 9] }), /past the last bar/);
  M.toggleRepeat(s, 6, 7);
  assert.throws(() => M.setRepeat(s, 0, { endings: [1, 5] }), /into another/);
});

test("the bar after a plain repeat is its first ending, and the bar after that its second", () => {
  const s = M.newScore();
  M.toggleRepeat(s, 0, 2);
  M.endingFromBars(s, 3, 3);
  assert.deepEqual(s.repeats, [{ from: 0, to: 2, endings: [1, 1] }]);
  assert.equal(M.barsOf(s), 5, "the piece ended at ending 1.: a bar is added for ending 2.");
  const text = engrave(s).source;
  assert.match(text, /\\alternative \{ \{ r1 \} \{ r1 \} \}/);
  assert.deepEqual(reread(s).repeats, s.repeats);
});

test("a second voice is a lane of its own, written in the bars where it sounds", () => {
  const back = M.fromParsed(JSON.parse(score_json(readFileSync(new URL("../../scores/syntax/voices.ly", import.meta.url), "utf8"))));
  assert.ok(back.score, back.unsupported?.join());
  const s = back.score;
  assert.equal(s.staves.length, 2);
  assert.equal(s.staves[1].voice, 2);
  assert.deepEqual(M.staffLanes(s), [0]);
  assert.equal(M.upperOf(s, 1), 0);
  assert.equal(M.lowerOf(s, 0), 1);
  assert.equal(M.lengthOf(s.staves[1]), M.lengthOf(s.staves[0]), "the voices last as long");
  const { source } = engrave(s);
  assert.match(source, /<< \{ b'4 c''4 d''2 \} \\\\ \{ g'4 a'4 b'2 \} >> \| << \{ c''8 b'8 a'8 g'8 fis'2 \} \\\\ \{ e'4 e'4 d'2 \} >> \| g'1/);
  assert.deepEqual(reread(s).staves.map((l) => l.events.length), s.staves.map((l) => l.events.length));
});

test("a voice is added, written in, opened where it is empty, and taken away", () => {
  const s = M.newScore();
  const lane = M.addVoice(s, 0);
  assert.equal(lane, 1);
  assert.equal(M.addVoice(s, 1), 1, "a staff has two voices at most");
  assert.doesNotMatch(engrave(s).source, /\\\\/, "a voice of rests is not written");
  assert.match(M.toLilyPond(s, { open: [{ staff: 1, bar: 2 }] }).source, /r1 \| r1 \| << \{ r1 \} \\\\ \{ r1 \} >> \| r1/, "where the page writes in it, it is");
  M.write(s, lane, M.notated(4), M.notated(2), { rest: false, pitches: [{ d: 5, alter: 0 }] });
  assert.match(engrave(s).source, /<< \{ r1 \} \\\\ \{ r4 a2 r4 \} >> \| r1/);
  assert.throws(() => M.setLyric(s, lane, 1, "la"), /first voice/);
  M.addStaff(s);
  assert.deepEqual(M.staffLanes(s), [0, 2]);
  assert.equal(M.staffNumber(s, 2), 1);
  M.removeVoice(s, 0);
  assert.equal(s.staves.length, 2);
  assert.throws(() => M.removeVoice(s, 0), /one voice/);
});

test("staff groups nest, and a staff keeps a key of its own", () => {
  const back = M.fromParsed(JSON.parse(score_json(readFileSync(new URL("../../scores/ensembles/chamber-orchestra.ly", import.meta.url), "utf8"))));
  assert.ok(back.score, back.unsupported?.join());
  const s = back.score;
  assert.equal(s.group, "none");
  assert.deepEqual(s.groups.map((g) => [g.kind, g.first, g.last]), [["bracket", 0, 1], ["bracket", 2, 4]]);
  const { source } = engrave(s);
  assert.equal(source.match(/\\new StaffGroup <</g).length, 2);
  assert.deepEqual(reread(s).groups, s.groups);
  M.removeStaff(s, 0);
  assert.deepEqual(s.groups.map((g) => [g.first, g.last]), [[0, 0], [1, 3]], "the groups close up");

  const horns = M.fromParsed(JSON.parse(score_json(readFileSync(new URL("../../scores/ensembles/symphony-5.ly", import.meta.url), "utf8")))).score;
  assert.ok(horns);
  const corni = M.staffLanes(horns).find((l) => horns.staves[l].name === "Corni");
  assert.equal(M.keyOf(horns, corni), -3, "the horns in E flat");
  assert.equal(M.keyOf(horns, 0), horns.key);
  M.setKey(horns, horns.key + 1);
  assert.equal(M.keyOf(horns, corni), -2, "they move with the score's key");
  M.setStaffKey(horns, corni, horns.key);
  assert.equal(horns.staves[corni].key, undefined, "the score's key again");
  const metres = (src) => M.fromParsed(JSON.parse(score_json(src)));
  const six = metres(String.raw`<< \new Staff { \time 3/4 c'2. } \new Staff { \time 6/8 c'2. } >>`).score;
  assert.deepEqual(six.staves[1].time, [6, 8], "6/8 beside 3/4: bars as long");
  assert.match(engrave(six).source, /\\time 6\/8/);
  assert.deepEqual(metres(String.raw`<< \new Staff { \time 3/4 c'2. } \new Staff { \time 4/4 c'1 } >>`).unsupported, ["staves whose bars last differently"]);
});

test("key, metre and tempo change anywhere, and read back", () => {
  const back = M.fromParsed(JSON.parse(score_json(readFileSync(new URL("../../scores/piano/little-suite.ly", import.meta.url), "utf8"))));
  assert.ok(back.score, back.unsupported?.join());
  const s = back.score;
  assert.deepEqual(s.changes.map((c) => [c.bar, c.key, c.time.join("/"), c.tempo.text, c.line]), [
    [16, -2, "4/4", "Andante", "||"], [24, 2, "6/8", "Vivace", "||"], [32, -1, "5/4", "Maestoso", "||"], [44, 3, "2/2", "Presto", "||"],
  ]);
  assert.equal(M.barStart(s, 16), 16 * M.barLength(s));
  assert.equal(M.barLength(s, 24), M.notated(8) * 6);
  assert.equal(M.barAt(s, M.barStart(s, 25) + 1), 25);
  const { source } = engrave(s);
  assert.match(source, /\| *\n? *\\bar "\|\|" \\key bes \\major \\time 4\/4 \\tempo "Andante" 4 = 72 f'4\(/);
  assert.deepEqual(reread(s).changes, s.changes);
  // A letter in the new key is spelled in it: F sharp in D major.
  const i = M.eventAt(s.staves[0], M.barStart(s, 24));
  M.letter(s, 0, i, 3);
  assert.equal(s.staves[0].events[i].pitches[0].alter, 1);
  assert.equal(M.tempoAt(s, 30).bpm, 160);
  assert.ok(M.secondsAt(s, M.barStart(s, 17)) > M.secondsAt(s, M.barStart(s, 16)));
  assert.ok(Math.abs(M.ticksAtSeconds(s, M.secondsAt(s, M.barStart(s, 30))) - M.barStart(s, 30)) < 1);
});

test("a metre from a bar on lays the music out again, up to the next change", () => {
  const s = M.newScore();
  M.write(s, 0, 0, 2 * M.WHOLE, C4);
  M.setTimeAt(s, 1, 3, 4);
  assert.deepEqual(s.changes, [{ bar: 1, time: [3, 4] }]);
  assert.equal(M.barsOf(s), 5, "three bars of 4/4 make four of 3/4");
  assert.match(engrave(s).source, /c'1~ \| \\time 3\/4 c'2\.~ \| c'4 r2 \| r2\. \|/);
  M.setKeyAt(s, 2, 2);
  M.setTempoAt(s, 2, { text: "Vivo", base: 4, bpm: 140 });
  M.setClefAt(s, 0, 3, "bass");
  M.setDoubleBar(s, 3, true);
  assert.match(engrave(s).source, /\\key d \\major \\tempo "Vivo" 4 = 140 c'4 r2 \| \\bar "\|\|" \\clef bass r2\./);
  assert.deepEqual(reread(s).changes, s.changes);
  assert.deepEqual(reread(s).staves[0].clefs, [{ bar: 3, clef: "bass" }]);
  M.setKeyAt(s, 2, 0);
  assert.equal(M.changeAt(s, 2).key, undefined, "the key in force already: no change");
  M.setClefAt(s, 0, 3, "treble");
  assert.equal(s.staves[0].clefs, undefined);
  // Back to 4/4 from bar 1: the tempo of bar 2 would fall inside a bar.
  assert.throws(() => M.setTimeAt(s, 1, 4, 4), /inside bars/);
  assert.equal(M.barsOf(s), 5, "a refusal changes nothing");
  M.setTempoAt(s, 2, null);
  M.setDoubleBar(s, 3, false);
  assert.deepEqual(s.changes, [{ bar: 1, time: [3, 4] }]);
  M.setTimeAt(s, 1, 4, 4);
  assert.equal(M.changeAt(s, 1), null, "the metre in force already: no change");
  assert.equal(M.barsOf(s), 4);
  // A middle stretch must make whole bars of the new metre.
  M.setTimeAt(s, 3, 3, 4);
  assert.throws(() => M.setTimeAt(s, 1, 3, 4), /whole bars of 3\/4/);
  M.insertBars(s, 1, 1);
  assert.equal(M.changeAt(s, 4).time.join("/"), "3/4", "the changes move with the bars");
  M.tupletAt(s, 0, M.barStart(s, 1), M.notated(4), 3);
  assert.throws(() => M.setTimeAt(s, 1, 2, 4), /tuplets/);
  assert.throws(() => M.setDoubleBar(s, 0, true), /between two bars/);
});

test("bar-line repeat signs read as a repeat", () => {
  const back = M.fromParsed(JSON.parse(score_json(String.raw`{ \time 2/4 c'2 \bar ".|:" d'2 | e'2 \bar ":|." g'2 \bar "|." }`)));
  assert.ok(back.score, back.unsupported?.join());
  assert.deepEqual(back.score.repeats, [{ from: 1, to: 2, endings: [] }]);
});

test("every gallery piece reads into the model, or says what it uses", () => {
  const root = new URL("../../scores/", import.meta.url);
  let read = 0;
  for (const dir of readdirSync(root)) {
    for (const file of readdirSync(new URL(`${dir}/`, root))) {
      const src = readFileSync(new URL(`${dir}/${file}`, root), "utf8");
      const result = M.fromParsed(JSON.parse(score_json(src)));
      if (result.unsupported) {
        assert.ok(result.unsupported.length > 0);
        continue;
      }
      read++;
      // Written back and read again, the notes are the same.
      const before = shape(result.score);
      engrave(result.score);
      assert.deepEqual(shape(reread(result.score)), before, `${dir}/${file}`);
    }
  }
  assert.ok(read > 20, `${read} pieces read`);
});
