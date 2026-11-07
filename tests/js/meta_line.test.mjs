// The score's hidden settings line, `%% eui-score {…}` (score-model.js,
// #683): a line that does not read is kept word for word and never wiped;
// two lines are merged; a line inside a string is no settings line; each key
// is read in its shape; the text's length is watched against what the
// server keeps; and every key numbered by staff, listed once (META_KEYS),
// follows its staff wherever staves move — added, taken away, a part, a merge.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as X from "../../public/eui-score/musicxml.js";
import { setMix } from "../../public/eui-score/mixer.js";
import { mergeScores } from "../../public/eui-score/merge.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const french = Object.assign(
  {},
  ...readdirSync(new URL("../../config/editor_words/fr/", import.meta.url))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(`../../config/editor_words/fr/${name}`, import.meta.url), "utf8")))
);

/** `fn` run with the page in French. */
function inFrench(fn) {
  globalThis.EUI_WORDS = french;
  globalThis.EUI_WORDS_LOCALE = "fr";
  try {
    return fn();
  } finally {
    delete globalThis.EUI_WORDS;
    delete globalThis.EUI_WORDS_LOCALE;
  }
}

/** A text read as the studio reads it: the model, its settings line on it. */
function open(text) {
  const { score } = M.fromParsed(JSON.parse(score_json(text)), text);
  assert.ok(score, `reads: ${text}`);
  const read = M.attachMeta(score, text);
  return { score, read };
}

const DUET = `<< \\new Staff { c'4 d' e' f' } \\new Staff { \\clef bass c1 } >>\n`;
// A line cut short, as a crash or a hand edit leaves it.
const TRUNCATED = `%% eui-score {"mixer":{"tracks":{"1":{"mute":true}}},"velocity":{"0:0:60":90`;

test("a settings line that does not read is kept word for word, and an edit leaves it so", () => {
  const text = `${DUET}${TRUNCATED}\n`;
  const { score, read } = open(text);
  assert.deepEqual(read.meta, {}, "nothing of it is applied");
  assert.deepEqual(read.kept, [TRUNCATED]);
  assert.deepEqual(score.metaKept, [TRUNCATED]);
  // An edit that does not touch the settings: the line comes back as it was.
  M.addChordStaff(score, 0);
  const written = M.toLilyPond(score).source;
  assert.ok(written.endsWith(`\n${TRUNCATED}\n`), written);
  // Read again and written again: still the same line, once.
  const again = open(written);
  assert.equal(M.toLilyPond(again.score).source, written);
  assert.equal(written.split(TRUNCATED).length, 2);
  // A setting changed meanwhile: written on a line of its own, the damaged one untouched before it.
  setMix(again.score, 1, { volume: -6 });
  const mixed = M.toLilyPond(again.score).source;
  assert.ok(mixed.endsWith(`\n${TRUNCATED}\n%% eui-score {"mixer":{"tracks":{"1":{"volume":-6}}}}\n`), mixed);
  const third = open(mixed);
  assert.deepEqual(third.read.kept, [TRUNCATED]);
  assert.deepEqual(third.read.meta.mixer, { tracks: { 1: { volume: -6 } } });
  // Snapshots (Undo) go through JSON: the kept line with them.
  assert.ok(M.toLilyPond(JSON.parse(JSON.stringify(third.score))).source.includes(TRUNCATED));
  // writeMeta on such a text keeps it too.
  assert.ok(M.writeMeta(text, { swing: { amount: 60, unit: 8 } }).includes(`${TRUNCATED}\n%% eui-score {"swing":`));
});

test("a damaged line is said, in French on a French page, and nothing offers to wipe it", () => {
  const { read } = open(`${DUET}${TRUNCATED}\n`);
  assert.match(M.metaNotice(read), /cannot be read: it is kept as it is/);
  const said = inFrench(() => M.metaNotice(read));
  assert.match(said, /^La ligne de réglages cachés de cette partition \(%% eui-score\) est illisible : elle est gardée telle quelle/);
  // A line that reads says nothing.
  assert.equal(M.metaNotice(open(`${DUET}%% eui-score {"swing":{"amount":60,"unit":8}}\n`).read), "");
});

