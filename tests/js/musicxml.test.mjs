// MusicXML in and out (public/eui-score/musicxml.js), checked against the
// real engraver: what a file from another program holds must read back as a
// score the editor can open, and a score written out must come back as itself.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The editor's score for a LilyPond text, or a failure naming what it could not read. */
function scoreOf(source) {
  const read = M.fromParsed(JSON.parse(score_json(source)));
  assert.ok(read.score, `the editor reads it back (${(read.unsupported ?? []).join(", ")})\n${source}`);
  return read.score;
}

const partwise = (parts, partList, head = "") =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${head}<part-list>${partList}</part-list>${parts}</score-partwise>`;

/** Each lane's voice and events, as notes or rests with their lengths. */
const shapeOf = (score) => score.staves.map((l) => [l.voice ?? 1, l.events.map((ev) => (ev.rest ? (ev.spacer ? "s" : "r") : M.spellPitch(ev.pitches[0].d, ev.pitches[0].alter)) + M.ticksOf(ev))]);

const note = (step, octave, duration, type, extra = "") => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}<type>${type}</type></note>`;

test("musicxml: every gallery score the editor reads comes back as itself", () => {
  const dir = new URL("../../scores/", import.meta.url);
  let checked = 0;
  for (const group of readdirSync(dir)) {
    for (const file of readdirSync(new URL(`${group}/`, dir)).filter((f) => f.endsWith(".ly"))) {
      const read = M.fromParsed(JSON.parse(score_json(readFileSync(new URL(`${group}/${file}`, dir), "utf8"))));
      if (!read.score) continue;
      // A line of chord names goes out as MusicXML's chord symbols, which come back over the notes (chord_names.test.mjs).
      if (read.score.staves.some((st) => st.chords)) continue;
      const { source, warnings } = X.fromMusicXML(X.toMusicXML(read.score));
      assert.deepEqual(warnings, [], `${group}/${file}: nothing left out`);
      assert.equal(M.toLilyPond(scoreOf(source)).source, M.toLilyPond(read.score).source, `${group}/${file}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `${checked} scores checked`);
});

test("musicxml: a piano piece as MuseScore writes it — two staves, two voices, backups", () => {
  const xml = partwise(
    `<part id="P1">
      <measure number="0">
        <attributes><divisions>480</divisions><key><fifths>-1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time>
          <staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
        <direction placement="above"><direction-type><words font-weight="bold">Andante</words></direction-type><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>
        ${note("C", 5, 480, "quarter", "<voice>1</voice>").replace("<type>", "<type>").replace("</note>", "<staff>1</staff></note>")}
        <note><rest/><duration>960</duration><voice>1</voice><type>half</type><staff>1</staff></note>
        <backup><duration>1440</duration></backup>
        <note><rest measure="yes"/><duration>1440</duration><voice>5</voice><staff>2</staff></note>
      </measure>
      <measure number="1">
        <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>
        <note><pitch><step>F</step><octave>5</octave></pitch><duration>960</duration><tie type="start"/><voice>1</voice><type>half</type><stem>up</stem><staff>1</staff><notations><tied type="start"/><slur type="start" number="1"/></notations></note>
        <note><pitch><step>F</step><octave>5</octave></pitch><duration>480</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/><slur type="stop" number="1"/></notations></note>
        <backup><duration>1440</duration></backup>
        <note><pitch><step>A</step><octave>4</octave></pitch><duration>1440</duration><voice>2</voice><type>half</type><dot/><stem>down</stem><staff>1</staff></note>
        <backup><duration>1440</duration></backup>
        <note><pitch><step>F</step><octave>3</octave></pitch><duration>1440</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
        <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>1440</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
        <barline location="right"><bar-style>light-heavy</bar-style></barline>
      </measure>
    </part>`,
    `<score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part>`,
    `<work><work-title>Little Waltz</work-title></work><identification><creator type="composer">A. Composer</creator></identification>`,
  );
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /title = "Little Waltz"/);
  assert.match(source, /composer = "A\. Composer"/);
  assert.match(source, /\\new PianoStaff \\with \{ instrumentName = "Piano" \}/);
  assert.match(source, /\\tempo "Andante" 4 = 72/);
  const score = scoreOf(source);
  assert.equal(score.header.title, "Little Waltz");
  assert.equal(score.key, -1);
  assert.deepEqual(score.time, [3, 4]);
  assert.deepEqual(score.tempo, { text: "Andante", base: 4, bpm: 72 });
  // Two staves, the upper with its second voice; the tie, the slur and the p on the first note.
  assert.equal(score.staves.length, 3);
  assert.equal(score.staves[1].voice, 2);
  assert.equal(score.staves[2].clef, "bass");
  const tune = score.staves[0].events.filter((ev) => !ev.rest);
  assert.deepEqual(tune.map((ev) => [M.pitchName(ev.pitches[0].d, ev.pitches[0].alter), ev.base, ev.tie]), [["C5", 4, false], ["F5", 2, true], ["F5", 4, false]]);
  assert.equal(tune[1].dynamic, "p");
  assert.ok(tune[1].slurStart && tune[2].slurEnd);
  const bass = score.staves[2].events.filter((ev) => !ev.rest);
  assert.deepEqual(bass[0].pitches.map((p) => M.pitchName(p.d, p.alter)), ["F3", "C4"]);
  assert.equal(bass[0].dots, 1);
});

test("musicxml: a pickup bar is kept as LilyPond writes it, and the editor edits it", () => {
  const xml = partwise(
    `<part id="P1"><measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note("D", 5, 2, "quarter")}</measure>
      <measure number="1">${note("G", 5, 6, "half", "<dot/>")}</measure></part>`,
    `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
  );
  const { source } = X.fromMusicXML(xml);
  assert.match(source, /\\time 3\/4 \\clef treble \\partial 4 d''4 \| g''2\./);
  const parsed = JSON.parse(score_json(source));
  assert.equal(parsed.staves[0].events.filter((ev) => ev.k === "Note").length, 2);
  // Not text-only: the score tools have it, its first bar a quarter long.
  const read = M.fromParsed(parsed);
  assert.equal(read.unsupported, undefined);
  assert.equal(read.score.pickup, M.notated(4));
  assert.equal(M.barLength(read.score, 0), M.notated(4));
  assert.equal(M.barsOf(read.score), 2);
  assert.equal(M.barNumber(read.score, 1), 1);
  // Written back as MusicXML: measure 0, implicit, a quarter long.
  const back = X.toMusicXML(read.score);
  assert.match(back, /<measure number="0" implicit="yes">/);
  assert.match(back, /<measure number="1">/);
  assert.match(X.fromMusicXML(back).source, /\\partial 4 /);
});

test("musicxml: a pickup of an odd length is written as a count of a value", () => {
  const xml = partwise(
    `<part id="P1"><measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note("D", 5, 5, "quarter")}</measure>
      <measure number="1">${note("G", 5, 8, "whole")}</measure></part>`,
    `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
  );
  const { source } = X.fromMusicXML(xml);
  assert.match(source, /\\partial 8\*5 /);
  const read = M.fromParsed(JSON.parse(score_json(source)));
  assert.equal(read.score?.pickup, 5 * M.notated(8));
});

test("musicxml: lyrics, a verse each, hyphens and melismata where they fall", () => {
  const lyric = (n, syllabic, text, extend = "") => `<lyric number="${n}"><syllabic>${syllabic}</syllabic><text>${text}</text>${extend}</lyric>`;
  const xml = partwise(
    `<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note("G", 4, 1, "quarter", "<voice>1</voice>").replace("</note>", `${lyric(1, "begin", "Hal")}${lyric(2, "single", "Sing")}</note>`)}
      ${note("A", 4, 1, "quarter", "<voice>1</voice>").replace("</note>", `<notations><slur type="start"/></notations>${lyric(1, "end", "le", "<extend/>")}${lyric(2, "single", "to")}</note>`)}
      ${note("B", 4, 1, "quarter", "<voice>1</voice>").replace("</note>", `<notations><slur type="stop"/></notations></note>`)}
      ${note("C", 5, 1, "quarter", "<voice>1</voice>").replace("</note>", `${lyric(1, "single", "lu!")}${lyric(2, "single", "God")}</note>`)}
    </measure></part>`,
    `<score-part id="P1"><part-name>Voice</part-name></score-part>`,
  );
  const { source } = X.fromMusicXML(xml);
  assert.match(source, /\\addlyrics \{ Hal -- le __ "lu!" \}/);
  assert.match(source, /\\addlyrics \{ Sing to God \}/);
  const staff = scoreOf(source).staves[0];
  assert.deepEqual(staff.events.map((ev) => ev.lyric?.text ?? null), ["Hal", "le", null, "lu!"]);
  assert.ok(staff.events[0].lyric.hyphen);
  assert.deepEqual(staff.events.map((ev) => M.syllableOf(ev, 2)?.text ?? null), ["Sing", "to", null, "God"]);
});

test("musicxml: a clarinet in B♭ is read at its sound, its key with it", () => {
  const xml = partwise(
    `<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
      ${note("D", 5, 1, "quarter")}${note("F", 5, 1, "quarter").replace("<octave>", "<alter>1</alter><octave>")}
    </measure></part>`,
    `<score-part id="P1"><part-name>Clarinet in B♭</part-name><midi-instrument id="P1-I1"><midi-program>72</midi-program></midi-instrument></score-part>`,
  );
  const score = scoreOf(X.fromMusicXML(xml).source);
  assert.equal(score.key, 0, "D major written is C major sounding");
  assert.deepEqual(score.staves[0].events.map((ev) => M.pitchName(ev.pitches[0].d, ev.pitches[0].alter)), ["C5", "E5"]);
  assert.equal(score.staves[0].instrument, "clarinet");
  // And written out again as it was read.
  const back = X.toMusicXML(score);
  assert.match(back, /<key><fifths>2<\/fifths><\/key>/);
  assert.match(back, /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><\/transpose>/);
  assert.match(back, /<step>D<\/step><octave>5<\/octave>/);
  assert.match(back, /<step>F<\/step><alter>1<\/alter><octave>5<\/octave>/);
});

test("musicxml: first and second endings become the editor's repeat", () => {
  const bar = (n, step, extra = "") => `<measure number="${n}">${extra}${note(step, 5, 4, "whole")}</measure>`;
  const xml = partwise(
    `<part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
        <barline location="left"><repeat direction="forward"/></barline>${note("C", 5, 4, "whole")}</measure>
      ${bar(2, "D", '<barline location="left"><ending number="1" type="start"/></barline>').replace("</measure>", '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>')}
      ${bar(3, "E", '<barline location="left"><ending number="2" type="start"/></barline>').replace("</measure>", '<barline location="right"><ending number="2" type="discontinue"/></barline></measure>')}
      ${bar(4, "F")}
    </part>`,
    `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
  );
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  assert.match(source, /\\time 4\/4 \\clef treble \\repeat volta 2 \{ c''1 \| \} \\alternative \{ \{ d''1 \} \{ e''1 \} \} f''1/);
  assert.deepEqual(scoreOf(source).repeats, [{ from: 0, to: 0, endings: [1, 1] }]);
});

