// MusicXML carries the signs of #1039: an arpeggio's styles, a tremolo
// between two notes, the sostenuto and the soft pedal, every ornament and
// fermata, bowings and an organist's feet, shape notes — written as
// MusicXML names them where it does, and read back into the same score;
// and read from files other programs write.
//
//   node --test tests/js/musicxml_signs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { fromMusicXML, toMusicXML } from "../../public/eui-score/musicxml.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

function withSpans(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
}

function open(src) {
  const read = M.fromParsed(withSpans(src), src, { parse: withSpans });
  assert.ok(read.score, `opens: ${read.unsupported}\n${src}`);
  return read.score;
}

/** A text through MusicXML and back: { xml, text (as the model writes the piece), back (the same after MusicXML), warnings }. */
function through(src) {
  const score = open(src);
  const xml = toMusicXML(score);
  const read = fromMusicXML(xml);
  return { xml, text: M.toLilyPond(score).source, back: M.toLilyPond(open(read.source)).source, warnings: read.warnings };
}

/** A whole MusicXML file around one part's measures. */
const file = (measures, software = "Another program") => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><identification><encoding><software>${software}</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
<part id="P1">${measures}</part></score-partwise>`;
const attributes = "<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>";
const note = (step, more = "", octave = 5, type = "quarter", duration = 4) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${more}</note>`;

test("an arpeggio's styles: arrows as <arpeggiate direction>, a bracket as <non-arpeggiate>, and back", () => {
  const r = through("{ \\time 4/4 \\arpeggioBracket <c' e' g'>4\\arpeggio \\arpeggioArrowDown <c' e' g'>\\arpeggio \\arpeggioParenthesis <c' e' g'>\\arpeggio \\arpeggioArrowUp <d' f'>\\arpeggio | \\arpeggioNormal <c' e'>1\\arpeggio }");
  assert.equal(r.back, r.text);
  assert.deepEqual(r.warnings, []);
  // A bracket on the chord's lowest and highest notes; an arrow on each note of its chord.
  assert.equal(r.xml.match(/<non-arpeggiate type="bottom"\/>/g).length, 1);
  assert.equal(r.xml.match(/<non-arpeggiate type="top"\/>/g).length, 1);
  assert.equal(r.xml.match(/<arpeggiate direction="down"\/>/g).length, 3);
  assert.equal(r.xml.match(/<arpeggiate direction="up"\/>/g).length, 2);
  // A parenthesis, which MusicXML has not: a rolled chord any reader shows, and this editor's word for the rest.
  assert.equal(r.xml.match(/<other-notation type="single">arpeggio-parenthesis<\/other-notation>/g).length, 1);
  assert.equal(r.xml.match(/<arpeggiate\/>/g).length, 3 + 2);
});

test("an arpeggio from another program: its direction, a bracket said on the top note only", () => {
  const chord = (first, second) => note("C", first, 4) + `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>${second}</note>`;
  const xml = file(`<measure number="1">${attributes}${chord('<notations><arpeggiate direction="up"/></notations>', '<notations><arpeggiate direction="up"/></notations>')}${chord("", '<notations><non-arpeggiate type="top"/></notations>')}${chord("<notations><arpeggiate/></notations>", "")}${note("D")}</measure>`);
  const { source } = fromMusicXML(xml);
  assert.match(source, /\\arpeggioArrowUp <c' e'>4\\arpeggio \\arpeggioNormal \\arpeggioBracket <c' e'>4\\arpeggio \\arpeggioNormal <c' e'>4\\arpeggio d''4/);
  open(source);
});