test("two settings lines (one pasted in): both read, merged key by key, the later winning, and said", () => {
  const first = `%% eui-score {"mixer":{"master":{"volume":-3},"tracks":{"0":{"pan":-0.5}}},"swing":{"amount":60,"unit":8}}`;
  const second = `%% eui-score {"mixer":{"tracks":{"0":{"pan":0.5},"1":{"mute":true}}},"humanize":{"time":10,"seed":2}}`;
  const text = `${DUET}${first}\n\\header { title = "x" }\n${second}\n`;
  const { score, read } = open(text);
  assert.equal(read.lines, 2);
  assert.deepEqual(read.meta, {
    mixer: { master: { volume: -3 }, tracks: { 0: { pan: 0.5 }, 1: { mute: true } } },
    swing: { amount: 60, unit: 8 },
    humanize: { time: 10, seed: 2 },
  });
  assert.match(M.metaNotice(read), /^2 settings lines \(%% eui-score\) were found: they are merged into one/);
  assert.match(inFrench(() => M.metaNotice(read)), /^2 lignes de réglages \(%% eui-score\) ont été trouvées/);
  // Written back: one line, holding both.
  const written = M.toLilyPond(score).source;
  assert.equal(written.match(/^%% eui-score /gm).length, 1);
  assert.deepEqual(M.readMeta(written), read.meta);
  // writeMeta, too, leaves one line.
  assert.equal(M.writeMeta(text, {}).match(/^%% eui-score /gm).length, 1);
});

test("a settings line inside a string (a title over lines) is none: not read, and not taken out of the title", () => {
  const title = `\\header { title = "Suite\n%% eui-score {}\nin D" }\n`;
  const text = `${title}\\new Staff { c'1 }\n%% eui-score {"swing":{"amount":60,"unit":8}}\n`;
  assert.deepEqual(M.readMetaLines(text).meta, { swing: { amount: 60, unit: 8 } });
  assert.equal(M.readMetaLines(text).lines, 1, "the title's line is not counted");
  const written = M.writeMeta(text, { humanize: { time: 5 } });
  assert.ok(written.startsWith(title), "the title is left whole");
  assert.equal(written.match(/^%% eui-score \{"swing"/gm).length, 1);
  // A title holding one that reads would otherwise have been applied: it is not.
  const tricky = `\\header { title = "a\n%% eui-score {}\n" }\n{ c'1 }\n`;
  assert.deepEqual(M.readMetaLines(tricky), { meta: {}, kept: [], lines: 0, dropped: [] });
  // Nor inside a block comment.
  assert.deepEqual(M.readMeta(`%{\n%% eui-score {"swing":{"amount":70}}\n%}\n{ c'1 }\n`), {});
  // An escaped quote does not end the string.
  assert.deepEqual(M.readMeta(`\\header { title = "say \\"hi\n%% eui-score {\\"swing\\":1}\n" }\n{ c'1 }\n`), {});
});

test("MusicXML: a part's name or a title over lines is written on one line, so it holds no settings line", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Suite
%% eui-score {"mixer":{"master":{"volume":-60}}}
in D</work-title></work><part-list><score-part id="P1"><part-name>Violin
%% eui-score {"swing":{"amount":75}}
I</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const { source } = X.fromMusicXML(xml);
  assert.doesNotMatch(source, /^%% eui-score/m, source);
  assert.match(source, /"Violin %% eui-score \{\\"swing\\":\{\\"amount\\":75\}\} I"/);
  assert.deepEqual(M.readMeta(source), {});
  assert.ok(M.fromParsed(JSON.parse(score_json(source))).score, "the editor reads it");
});

test("each key is read in its shape: what does not fit is left out, key by key, the rest of the line kept", () => {
  const line = {
    velocity: { "0:0:60": 90, "0:480:62": "loud", nonsense: 70 },
    cc: { 0: { 1: [[0, 0], "x", [960, 127]], 7: "flat" }, 1: "none" },
    ks: { 0: { keys: [[0, 12], ["a", 1]], programs: "x", map: 3 } },
    mixer: { master: 5, tracks: { 0: { mute: true }, 1: "loud" } },
    synth: { 0: { preset: "lead" }, 1: 7 },
    soundfont: [1, 2],
    swing: "lots",
    humanize: { time: 10 },
    future: { kept: ["as", "it", "is"] },
  };
  const read = M.readMetaLines(`{ c'1 }\n%% eui-score ${JSON.stringify(line)}\n`);
  assert.deepEqual(read.meta, {
    velocity: { "0:0:60": 90 },
    cc: { 0: { 1: [[0, 0], [960, 127]] } },
    ks: { 0: { keys: [[0, 12]], programs: [] } },
    mixer: { tracks: { 0: { mute: true } } },
    synth: { 0: { preset: "lead" } },
    humanize: { time: 10 },
    future: { kept: ["as", "it", "is"] },
  });
  assert.deepEqual(read.dropped, ["Note velocities", "Automation curves", "Keyswitches and program changes", "Mixer", "Synthesizer", "Own SoundFont", "Swing"]);
  assert.match(M.metaNotice(read), /Hidden settings that do not read are left out: Note velocities, Automation curves/);
  // A line that is JSON but no object is no settings: kept as it is, like one cut short.
  assert.deepEqual(M.readMetaLines(`{ c'1 }\n%% eui-score [1, 2]\n`).kept, ["%% eui-score [1, 2]"]);
});