test("musicxml: grace notes, tuplets, articulations, chord symbols and a hairpin", () => {
  const xml = partwise(
    `<part id="P1"><measure number="1">
      <attributes><divisions>3</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>dominant</kind></harmony>
      <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
      <note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
      ${note("C", 5, 3, "quarter", "<voice>1</voice>").replace("</note>", "<notations><articulations><staccato/><accent/></articulations><fermata/></notations></note>")}
      <direction><direction-type><wedge type="stop"/></direction-type></direction>
      ${["E", "F", "G"].map((s, k) => note(s, 5, 1, "eighth", "<voice>1</voice>").replace("</note>", `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${k === 0 ? '<notations><tuplet type="start"/></notations>' : k === 2 ? '<notations><tuplet type="stop"/></notations>' : ""}</note>`)).join("")}
    </measure></part>`,
    `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
  );
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const events = scoreOf(source).staves[0].events;
  assert.equal(events[0].grace, "acciaccatura");
  assert.equal(events[0].graces.length, 1);
  assert.deepEqual(events[0].arts, ["staccato", "accent", "fermata"]);
  assert.equal(events[0].chord, "Bb7");
  assert.equal(events[0].hairpin, "<");
  assert.ok(events[1].hairpinEnd);
  assert.deepEqual(events.slice(1).map((ev) => [ev.tuplet?.n, ev.tuplet?.d]), [[3, 2], [3, 2], [3, 2]]);
});

test("musicxml: what the editor does not write is left out and named", () => {
  const voices = [1, 2, 3, 4, 5].map((v) => `${note("C", 5, 4, "whole", `<voice>${v}</voice>`)}${v < 5 ? "<backup><duration>4</duration></backup>" : ""}`).join("");
  const xml = partwise(
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${voices}</measure>
     <measure number="2">${note("C", 5, 4, "whole").replace("<octave>", "<alter>0.5</alter><octave>")}</measure></part>`,
    `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
  );
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, ["a fifth voice on a staff, left out", "quarter tones, rounded"]);
  assert.equal(scoreOf(source).staves.length, 4, "the four voices kept");
});

test("musicxml: a third and a fourth voice are read, in their lanes, and written back as voices 3 and 4", () => {
  // Voices 1 and 3 from the first bar, voice 2 from the second: each keeps its lane.
  const bar1 = [note("E", 5, 4, "whole", "<voice>1</voice>"), "<backup><duration>4</duration></backup>", note("G", 4, 2, "half", "<voice>3</voice>"), note("A", 4, 2, "half", "<voice>3</voice>")].join("");
  const bar2 = [note("F", 5, 4, "whole", "<voice>1</voice>"), "<backup><duration>4</duration></backup>", note("C", 5, 4, "whole", "<voice>2</voice>"), "<backup><duration>4</duration></backup>", note("B", 4, 4, "whole", "<voice>3</voice>"), "<backup><duration>4</duration></backup>", note("D", 4, 4, "whole", "<voice>4</voice>")].join("");
  const xml = partwise(
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${bar1}</measure><measure number="2">${bar2}</measure></part>`,
    `<score-part id="P1"><part-name>Organ</part-name></score-part>`,
  );
  const { source, warnings } = X.fromMusicXML(xml);
  assert.deepEqual(warnings, []);
  const score = scoreOf(source);
  // Voice 3, met before voice 2, still goes to the third lane: its stems up.
  assert.deepEqual(score.staves.map((l) => l.voice ?? 1), [1, 2, 3, 4]);
  const pitches = (lane) => score.staves[lane].events.filter((ev) => !ev.rest).map((ev) => M.spellPitch(ev.pitches[0].d, ev.pitches[0].alter));
  assert.deepEqual(pitches(0), ["e''", "f''"]);
  assert.deepEqual(pitches(1), ["c''"]);
  assert.deepEqual(pitches(2), ["g'", "a'", "b'"]);
  assert.deepEqual(pitches(3), ["d'"]);
  // Voices 1 and 3 alone: the empty second lane does not make voice 3 the second.
  const two = X.fromMusicXML(partwise(
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${bar1}</measure></part>`,
    `<score-part id="P1"><part-name>Organ</part-name></score-part>`,
  ));
  assert.match(two.source, /\\voiceThree g'2/);
  const read = scoreOf(two.source);
  assert.deepEqual(read.staves.map((l) => l.voice ?? 1), [1, 2, 3]);
  assert.equal(read.staves[2].events.filter((ev) => !ev.rest).length, 2);
  // Written by the editor, voice 2 rests there, and the score reads back the same.
  const written = M.toLilyPond(read).source;
  assert.match(written, /<< \{ e''1 \} \\\\ \{ r1 \} \\\\ \{ g'2 a'2 \} >>/);
  assert.deepEqual(shapeOf(scoreOf(written)), shapeOf(read));
  // Out: four voices of one staff, back as themselves.
  const out = X.toMusicXML(score);
  assert.deepEqual([...new Set([...out.matchAll(/<voice>(\d+)<\/voice>/g)].map((m) => m[1]))].sort(), ["1", "2", "3", "4"]);
  const again = X.fromMusicXML(out);
  assert.deepEqual(again.warnings, []);
  assert.equal(M.toLilyPond(scoreOf(again.source)).source, M.toLilyPond(score).source);
});

test("musicxml: a file that is not a partwise score is refused, with what to do", () => {
  assert.throws(() => X.fromMusicXML("<score-timewise/>"), /timewise.*partwise/);
  assert.throws(() => X.fromMusicXML("<svg></svg>"), /not a MusicXML score/);
  assert.throws(() => X.fromMusicXML("<score-partwise><part-list>"), /not a MusicXML file: <part-list> is never closed/);
  assert.throws(() => X.fromMusicXML(partwise("", "")), /has no part/);
});

test("musicxml: the reader keeps entities, CDATA and passes over comments and a doctype's own subset", () => {
  const root = X.parseXml(`<?xml version="1.0"?><!DOCTYPE x [ <!ENTITY y "z"> ]><!-- a > b --><a k='1' j="&quot;q&quot;">A &amp; B &#233;&#x41;<b/><![CDATA[<raw>]]></a>`);
  assert.equal(root.name, "a");
  assert.deepEqual(root.attrs, { k: "1", j: '"q"' });
  assert.equal(root.text, "A & B éA<raw>");
  assert.equal(root.children[0].name, "b");
  assert.throws(() => X.parseXml("<a></b>"), /<\/b> closes nothing/);
  assert.throws(() => X.parseXml("plain text"), /no element/);
});

/** A zip holding `files` (name → text), each deflated or stored. */
function zip(files, deflate = true) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, end]));
}