test("a tremolo between two notes: <tremolo type=start/stop>, each note drawn as long as the two, and back", () => {
  const r = through("{ \\time 4/4 \\repeat tremolo 4 { c''16 e'' } \\repeat tremolo 2 { <c' e'>32 g' } r8 d''4 | \\repeat tremolo 8 { c''16 e'' } | c''2:16 d''2 }");
  assert.equal(r.back, r.text);
  assert.deepEqual(r.warnings, []);
  // Two quarters of tremolo are two half notes, two in the time of one; their beams are the strokes'.
  assert.match(r.xml, /<duration>\d+<\/duration><voice>1<\/voice><type>half<\/type><time-modification><actual-notes>2<\/actual-notes><normal-notes>1<\/normal-notes><\/time-modification>.*?<tremolo type="start">2<\/tremolo>/s);
  assert.equal(r.xml.match(/<tremolo type="start">/g).length, 3);
  assert.equal(r.xml.match(/<tremolo type="stop">/g).length, 3);
  assert.equal(r.xml.match(/<tremolo type="start">3<\/tremolo>/g).length, 1, "thirty-seconds are three beams");
  // The tremolo on one note is still one note's.
  assert.equal(r.xml.match(/<tremolo type="single">2<\/tremolo>/g).length, 1);
  // No tuplet comes of "two in the time of one".
  assert.ok(!r.back.includes("\\tuplet"));
});

test("a tremolo between two notes from another program, with no time-modification said", () => {
  const half = (step, type) => note(step, `<notations><ornaments><tremolo type="${type}">2</tremolo></ornaments></notations>`, 5, "half", 4);
  const { source } = fromMusicXML(file(`<measure number="1">${attributes}${half("C", "start")}${half("E", "stop")}${note("D", "", 5, "half", 8)}</measure>`));
  assert.match(source, /\\repeat tremolo 4 \{ c''16 e''16 \} d''2/);
  assert.equal(M.tremoloPairOf(open(source), 0, 0), 16);
});

test("the sostenuto pedal is MusicXML's second pedal; the soft pedal its words and <sound soft-pedal>", () => {
  const r = through("{ \\time 4/4 c''4\\sustainOn\\sostenutoOn\\unaCorda d''\\sostenutoOff\\sostenutoOn e''\\sustainOff\\sostenutoOff f''\\treCorde }");
  assert.equal(r.back, r.text);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.xml.match(/<pedal type="sostenuto" number="2" line="yes"\/>/g).length, 2);
  assert.equal(r.xml.match(/<pedal type="stop" number="2"\/>/g).length, 2);
  assert.match(r.xml, /<words font-style="italic">una corda<\/words><\/direction-type><sound soft-pedal="yes"\/>/);
  assert.match(r.xml, /<words font-style="italic">tre corde<\/words><\/direction-type><sound soft-pedal="no"\/>/);
  // The sustain pedal is still the first, and neither pedal's sign comes back as words.
  assert.equal(r.xml.match(/<pedal type="start" line="no" sign="yes"\/>/g).length, 1);
  assert.ok(!/"una corda"|"tre corde"|Sost/.test(r.back), r.back);
});

test("a sostenuto pedal from another program: said by its type, with no number", () => {
  const dir = (inner) => `<direction placement="below"><direction-type>${inner}</direction-type></direction>`;
  const { source } = fromMusicXML(file(`<measure number="1">${attributes}${dir('<pedal type="sostenuto"/>')}${note("C")}${dir('<pedal type="start"/>')}${note("D")}${dir('<pedal type="stop"/>')}${note("E")}${note("F")}</measure>`));
  assert.match(source, /c''4\\sostenutoOn d''4\\sustainOn e''4\\sustainOff f''4/);
});