test("the text's length: said near the server's million characters and past it, with what the settings take", () => {
  const curve = Array.from({ length: 60000 }, (_, k) => [k * 10, k % 128]);
  const meta = `%% eui-score ${JSON.stringify({ cc: { 0: { 1: curve } } })}\n`;
  const pad = (size) => `{ c'1 }\n%${"x".repeat(Math.max(0, size - meta.length - 10))}\n${meta}`;
  assert.equal(M.sizeWarning(`{ c'1 }\n${meta}`), "", "far from it");
  assert.equal(M.sizeWarning(pad(899000)), "");
  const near = pad(950000);
  assert.ok(near.length < M.SOURCE_LIMIT && near.length >= M.SOURCE_LIMIT * 0.9);
  assert.match(M.sizeWarning(near), /^Nearly too long to be saved: this score's text has 9\d\d,\d\d\d characters, 1,000,000 at most\. Its hidden settings \(curves, velocities…\) take/);
  assert.ok(M.sizeWarning(near).includes(`take ${meta.length.toLocaleString("en-US")} of them`));
  const over = pad(1000500);
  assert.ok(over.length > M.SOURCE_LIMIT);
  assert.match(M.sizeWarning(over), /^Too long to be saved/);
  assert.match(inFrench(() => M.sizeWarning(over)), /^Trop long pour être enregistré : le texte de cette partition compte 1\s000\s\d\d\d caractères, 1\s000\s000 au plus/);
});

// ---- One list of the keys numbered by staff --------------------------------------
//
// A sample of each key at lane `lane` (and tick `tick`), and where it is: the
// lanes it sits at, read without the registry. A key added to META_KEYS with
// no sample here fails the first test: give it one.

const SAMPLES = {
  mixer: { channel: "same", at: (lane) => ({ mixer: { tracks: { [lane]: { mute: true } } } }), lanes: (meta) => Object.keys(meta?.mixer?.tracks ?? {}) },
  velocity: { channel: "none", at: (lane, tick) => ({ velocity: { [`${lane}:${tick}:60`]: 90 } }), lanes: (meta) => Object.keys(meta?.velocity ?? {}).map((id) => id.split(":")[0]) },
  cc: { at: (lane, tick) => ({ cc: { [lane]: { 1: [[tick, 64]] } } }), lanes: (meta) => Object.keys(meta?.cc ?? {}) },
  ks: { at: (lane, tick) => ({ ks: { [lane]: { keys: [[tick, 12]], map: "m1" } } }), lanes: (meta) => Object.keys(meta?.ks ?? {}) },
  synth: { at: (lane) => ({ synth: { [lane]: { preset: "lead" } } }), lanes: (meta) => Object.keys(meta?.synth ?? {}) },
  soundfont: {
    at: (lane) => ({ soundfont: { [lane]: { name: "x.sf2", hash: "0123456789abcdef", bank: 0, program: 1, preset: "p" } } }),
    lanes: (meta) => Object.keys(meta?.soundfont ?? {}),
  },
};

/** A key known only to the registry, added for a test: it must work everywhere with nothing else written. */
const FUTURE = { at: (lane) => ({ future: { [lane]: { on: true } } }), lanes: (meta) => Object.keys(meta?.future ?? {}) };

function withFuture(fn) {
  M.META_KEYS.future = { label: () => "Future", clean: (x) => x, lanes: M.metaByLane("future") };
  try {
    return fn({ ...SAMPLES, future: FUTURE });
  } finally {
    delete M.META_KEYS.future;
  }
}

const TRIO = `<< \\new Staff { \\time 4/4 c'1 | d'1 } \\new Staff { \\clef bass c1 | d1 } \\new Staff { e'1 | f'1 } >>`;

/** The trio, `sample` on its middle staff (lane 1). */
function trio(sample) {
  const { score } = M.fromParsed(JSON.parse(score_json(TRIO)));
  score.meta = sample.at(1, 0);
  return score;
}

test("every key numbered by staff has a sample here: the registry and this test list the same keys", () => {
  assert.deepEqual(M.metaLaneKeys().map(([name]) => name).sort(), Object.keys(SAMPLES).sort());
});

test("every key numbered by staff follows its staff: a staff or a voice added before it, or taken away", () => {
  withFuture((samples) => {
    for (const [name, sample] of Object.entries(samples)) {
      const where = (score) => sample.lanes(score.meta);
      let score = trio(sample);
      M.addChordStaff(score, 1);
      assert.deepEqual(where(score), ["2"], `${name}: a line of chord names before it`);
      score = trio(sample);
      M.addFigureStaff(score, 0);
      assert.deepEqual(where(score), ["2"], `${name}: a figured bass before it`);
      score = trio(sample);
      M.removeStaff(score, 0);
      assert.deepEqual(where(score), ["0"], `${name}: the staff before it taken away`);
      score = trio(sample);
      M.removeStaff(score, 2);
      assert.deepEqual(where(score), ["1"], `${name}: the staff after it taken away`);
      score = trio(sample);
      M.removeStaff(score, 1);
      assert.deepEqual(where(score), [], `${name}: its staff taken away, it goes`);
      assert.equal(score.meta[name], undefined, `${name}: emptied, the key goes`);
      score = trio(sample);
      M.addVoice(score, 0, 2);
      assert.deepEqual(where(score), ["2"], `${name}: a second voice on the staff before it`);
      M.removeVoice(score, 0, 2);
      assert.deepEqual(where(score), ["1"], `${name}: that voice taken away again`);
      // A part: its staff's settings at its lanes there, the others' gone.
      assert.deepEqual(sample.lanes(M.partOf(trio(sample), 1).meta), ["0"], `${name}: its own part`);
      assert.deepEqual(sample.lanes(M.partOf(trio(sample), 2).meta), [], `${name}: another staff's part`);
    }
  });
});

test("every key numbered by staff counts as it says when staves share a MIDI channel: its own, alike, or not at all", () => {
  withFuture((samples) => {
    // Seventeen pitched staves alike: past the fifteen channels, alike staves share one.
    const many = `<< ${Array.from({ length: 17 }, () => "\\new Staff { c'1 }").join(" ")} >>`;
    for (const [name, sample] of Object.entries(samples)) {
      const { score } = M.fromParsed(JSON.parse(score_json(many)));
      // The same setting on staves 1 and 3.
      const one = sample.at(1, 0);
      const three = sample.at(3, 0);
      score.meta = { [name]: name === "mixer" ? { tracks: { ...one.mixer.tracks, ...three.mixer.tracks } } : { ...one[name], ...three[name] } };
      const channel = Object.fromEntries(M.channels(score).map((row) => [row.lane, row.channel]));
      assert.equal(channel[0], channel[2], `${name}: the staves without it share`);
      // "own" (the default): each staff holding it has a channel of its own; "same": alike, they share; "none": it does not count.
      const kind = sample.channel ?? "own";
      assert.equal(channel[1] === channel[0], kind === "none", `${name}: apart from the staves without it`);
      assert.equal(channel[1] === channel[3], kind !== "own", `${name}: two staves holding the same`);
    }
  });
});

test("every key numbered by staff is laid out by a merge: it moves with its staff, and goes with it", () => {
  const canon = (text, meta) => {
    const { score } = M.fromParsed(JSON.parse(score_json(text)));
    score.meta = meta;
    return M.toLilyPond(score).source;
  };
  const DUO = `\\header { title = "Duet" } << \\new Staff { \\time 4/4 c'1 | d'1 } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 } >>`;
  const WITH_FLUTE = `\\header { title = "Duet" } << \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 c''1 | c''1 } \\new Staff { c'1 | d'1 } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 } >>`;
  const SOLO = `\\header { title = "Duet" } \\new Staff { \\time 4/4 c'1 | d'1 }`;
  withFuture((samples) => {
    for (const [name, sample] of Object.entries(samples)) {
      const base = canon(DUO, null);
      // Mine: the bass gets the setting (in its second bar); theirs: a flute added on top.
      const mine = canon(DUO, sample.at(1, M.barStart(M.fromParsed(JSON.parse(score_json(DUO))).score, 1)));
      const out = mergeScores(base, mine, canon(WITH_FLUTE, null), { parse: score_json });
      assert.deepEqual(out.conflicts, [], name);
      assert.deepEqual(sample.lanes(M.readMeta(out.text)), ["2"], `${name}: the bass is lane 2 once merged`);
      // The bass taken away on one side, its setting untouched on the other: it goes with it.
      const both = canon(DUO, sample.at(1, 0));
      const gone = mergeScores(both, both, canon(SOLO, null), { parse: score_json });
      assert.deepEqual(sample.lanes(M.readMeta(gone.text)), [], `${name}: gone with its staff`);
    }
  });
});

test("a merge keeps a side's settings line that does not read, as it is", () => {
  const DUO = `\\header { title = "Duet" } \\new Staff { \\time 4/4 c'1 | d'1 | e'1 }`;
  const { score } = M.fromParsed(JSON.parse(score_json(DUO)));
  const base = M.toLilyPond(score).source;
  const mine = `${base}${TRUNCATED}\n`;
  const theirs = base.replace("e'1", "f'1");
  const out = mergeScores(base, mine, theirs, { parse: score_json });
  assert.deepEqual(out.conflicts, []);
  assert.match(out.text, /f'1/);
  assert.ok(out.text.endsWith(`\n${TRUNCATED}\n`), out.text);
});