test("musicxml: a compressed .mxl gives up the score its container names", async () => {
  const score = "<score-partwise>…</score-partwise>";
  const container = `<container><rootfiles><rootfile full-path="music/song.xml"/></rootfiles></container>`;
  assert.equal(await X.unzipMxl(zip({ "META-INF/container.xml": container, "music/song.xml": score, "other.xml": "<no/>" })), score);
  assert.equal(await X.unzipMxl(zip({ "song.musicxml": score }, false)), score, "no container: the one score in it, stored");
  await assert.rejects(X.unzipMxl(new Uint8Array([1, 2, 3])), /not a zip/);
  await assert.rejects(X.unzipMxl(zip({ "META-INF/container.xml": container })), /names music\/song\.xml, which it does not hold/);
  const file = { arrayBuffer: async () => zip({ "a.xml": score }).buffer };
  assert.equal(await X.musicXmlOf(file), score);
  assert.equal(await X.musicXmlOf({ arrayBuffer: async () => new TextEncoder().encode(score).buffer }), score);
  assert.ok(X.isMusicXml("Song.MXL") && X.isMusicXml("a.musicxml") && !X.isMusicXml("a.ly"));
});

test("musicxml: the editor's score written out is valid in its parts, its groups and its header", () => {
  const score = M.fromTemplate("satb-piano", { title: "Ave & Vale", composer: "Anon", key: -2, time: [3, 4], bpm: 60, bars: 2 });
  score.header.subtitle = "for choir";
  const xml = X.toMusicXML(score);
  const root = X.parseXml(xml);
  assert.equal(root.name, "score-partwise");
  const list = root.children.find((c) => c.name === "part-list");
  assert.equal(list.children.filter((c) => c.name === "score-part").length, 5, "four voices and one piano");
  assert.match(xml, /<group-symbol>bracket<\/group-symbol><group-barline>no<\/group-barline>/, "the choir's bracket");
  assert.match(xml, /<work-title>Ave &amp; Vale<\/work-title>/);
  assert.match(xml, /<credit-type>subtitle<\/credit-type><credit-words>for choir<\/credit-words>/);
  const piano = root.children.filter((c) => c.name === "part")[4];
  assert.match(JSON.stringify(piano), /"staves"/);
  // Every measure of every part lasts its bar: 3 quarters, at the divisions the file declares.
  const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)[1]);
  for (const part of root.children.filter((c) => c.name === "part")) {
    for (const measure of part.children.filter((c) => c.name === "measure")) {
      let at = 0;
      let longest = 0;
      for (const el of measure.children) {
        const d = Number(el.children.find((c) => c.name === "duration")?.text ?? 0);
        if (el.name === "backup") at -= d;
        if (el.name === "note" && !el.children.some((c) => c.name === "chord")) at += d;
        longest = Math.max(longest, at);
      }
      assert.equal(longest, 3 * divisions);
    }
  }
});
