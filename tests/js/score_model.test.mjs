// The editor's model, engraved by the real engraver (the WebAssembly module
// the site ships): every edit must give LilyPond eui-score accepts, and a
// score must read back as itself.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import init, { editor_view, score_json } from "../../public/eui-score/eui_score_web.js";
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
