// The sections the shared library starts with (#447), made from the
// editor's own catalogues: each accompaniment style (accompaniments.js)
// played by the guitar, the piano, the bass and the whole band over a
// progression of its kind, and each drum groove (drums.js) as three basic
// bars and its break. Written to db/data/house_sections.json, which the
// migration add_house_sections reads; run again after a catalogue changes:
//
//   node scripts/section-seeds.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import init, { score_json } from "../public/eui-score/eui_score_web.js";
import * as M from "../public/eui-score/score-model.js";
import * as A from "../public/eui-score/accompaniments.js";
import * as D from "../public/eui-score/drums.js";
import * as G from "../public/eui-score/patterns.js";
import { shareable } from "../public/eui-score/section-library.js";

await init({ module_or_path: readFileSync(new URL("../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const BAR = { "4/4": "1", "3/4": "2.", "6/8": "2.", "12/8": "1." };
// The tempo mark of a style's beat: a dotted quarter's as eighths, in 6/8 and 12/8.
const tempo = (time, bpm) => (time.endsWith("/8") ? `\\tempo 8 = ${bpm * 3}` : `\\tempo 4 = ${bpm}`);

// The progression each style is heard over, a chord a bar.
const PROGRESSIONS = {
  pop: ["C", "G", "Am", "F"],
  jazz: ["Dm7", "G7", "Cmaj7", "A7"],
  bossa: ["Am7", "D7", "Gmaj7", "Cmaj7"],
  blues: ["C7", "F7", "C7", "G7"],
  minor: ["Am", "F", "C", "G"],
};
const STYLE_SEEDS = {
  pop: { progression: "pop", style: "pop" },
  rock: { progression: "pop", style: "rock" },
  "pop-ballad": { progression: "pop", style: "ballad" },
  "arpeggio-ballad": { progression: "minor", style: "ballad" },
  folk: { progression: "pop", style: "folk" },
  country: { progression: "pop", style: "country" },
  bossa: { progression: "bossa", style: "bossa" },
  samba: { progression: "bossa", style: "latin" },
  reggae: { progression: "minor", style: "reggae" },
  swing: { progression: "jazz", style: "swing" },
  "jazz-ballad": { progression: "jazz", style: "jazz" },
  shuffle: { progression: "blues", style: "blues" },
  funk: { progression: "blues", style: "funk" },
  waltz: { progression: "pop", style: "waltz" },
  "six-eight": { progression: "minor", style: "ballad" },
};
// A groove's style in the library, by its id, else by its group.
const GROOVE_STYLES = {
  pop: "pop", "pop-halftime": "pop", "power-ballad": "ballad", motown: "soul", metal: "metal", train: "country",
  soul: "soul", rnb: "soul", "neo-soul": "soul", disco: "electronic", "boom-bap": "other", trap: "electronic",
  bossa: "bossa", "one-drop": "reggae", rockers: "reggae", ska: "reggae",
  swing: "swing", bebop: "swing", shuffle: "blues", "slow-blues": "blues", "gospel-128": "gospel", purdie: "funk",
  waltz: "waltz", "jazz-waltz": "waltz", "pop-34": "waltz", "ballad-68": "ballad", "rock-68": "rock", march: "other",
};
const GROUP_STYLES = { "Rock and pop": "rock", "Funk and soul": "funk", Electronic: "electronic", "Latin and Caribbean": "latin", "Jazz and blues": "jazz", "In three, and marching": "other" };
const PART_SEEDS = {
  guitar: { name: "guitar", what: "strummed on its chord shapes, with the diagrams over them" },
  piano: { name: "piano", what: "in both hands, the chords voiced to move as little as they can" },
  bass: { name: "bass", what: "on the roots and fifths, leading to the next chord" },
};

/** A song of four bars in `time` at `bpm`: a voice holding the chords' symbols. */
function song(time, bpm, chords) {
  const bars = chords.map((chord) => `c'${BAR[time]}^"${chord}"`).join(" | ");
  return read(String.raw`\new Staff \with { instrumentName = "Voice" } { \time ${time} ${tempo(time, bpm)} ${bars} }`);
}

const seeds = [];
function add(seed, made, title, instrument) {
  const shared = shareable(made.score, made.lanes, 0, 3, title);
  seeds.push({ seed, title, ...shared, instrument, style: made.style, description: made.description });
}

for (const style of A.STYLES) {
  const { progression, style: libraryStyle } = STYLE_SEEDS[style.id];
  const chords = PROGRESSIONS[progression];
  const heard = `${style.time}, about ${style.bpm} to the beat${style.swing ? ", swung" : ""}, over ${chords.join(" – ")}.`;
  for (const part of ["guitar", "piano", "bass"]) {
    const score = song(style.time, style.bpm, chords);
    A.arrange(score, style.id, { parts: [part], diagrams: part === "guitar" });
    const lanes = M.staffLanes(score).filter((s) => s > 0).flatMap((s) => M.voiceLanes(score, s));
    add(`style:${style.id}:${part}`, { score, lanes, style: libraryStyle, description: `${style.name} on the ${PART_SEEDS[part].name}, ${PART_SEEDS[part].what}. ${heard} Made from the chord symbols by Edit ▸ Accompaniment: put it in your score, then change the chords.` }, `${style.name} — ${PART_SEEDS[part].name}`, part);
  }
  const band = song(style.time, style.bpm, chords);
  A.arrange(band, style.id);
  const lanes = M.staffLanes(band).filter((s) => s > 0).flatMap((s) => M.voiceLanes(band, s));
  add(`style:${style.id}:band`, { score: band, lanes, style: libraryStyle, description: `${style.name} for the whole band: guitar, piano, bass and drums, the drums' break in the fourth bar. ${heard} Made by Edit ▸ Accompaniment.` }, `${style.name} — the whole band`, "band");
}

for (const groove of D.GROOVES) {
  const score = read(String.raw`\new DrumStaff \with { instrumentName = "Drums" } \drummode { \time ${groove.time} ${tempo(groove.time, groove.bpm)} r${BAR[groove.time]} | r | r | r }`);
  G.writeGroove(score, 0, 0, 3, groove);
  if (groove.swing) score.meta = { ...(score.meta ?? {}), swing: { amount: groove.swing, unit: 8 } };
  add(`groove:${groove.id}`, {
    score,
    lanes: M.voiceLanes(score, 0),
    style: GROOVE_STYLES[groove.id] ?? GROUP_STYLES[groove.group],
    description: `${groove.name}: three bars of the basic beat, then its break. ${groove.time}, about ${groove.bpm} to the beat${groove.swing ? ", swung" : ""}. Also in the drum grid's Groove menu (Edit ▸ Drum grid).`,
  }, `${groove.name} — beat and break`, "drums");
}

mkdirSync(new URL("../db/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../db/data/house_sections.json", import.meta.url), JSON.stringify(seeds));
console.log(`${seeds.length} sections, ${JSON.stringify(seeds).length} characters`);