test("every ornament: MusicXML's own element, with what it says of its start and its end, and back", () => {
  const r = through("{ \\time 4/4 c''4\\upmordent d''_\\prallup e''^\\haydnturn f''\\slashturn | c''\\reverseturn d''\\prallprall e''\\prallmordent f''\\upprall | c''\\downprall d''\\downmordent e''\\lineprall f''\\pralldown | c''\\trill d''\\prall e''\\mordent f''\\turn }");
  assert.equal(r.back, r.text);
  assert.deepEqual(r.warnings, []);
  for (const element of ['<mordent approach="below"/>', '<inverted-mordent placement="below" long="yes" departure="above"/>', '<haydn placement="above"/>', '<turn slash="yes"/>', "<inverted-turn/>", '<inverted-mordent long="yes"/>', '<mordent long="yes"/>', '<inverted-mordent long="yes" approach="below"/>', '<inverted-mordent long="yes" approach="above"/>', '<mordent approach="above"/>', '<inverted-mordent approach="above"/>', '<inverted-mordent long="yes" departure="below"/>', "<trill-mark/>", "<inverted-mordent/>", "<mordent/>", "<turn/>"]) {
    assert.ok(r.xml.includes(element), element);
  }
  // Each of the model's ornaments has its element, and no two the same.
  const written = M.ARTICULATION_FAMILIES.ornaments.map((name) => /<ornaments>(.*?)<\/ornaments>/.exec(toMusicXML(open(`{ \\time 4/4 c''1\\${name} }`)))?.[1]);
  assert.ok(written.every(Boolean), "each is an <ornaments> element");
  assert.equal(new Set(written).size, written.length);
});

test("an ornament from another program that says more than LilyPond draws is the plain one", () => {
  const orn = (inner) => `<notations><ornaments>${inner}</ornaments></notations>`;
  const { source, warnings } = fromMusicXML(file(`<measure number="1">${attributes}${note("C", orn('<mordent long="yes" approach="below" departure="above"/>'))}${note("D", orn('<inverted-turn placement="below"/>'))}${note("E", orn("<haydn/>"))}${note("F", orn("<shake/>"))}</measure>`));
  assert.match(source, /c''4\\mordent d''4_\\reverseturn e''4\\haydnturn f''4/);
  assert.deepEqual(warnings, ["some ornaments"], "a sign it does not read is said");
});

test("a fermata's length is its shape, over or under, on a note or a rest, and back", () => {
  const r = through("{ \\time 4/4 c''4\\shortfermata d''\\longfermata e''\\veryshortfermata f''_\\verylongfermata | c''\\henzeshortfermata d''\\henzelongfermata e''\\fermata r4\\longfermata }");
  assert.equal(r.back, r.text);
  for (const element of ["<fermata>angled</fermata>", "<fermata>square</fermata>", "<fermata>double-angled</fermata>", '<fermata type="inverted">double-square</fermata>', "<fermata>half-curve</fermata>", "<fermata>double-dot</fermata>", "<fermata/>"]) assert.ok(r.xml.includes(element), element);
  assert.equal(r.xml.match(/<fermata>square<\/fermata>/g).length, 2, "the rest's too");
  // From another program: "normal", and a shape LilyPond has not.
  const fermata = (shape) => `<notations><fermata type="upright">${shape}</fermata></notations>`;
  const { source } = fromMusicXML(file(`<measure number="1">${attributes}${note("C", fermata("normal"))}${note("D", fermata("curlew"))}${note("E", fermata("double-square"))}${note("F")}</measure>`));
  assert.match(source, /c''4\^\\fermata d''4\^\\fermata e''4\^\\verylongfermata f''4/);
});

test("bowings, a harmonic, a thumb, heels and toes are <technical>; what MusicXML has no name for goes by LilyPond's", () => {
  const r = through("{ \\time 4/4 c''4\\upbow d''\\downbow e''\\flageolet f''\\snappizzicato | c''\\thumb d''\\lheel e''\\rtoe f''\\halfopen | c''\\espressivo d''\\segno e''\\accentus f''\\varcoda | c''\\ltoe d''\\rheel e''\\halfopenvertical f''\\open }");
  assert.equal(r.back, r.text);
  assert.deepEqual(r.warnings, []);
  for (const element of ["<technical><up-bow/></technical>", "<down-bow/>", "<harmonic/>", "<snap-pizzicato/>", "<thumb-position/>", '<heel placement="below"/>', '<toe placement="above"/>', "<half-muted/>", '<toe placement="below"/>', '<heel placement="above"/>', "<open-string/>"]) assert.ok(r.xml.includes(element), element);
  for (const name of ["espressivo", "segno", "accentus", "varcoda", "halfopenvertical"]) assert.ok(r.xml.includes(`<other-articulation>${name}</other-articulation>`), name);
  // A fingering beside a bowing: one <technical> for both.
  assert.match(toMusicXML(open("{ \\time 4/4 c''1-2\\upbow }")), /<technical><up-bow\/><fingering>2<\/fingering><\/technical>/);
  // Every sign the tools offer is written, and read back as itself.
  for (const name of Object.values(M.ARTICULATION_FAMILIES).flat()) {
    const one = through(`{ \\time 4/4 c''1\\${name} }`);
    assert.equal(one.back, one.text, name);
  }
  // Another program's <other-articulation> this editor does not know is said, not guessed.
  const read = fromMusicXML(file(`<measure number="1">${attributes}${note("C", "<notations><articulations><other-articulation>wobble</other-articulation></articulations></notations>", 5, "whole", 16)}</measure>`));
  assert.match(read.source, /c''1 /);
  assert.deepEqual(read.warnings, ["some articulations"]);
});

test("shape notes: each head's <notehead> by its degree of the key, the set by its name, and back", () => {
  const r = through("{ \\key g \\major \\time 4/4 \\funkHeads g'4 a' b' c'' | d'' e'' fis'' g'' }");
  assert.equal(r.back, r.text);
  assert.deepEqual([...r.xml.matchAll(/<notehead>([a-z]+)<\/notehead>/g)].map((m) => m[1]), ["do", "re", "mi", "fa", "so", "la", "ti", "do"]);
  assert.match(r.xml, /<miscellaneous-field name="lilypond-heads">\{&quot;P1:1&quot;:&quot;funkHeads&quot;\}<\/miscellaneous-field>/);
  // The four shapes of the Sacred Harp, in a minor key: counted from its relative major. The other staff keeps its heads.
  const four = through("<< \\new Staff { \\key a \\minor \\time 4/4 \\sacredHarpHeadsMinor a'4 b' c'' d'' } \\new Staff { \\clef bass \\key a \\minor a1 } >>");
  assert.equal(four.back, four.text);
  assert.deepEqual([...four.xml.matchAll(/<notehead>([a-z]+)<\/notehead>/g)].map((m) => m[1]), ["la", "mi", "fa", "so"]);
  // A chord's every head has its shape; a drum staff none.
  assert.equal(toMusicXML(open("{ \\time 4/4 \\aikenHeads <c' e' g'>1 }")).match(/<notehead>/g).length, 3);
});

test("shape notes from another program: seven shapes are Aiken's, four the Sacred Harp's; round heads stay round", () => {
  const head = (name) => `<notehead>${name}</notehead>`;
  const seven = fromMusicXML(file(`<measure number="1">${attributes}${note("C", head("do"))}${note("D", head("re"))}${note("E", head("mi"))}${note("F", head("fa"))}</measure>`));
  assert.match(seven.source, /\\aikenHeads/);
  assert.equal(M.shapeNotesOf(open(seven.source), 0), "aikenHeads");
  const four = fromMusicXML(file(`<measure number="1">${attributes}${note("C", head("fa"))}${note("D", head("so"))}${note("E", head("la"))}${note("F", head("fa"))}</measure>`));
  assert.match(four.source, /\\sacredHarpHeads/);
  const round = fromMusicXML(file(`<measure number="1">${attributes}${note("C", head("normal"))}${note("D", head("x"))}${note("E")}${note("F")}</measure>`));
  assert.ok(!/Heads/.test(round.source), round.source);
});

test("a piano's name beside its brace, and a bar's rest written as one, go through MusicXML", () => {
  const piano = through("\\new PianoStaff \\with { instrumentName = \"Piano\" shortInstrumentName = \"Pno.\" } << \\new Staff { \\time 3/4 c''2. | R2. } \\new Staff { \\clef bass c2. | r2. } >>");
  assert.equal(piano.back, piano.text);
  assert.match(piano.text, /\\new PianoStaff \\with \{ instrumentName = "Piano" shortInstrumentName = "Pno\." \}/);
  assert.equal(piano.xml.match(/<rest measure="yes"\/>/g).length, 1, "the rest written R2., not the one written r2.");
});
