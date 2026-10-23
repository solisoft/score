// MusicXML in and out, in the browser: a file from MuseScore, Sibelius,
// Finale or Dorico read as LilyPond, which the editor then reads as any
// other; and the editor's score written as MusicXML 4.0, for them to open.
//
//   fromMusicXML(text)  → { source, warnings }   partwise MusicXML → LilyPond
//   toMusicXML(score)   → text                   the editor's model → MusicXML
//   unzipMxl(bytes)     → text                   a compressed .mxl's score
//
// Nothing leaves the page. What a file holds that the editor does not
// write (a third voice on a staff, quarter tones…) is left out, and each
// such thing is named once in `warnings`.

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);

// ---- Reading XML ----------------------------------------------------------------
//
// A small reader, enough for MusicXML: elements, attributes and text;
// comments, processing instructions and the doctype are passed over. It
// runs where DOMParser does not (the tests run in Node).

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, name) => {
    if (name[0] === "#") return String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? all;
  });
}

/** The document's root element: { name, attrs, children, text }. */
export function parseXml(text) {
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (open < 0) break;
    if (open > i) top.text += decode(text.slice(i, open));
    if (text.startsWith("<!--", open)) {
      i = text.indexOf("-->", open) + 3;
      if (i < 3) throw new Error("an unclosed comment");
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const end = text.indexOf("]]>", open);
      if (end < 0) throw new Error("an unclosed CDATA section");
      top.text += text.slice(open + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", open) || text.startsWith("<!", open)) {
      // A doctype may hold its own [ … ]: the tag ends after it.
      let end = text.indexOf(">", open);
      const bracket = text.indexOf("[", open);
      if (text.startsWith("<!DOCTYPE", open) && bracket >= 0 && bracket < end) end = text.indexOf(">", text.indexOf("]", bracket));
      if (end < 0) throw new Error("an unclosed tag");
      i = end + 1;
      continue;
    }
    const close = text.indexOf(">", open);
    if (close < 0) throw new Error("an unclosed tag");
    const tag = text.slice(open + 1, close);
    i = close + 1;
    if (tag[0] === "/") {
      const name = tag.slice(1).trim();
      if (stack.length < 2 || top.name !== name) throw new Error(`</${name}> closes nothing`);
      stack.pop();
      continue;
    }
    const empty = tag.endsWith("/");
    const body = empty ? tag.slice(0, -1) : tag;
    const name = /^[^\s/>]+/.exec(body)?.[0];
    if (!name) throw new Error("a tag with no name");
    const attrs = {};
    for (const m of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decode(m[3] ?? m[4]);
    const el = { name, attrs, children: [], text: "" };
    top.children.push(el);
    if (!empty) stack.push(el);
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].name}> is never closed`);
  const element = root.children[0];
  if (!element) throw new Error("no element in the file");
  return element;
}

const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => el?.children.find((c) => c.name === name) ?? null;
const textIn = (el, name) => kid(el, name)?.text.trim() ?? null;
const numberIn = (el, name) => {
  const t = textIn(el, name);
  return t == null || t === "" ? null : Number(t);
};

// ---- Durations and pitches ---------------------------------------------------------

const TYPES = { maxima: 0.125, long: 0.25, breve: 0.5, whole: 1, half: 2, quarter: 4, eighth: 8, "16th": 16, "32nd": 32, "64th": 64, "128th": 128, "256th": 256 };
const TYPE_OF = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th", 128: "128th" };
const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
// The keys' tonics round the circle of fifths, from 11 flats (fes) to 12 sharps.
const FIFTHS = ["feses", "ceses", "geses", "deses", "aeses", "eeses", "beses", "fes", "ces", "ges", "des", "aes", "ees", "bes", "f", "c", "g", "d", "a", "e", "b", "fis", "cis", "gis", "dis", "ais", "eis", "bis", "fisis", "cisis"];
const MODES = { major: 0, minor: 3, ionian: 0, aeolian: 3, dorian: 2, phrygian: 4, lydian: -1, mixolydian: 1, locrian: 5 };

/** A whole note's fraction, `num/den` of a quarter, as LilyPond durations: one when it can, else several to tie. */
function spell(quarters) {
  const out = [];
  let left = quarters;
  for (let guard = 0; left > 1e-9 && guard < 16; guard++) {
    let found = null;
    for (const base of [1, 2, 4, 8, 16, 32, 64, 128]) {
      for (const dots of [2, 1, 0]) {
        const value = (4 / base) * (2 - 1 / 2 ** dots);
        if (value <= left + 1e-9) {
          found = { base, dots, value };
          break;
        }
      }
      if (found) break;
    }
    if (!found) break;
    out.push(found);
    left -= found.value;
  }
  return out;
}

const durationText = ({ base, dots }) => `${base}${".".repeat(dots)}`;

/** LilyPond's absolute name of a pitch: step letter, alteration, octave marks (c' is middle C, octave 4). */
function pitchText(step, alter, octave) {
  const accidental = { "-2": "eses", "-1": "es", 1: "is", 2: "isis" }[alter] ?? "";
  let name = step.toLowerCase() + accidental;
  name = name.replace(/^ees/, "es").replace(/^aes/, "as");
  const marks = octave - 3;
  return name + (marks > 0 ? "'".repeat(marks) : ",".repeat(-marks));
}

function quoted(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---- MusicXML → LilyPond ------------------------------------------------------------

const CLEFS_IN = { G2: "treble", F4: "bass", C3: "alto", C4: "tenor", C1: "soprano", F3: "varbaritone", G1: "french", C2: "mezzosoprano", C5: "baritone" };
const ARTICULATIONS_IN = { staccato: "-.", accent: "->", tenuto: "--", "strong-accent": "-^", staccatissimo: "-!", "detached-legato": "-_", spiccato: "-!" };
const ORNAMENTS_IN = { "trill-mark": "\\trill", mordent: "\\mordent", "inverted-mordent": "\\prall", turn: "\\turn" };
const DYNAMICS_IN = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sf", "sfz", "fp", "rfz", "sfp", "fz"];

/**
 * A partwise MusicXML score as LilyPond: { source, warnings }. Throws, with
 * a sentence a person can read, on a file that is not a score at all.
 */
export function fromMusicXML(text) {
  let root;
  try {
    root = parseXml(text);
  } catch (error) {
    throw new Error(`This is not a MusicXML file: ${error.message}.`);
  }
  if (root.name === "score-timewise") throw new Error("This MusicXML file is written measure by measure (timewise); save it part by part (partwise) and open it again.");
  if (root.name !== "score-partwise") throw new Error("This is not a MusicXML score: it holds no <score-partwise>.");
  const warnings = new Set();
  const header = [];
  const title = textIn(kid(root, "work"), "work-title") || textIn(root, "movement-title");
  const creators = kids(kid(root, "identification"), "creator");
  const creator = (type) => creators.find((c) => c.attrs.type === type)?.text.trim() || null;
  const subtitle = kids(root, "credit").find((c) => textIn(c, "credit-type") === "subtitle");
  const fields = {
    title,
    subtitle: subtitle ? kids(subtitle, "credit-words").map((w) => w.text.trim()).join(" ") : null,
    composer: creator("composer"),
    arranger: creator("arranger"),
    poet: creator("lyricist") ?? creator("poet"),
    copyright: textIn(kid(root, "identification"), "rights"),
  };
  // In the order the editor writes them: by name.
  for (const name of Object.keys(fields).sort()) if (fields[name]) header.push(`${name} = ${quoted(fields[name])}`);

  const partInfo = new Map();
  // The groups of parts, by where they start and end among the parts.
  const groups = [];
  const openGroups = new Map();
  let partCount = 0;
  for (const el of kid(root, "part-list")?.children ?? []) {
    if (el.name === "score-part") partCount++;
    if (el.name !== "part-group") continue;
    const number = el.attrs.number ?? "1";
    if (el.attrs.type === "start") {
      openGroups.set(number, {
        first: partCount,
        symbol: textIn(el, "group-symbol") ?? "none",
        barline: textIn(el, "group-barline") ?? "yes",
        name: kid(el, "group-name")?.attrs["print-object"] === "no" ? "" : textIn(el, "group-name") ?? "",
        short: textIn(el, "group-abbreviation") ?? "",
      });
    } else if (el.attrs.type === "stop" && openGroups.has(number)) {
      groups.push({ ...openGroups.get(number), last: partCount - 1 });
      openGroups.delete(number);
    }
  }
  for (const sp of kids(kid(root, "part-list"), "score-part")) {
    const shown = kid(sp, "part-name")?.attrs["print-object"] !== "no";
    const program = numberIn(kid(sp, "midi-instrument"), "midi-program");
    const drums = new Map();
    for (const mi of kids(sp, "midi-instrument")) {
      const key = numberIn(mi, "midi-unpitched");
      if (key) drums.set(mi.attrs.id, key - 1);
    }
    partInfo.set(sp.attrs.id, {
      name: shown ? textIn(sp, "part-name") ?? "" : "",
      short: shown ? textIn(sp, "part-abbreviation") ?? "" : "",
      sound: program ? M.PROGRAMS[program - 1] ?? null : null,
      drums,
    });
  }

  const parts = kids(root, "part");
  if (!parts.length) throw new Error("This MusicXML score has no part.");
  const blocks = parts.map((part, p) => readPart(part, partInfo.get(part.attrs.id) ?? { name: "", short: "", sound: null, drums: new Map() }, p === 0, warnings));
  const head = header.length ? `\\header {\n  ${header.join("\n  ")}\n}\n` : "";
  const indent = (text) => text.replace(/^/gm, "  ");
  // Parts `from`…`to`, each group that starts there around its parts.
  const nest = (from, to, left) => {
    const out = [];
    let n = from;
    while (n <= to) {
      const g = left.filter((x) => x.first === n && x.last <= to).sort((x, y) => y.last - x.last)[0];
      if (!g) {
        out.push(blocks[n]);
        n++;
        continue;
      }
      const inner = nest(g.first, g.last, left.filter((x) => x !== g));
      // A brace around one part that is already a piano's adds nothing.
      if (g.first === g.last) {
        out.push(inner);
        n = g.last + 1;
        continue;
      }
      const kind = g.symbol === "brace" ? "\\new PianoStaff" : g.symbol === "bracket" || g.symbol === "square" ? (g.barline === "no" ? "\\new ChoirStaff" : "\\new StaffGroup") : "";
      const names = (g.name ? `instrumentName = ${quoted(g.name)} ` : "") + (g.short ? `shortInstrumentName = ${quoted(g.short)} ` : "");
      out.push(`${kind ? kind + " " : ""}${kind && names ? `\\with { ${names}} ` : ""}<<\n${indent(inner)}\n>>`);
      n = g.last + 1;
    }
    return out.join("\n");
  };
  const valid = groups.filter((g) => g.first <= g.last && g.last < blocks.length);
  const whole = valid.find((g) => g.first === 0 && g.last === blocks.length - 1 && g.first < g.last);
  const body = blocks.length === 1 ? blocks[0] : whole ? nest(0, blocks.length - 1, valid) : `<<\n${indent(nest(0, blocks.length - 1, valid))}\n>>`;
  return { source: `${head}${body}\n`, warnings: [...warnings] };
}

/** One part's staves, as LilyPond. */
function readPart(part, info, first, warnings) {
  let divisions = 1;
  let staves = 1;
  // Per staff: its voices (MusicXML's voice ids, in the order they come), its lanes' music, its lyrics.
  const staffOf = (n) => {
    while (lanes.length < n) lanes.push({ drums: false, voices: [], lanes: [[], []], pos: [0, 0], lyrics: new Map(), pending: [], sung: 0, tiedOver: false, measureFrom: 0 });
    return lanes[n - 1];
  };
  const lanes = [];
  staffOf(1);
  let time = [4, 4];
  let measureStart = 0;
  let transpose = null;
  const tupletOpen = new Map();
  const graces = new Map();
  const lastNote = new Map();
  const slurDepth = new Map();
  let firstMeasure = true;
  const laneKey = (s, v) => `${s}:${v}`;

  /** Lane `v` (0, 1) of staff `s`, filled to absolute time `at` (divisions) with rests or spacers. */
  function fill(staff, v, at) {
    const gap = at - staff.pos[v];
    if (gap <= 1e-9) return;
    const pieces = spell(gap / divisions);
    staff.lanes[v].push(...pieces.map((d) => (v === 0 ? "r" : "s") + durationText(d)));
    staff.pos[v] = at;
  }

  /** A command (a clef, a key…) in lane `v` of `staff`, where time `at` falls. */
  function put(staff, v, at, text) {
    fill(staff, v, at);
    staff.lanes[v].push(text);
  }

  /** What goes after the next note of a staff: dynamics, words, pedal, wedges. */
  function attach(staff, text) {
    staff.pending.push(text);
  }

  for (const measure of kids(part, "measure")) {
    let cursor = measureStart;
    let measureLength = 0;
    const leftBar = [];
    const rightBar = [];
    // This measure's repeat signs and endings: { forward, backward, start: number, stop: bool }.
    const signs = { forward: false, backward: false, start: 0, stop: false };
    const at = (s) => staffOf(s);
    for (const el of measure.children) {
      if (el.name === "attributes") {
        divisions = numberIn(el, "divisions") ?? divisions;
        const tr = kid(el, "transpose");
        if (tr) transpose = { diatonic: (numberIn(tr, "diatonic") ?? 0) + 7 * (numberIn(tr, "octave-change") ?? 0), chromatic: (numberIn(tr, "chromatic") ?? 0) + 12 * (numberIn(tr, "octave-change") ?? 0) };
        const count = numberIn(el, "staves");
        if (count) {
          staves = count;
          staffOf(count);
        }
        const key = kid(el, "key");
        if (key && numberIn(key, "fifths") != null) {
          // A transposing staff's key is written: its sound's is the one kept.
          const fifths = transpose ? spellFifths(numberIn(key, "fifths") + 7 * transpose.chromatic) : numberIn(key, "fifths");
          const mode = (textIn(key, "mode") ?? "major").toLowerCase();
          if (!(mode in MODES)) warnings.add(`the mode “${mode}”, read as major`);
          const tonic = FIFTHS[fifths + (MODES[mode] ?? 0) + 15];
          const name = MODES[mode] != null && mode !== "ionian" && mode !== "aeolian" ? mode : mode === "aeolian" ? "minor" : "major";
          for (let s = 1; s <= staves; s++) if (!at(s).drums) put(at(s), 0, cursor, `\\key ${tonic} \\${name}`);
        }
        const t = kid(el, "time");
        if (t && kid(t, "beats")) {
          const beats = textIn(t, "beats");
          const beatType = numberIn(t, "beat-type");
          const total = beats.split("+").reduce((sum, x) => sum + Number(x), 0);
          time = [total, beatType];
          for (let s = 1; s <= staves; s++) put(at(s), 0, cursor, `\\time ${beats}/${beatType}`);
        } else if (t && kid(t, "senza-misura")) warnings.add("a part without bar lines (senza misura)");
        for (const clef of kids(el, "clef")) {
          const s = Number(clef.attrs.number ?? 1);
          const sign = textIn(clef, "sign");
          const line = textIn(clef, "line") ?? (sign === "G" ? "2" : sign === "F" ? "4" : "3");
          const octave = numberIn(clef, "clef-octave-change") ?? 0;
          let name;
          if (sign === "percussion") {
            name = "percussion";
            at(s).drums = true;
          } else if (sign === "TAB") {
            warnings.add("tablature, read as notes");
            name = "treble_8";
          } else name = CLEFS_IN[sign + line];
          if (!name) {
            warnings.add(`the clef ${sign} on line ${line}, read as a treble clef`);
            name = "treble";
          }
          if (octave && name !== "percussion") name = `"${name}${octave < 0 ? "_" : "^"}${8 * Math.abs(octave) - (Math.abs(octave) - 1)}"`;
          if (name === "percussion") continue;
          put(at(s), 0, cursor, `\\clef ${name}`);
        }
      } else if (el.name === "backup") {
        cursor -= numberIn(el, "duration") ?? 0;
      } else if (el.name === "forward") {
        cursor += numberIn(el, "duration") ?? 0;
        measureLength = Math.max(measureLength, cursor - measureStart);
      } else if (el.name === "direction") {
        const s = Number(textIn(el, "staff") ?? 1);
        const above = el.attrs.placement !== "below";
        const types = kids(el, "direction-type").flatMap((dt) => dt.children);
        const sound = kid(el, "sound");
        // Words with a metronome mark, or with a speed to play at: a tempo mark.
        const metronome = types.find((d) => d.name === "metronome");
        const words = types.filter((d) => d.name === "words" && d.text.trim()).map((d) => d.text.trim()).join(" ");
        if (metronome || sound?.attrs.tempo) {
          if (first) {
            const unit = metronome ? TYPES[textIn(metronome, "beat-unit")] : 4;
            const dotted = metronome && kid(metronome, "beat-unit-dot") ? "." : "";
            const bpm = metronome ? numberIn(metronome, "per-minute") : Number(sound.attrs.tempo);
            const speed = unit >= 1 && bpm ? ` ${unit}${dotted} = ${Math.round(bpm)}` : "";
            if (speed || words) put(at(1), 0, cursor, `\\tempo${words ? ` ${quoted(words)}` : ""}${speed}`);
          }
          continue;
        }
        // Bold words over the start of a bar, and nothing else: a tempo with no speed.
        const bold = types.length === 1 && types[0].name === "words" && types[0].attrs["font-weight"] === "bold";
        if (bold && words && cursor === measureStart && above) {
          if (first) put(at(1), 0, cursor, `\\tempo ${quoted(words)}`);
          continue;
        }
        // A jump, D.S. al Coda or Fine, over the bar line it stands against.
        const jump = Object.values(M.JUMPS).find((j) => j.toLowerCase() === words.toLowerCase());
        if (jump) {
          if (first) put(at(1), 0, cursor, jump === "Fine" ? "\\fine" : `\\jump ${quoted(jump)}`);
          continue;
        }
        for (const dt of kids(el, "direction-type")) {
          for (const d of dt.children) {
            if (d.name === "dynamics") {
              const mark = d.children[0]?.name;
              if (DYNAMICS_IN.includes(mark)) attach(at(s), `\\${mark === "fz" ? "sfz" : mark === "sfp" ? "fp" : mark}`);
              else if (mark) warnings.add("some dynamics");
            } else if (d.name === "wedge") {
              const type = d.attrs.type;
              attach(at(s), type === "crescendo" ? "\\<" : type === "diminuendo" ? "\\>" : "\\!");
            } else if (d.name === "words" && d.text.trim()) {
              const italic = d.attrs["font-style"] === "italic";
              const words = d.text.trim();
              attach(at(s), `${above ? "^" : "_"}${italic ? `\\markup \\italic ${quoted(words)}` : quoted(words)}`);
            } else if (d.name === "pedal") {
              const type = d.attrs.type;
              if (type === "start") attach(at(s), "\\sustainOn");
              else if (type === "stop") attach(at(s), "\\sustainOff");
              else if (type === "change") attach(at(s), "\\sustainOff\\sustainOn");
            } else if (d.name === "rehearsal" && first) {
              put(at(1), 0, cursor, "\\mark \\default");
            } else if (d.name === "segno" && first) {
              put(at(1), 0, cursor, "\\segnoMark");
            } else if (d.name === "coda" && first) {
              put(at(1), 0, cursor, "\\codaMark");
            }
          }
        }
      } else if (el.name === "harmony") {
        const chord = chordName(el);
        if (chord) attach(at(Number(textIn(el, "staff") ?? 1)), `^${quoted(chord)}`);
      } else if (el.name === "barline") {
        const repeat = kid(el, "repeat")?.attrs.direction;
        const style = textIn(el, "bar-style");
        const ending = kid(el, "ending");
        if (repeat === "forward") signs.forward = true;
        if (repeat === "backward") signs.backward = true;
        if (ending?.attrs.type === "start") signs.start = Number(/\d+/.exec(ending.attrs.number ?? "1")?.[0] ?? 1);
        if (ending && ending.attrs.type !== "start") signs.stop = true;
        const side = el.attrs.location === "left" ? leftBar : rightBar;
        if (!repeat && style === "light-heavy") side.push("|.");
        else if (!repeat && style === "light-light") side.push("||");
      } else if (el.name === "print" && first) {
        if (el.attrs["new-page"] === "yes" && measureStart > 0) put(at(1), 0, cursor, "\\pageBreak");
        else if (el.attrs["new-system"] === "yes" && measureStart > 0) put(at(1), 0, cursor, "\\break");
      } else if (el.name === "note") {
        readNote(el);
      }
    }

    // The measure's length: the longest lane, or the metre's for an empty one.
    const metre = (4 * time[0] * divisions) / time[1];
    const filled = Math.max(measureLength, ...lanes.flatMap((st) => st.pos.map((p) => p - measureStart)));
    const length = filled > 0 ? filled : metre;
    if (firstMeasure && length < metre - 1e-9 && measure.attrs.implicit === "yes") {
      const partial = spell(length / divisions);
      if (partial.length !== 1) warnings.add("a pickup bar of an odd length");
      // Just before the first note, after the clef, key and metre.
      else {
        for (const st of lanes) {
          const k = st.lanes[0].findIndex((x) => x && !x.startsWith("\\"));
          st.lanes[0].splice(k < 0 ? st.lanes[0].length : k, 0, `\\partial ${durationText(partial[0])}`);
        }
      }
    }
    measureStart += length;
    for (const st of lanes) {
      fill(st, 0, measureStart);
      if (st.voices.length > 1) fill(st, 1, measureStart);
      st.lanes[0].push("|");
      if (st.voices.length > 1) st.lanes[1].push("|");
    }
    const right = rightBar[0];
    for (const st of lanes) {
      const lane = st.lanes[0];
      if (right) lane.splice(lane.length - 1, 0, `\\bar "${right}"`);
      // Repeats and endings, as \repeat volta … \alternative { { … } { … } }.
      const insert = (k, text) => {
        lane.splice(k, 0, text);
        return k + 1;
      };
      // A repeat opens after the clef, key and metre that start its first bar.
      const opening = (k) => {
        let at = k ?? 0;
        while (/^\\(clef|key|time|partial) /.test(lane[at] ?? "")) at++;
        lane.splice(at, 0, "\\repeat volta @ {");
      };
      let from = st.measureFrom;
      if (st.alternative === "between" && (signs.start <= 1 || signs.forward)) {
        from = insert(from, "}");
        st.alternative = null;
        st.repeatFrom = from;
      }
      if (signs.forward) st.repeatFrom = from;
      if (signs.start === 1) {
        opening(st.repeatFrom);
        from = insert(from + 1, "} \\alternative { {");
        st.alternative = "in";
        st.endings = 1;
      } else if (signs.start > 1 && st.alternative === "between") {
        from = insert(from, "{");
        st.alternative = "in";
        st.endings = (st.endings ?? 1) + 1;
      }
      if (signs.stop && st.alternative === "in") {
        lane[lane.length - 1] = "}";
        st.alternative = "between";
      } else if (signs.backward && !st.alternative) {
        opening(st.repeatFrom);
        lane[lane.length - 1] = "}";
        st.repeatFrom = lane.length;
      }
      // The number of times: the endings', once they are all known.
      if (st.alternative !== "in") {
        const k = lane.lastIndexOf("\\repeat volta @ {");
        if (k >= 0) lane[k] = `\\repeat volta ${Math.max(2, st.alternative === "between" ? st.endings : 2)} {`;
      }
      st.measureFrom = lane.length;
    }
    firstMeasure = false;
    cursor = measureStart;

    function readNote(note) {
      const isChord = Boolean(kid(note, "chord"));
      const isGrace = Boolean(kid(note, "grace"));
      const s = Number(textIn(note, "staff") ?? 1);
      const staff = at(s);
      const voiceId = textIn(note, "voice") ?? "1";
      let v = staff.voices.indexOf(voiceId);
      if (v < 0) {
        if (staff.voices.length >= 2) {
          warnings.add("a third voice on a staff, left out");
          if (!isChord && !isGrace) cursor += numberIn(note, "duration") ?? 0;
          return;
        }
        staff.voices.push(voiceId);
        v = staff.voices.length - 1;
      }
      const key = laneKey(s, v);
      const duration = numberIn(note, "duration") ?? 0;
      const start = isChord ? lastNote.get(key)?.start ?? cursor : cursor;
      const rest = kid(note, "rest");
      const unpitched = kid(note, "unpitched");
      let pitch = null;
      if (!rest) {
        if (unpitched || staff.drums) {
          const instrument = kid(note, "instrument")?.attrs.id;
          const midi = info.drums.get(instrument);
          const drum = midi != null ? M.drumByKey(midi) : null;
          if (!drum) warnings.add("a drum this editor does not name, read as a snare");
          pitch = drum ?? "sn";
          staff.drums = true;
        } else {
          const p = kid(note, "pitch");
          let step = STEPS.indexOf(textIn(p, "step"));
          let alter = numberIn(p, "alter") ?? 0;
          let octave = numberIn(p, "octave") ?? 4;
          if (!Number.isInteger(alter)) {
            warnings.add("quarter tones, rounded");
            alter = Math.round(alter);
          }
          if (transpose) {
            // Written for a transposing instrument: the sounding pitch.
            const d = octave * 7 + step + transpose.diatonic;
            const key12 = octave * 12 + NATURAL[step] + alter + transpose.chromatic;
            step = ((d % 7) + 7) % 7;
            octave = Math.floor(d / 7);
            alter = key12 - (octave * 12 + NATURAL[step]);
          }
          if (Math.abs(alter) > 2) {
            warnings.add("a pitch spelled with more than two sharps or flats");
            alter = Math.sign(alter) * 2;
          }
          pitch = pitchText(STEPS[step], alter, octave);
        }
      }
      // The written value: its type and dots, or what its duration spells.
      const type = textIn(note, "type");
      const dots = kids(note, "dot").length;
      const tm = kid(note, "time-modification");
      const ratio = tm ? { n: numberIn(tm, "actual-notes"), d: numberIn(tm, "normal-notes") } : null;
      let values;
      if (type && TYPES[type] >= 1 && TYPES[type] <= 128) values = [{ base: TYPES[type], dots }];
      else if (type && TYPES[type] < 1) {
        warnings.add("a breve or longer note, cut into tied whole notes");
        values = spell((4 / TYPES[type]) * (2 - 1 / 2 ** dots));
      } else values = spell((duration / divisions) * (ratio ? ratio.n / ratio.d : 1));
      if (isGrace) {
        if (rest || isChord) {
          if (isChord && graces.get(key)?.length) graces.get(key)[graces.get(key).length - 1].pitches.push(pitch);
          return;
        }
        const list = graces.get(key) ?? [];
        list.push({ pitches: [pitch], value: values[0], slash: kid(note, "grace").attrs.slash === "yes" });
        graces.set(key, list);
        return;
      }
      if (isChord) {
        const last = lastNote.get(key);
        if (last && !rest) {
          last.pitches.push(pitch);
          last.render();
        }
        return;
      }
      fill(staff, v, start);
      const notations = kids(note, "notations");
      const has = (name) => notations.some((n) => kids(n, name).length);
      const each = (name) => notations.flatMap((n) => kids(n, name));
      let suffix = "";
      if (kids(note, "tie").some((t) => t.attrs.type === "start") || each("tied").some((t) => t.attrs.type === "start")) suffix += "~";
      const depth = slurDepth.get(key) ?? 0;
      const slurStops = each("slur").filter((x) => x.attrs.type === "stop").length;
      const slurStarts = each("slur").filter((x) => x.attrs.type === "start").length;
      if (slurStops && depth > 0) suffix += ")";
      if (slurStarts && depth - Math.min(depth, slurStops) === 0) suffix += "(";
      slurDepth.set(key, Math.max(0, depth - slurStops) + slurStarts);
      for (const art of notations.flatMap((n) => kids(n, "articulations")).flatMap((a) => a.children)) {
        if (ARTICULATIONS_IN[art.name]) suffix += ARTICULATIONS_IN[art.name];
        else if (art.name !== "breath-mark") warnings.add("some articulations");
      }
      for (const orn of notations.flatMap((n) => kids(n, "ornaments")).flatMap((a) => a.children)) {
        if (ORNAMENTS_IN[orn.name]) suffix += ORNAMENTS_IN[orn.name];
        else if (orn.name === "tremolo" && orn.attrs.type !== "start" && orn.attrs.type !== "stop") suffix = `:${8 * 2 ** (Number(orn.text.trim() || 1) - 1)}${suffix}`;
        else if (orn.name !== "accidental-mark") warnings.add("some ornaments");
      }
      if (has("fermata")) suffix += "\\fermata";
      if (has("arpeggiate") && !rest) suffix += "\\arpeggio";
      if (each("glissando").some((g) => g.attrs.type === "start") || each("slide").some((g) => g.attrs.type === "start")) suffix += "\\glissando";
      for (const dyn of notations.flatMap((n) => kids(n, "dynamics"))) {
        const mark = dyn.children[0]?.name;
        if (DYNAMICS_IN.includes(mark)) suffix += `\\${mark}`;
      }
      const tuplets = each("tuplet");
      const opens = ratio && (tuplets.some((t) => t.attrs.type === "start") || !tupletOpen.get(key));
      const closes = ratio && tuplets.some((t) => t.attrs.type === "stop");
      const lane = staff.lanes[v];
      if (tupletOpen.get(key) && (!ratio || (opens && tuplets.some((t) => t.attrs.type === "start")))) {
        lane.push("}");
        tupletOpen.set(key, false);
      }
      if (ratio && opens && !tupletOpen.get(key)) {
        lane.push(`\\tuplet ${ratio.n}/${ratio.d} {`);
        tupletOpen.set(key, true);
      }
      const pending = graces.get(key);
      if (pending?.length) {
        const written = pending.map((g) => (g.pitches.length > 1 ? `<${g.pitches.join(" ")}>` : g.pitches[0]) + durationText(g.value));
        const kind = pending.every((g) => g.slash) ? "acciaccatura" : "grace";
        lane.push(`\\${kind} ${written.length === 1 ? written[0] : `{ ${written.join(" ")} }`}`);
        graces.set(key, []);
      }
      // The words and marks waiting for this staff's next note go on the first lane's.
      const extra = v === 0 ? staff.pending.splice(0).join("") : "";
      const entry = { pitches: rest ? [] : [pitch], start, index: lane.length, render: null };
      entry.render = () => {
        const head = rest ? (kid(note, "rest").attrs.measure === "yes" && values.length === 1 && !ratio ? "R" : "r") : entry.pitches.length > 1 ? `<${entry.pitches.join(" ")}>` : entry.pitches[0];
        const pieces = values.map((value, k) => head + durationText(value) + (k < values.length - 1 && !rest ? "~" : ""));
        lane[entry.index] = pieces.join(" ") + suffix + extra;
      };
      lane.push("");
      entry.render();
      lastNote.set(key, entry);
      if (closes && tupletOpen.get(key)) {
        lane.push("}");
        tupletOpen.set(key, false);
      }
      staff.pos[v] = start + duration;
      cursor = start + duration;
      measureLength = Math.max(measureLength, cursor - measureStart);
      // Its words, a verse each.
      if (v === 0 && !rest) {
        const tiedOver = staff.tiedOver;
        staff.tiedOver = suffix.includes("~");
        for (const lyric of kids(note, "lyric")) {
          const n = Number(lyric.attrs.number ?? 1) || 1;
          const syllables = staff.lyrics.get(n) ?? [];
          while (syllables.length < staff.sung) syllables.push("_");
          const text = textIn(lyric, "text");
          if (text == null) continue;
          const syllabic = textIn(lyric, "syllabic") ?? "single";
          let word = /^[A-Za-zÀ-ɏ'’]+$/.test(text) ? text : quoted(text);
          if (syllabic === "begin" || syllabic === "middle") word += " --";
          if (kid(lyric, "extend")) word += " __";
          syllables[staff.sung] = word;
          staff.lyrics.set(n, syllables);
        }
        // A note tied from the one before, or inside a slur, takes no syllable: LilyPond skips it.
        const melisma = tiedOver || (depth > 0 && !slurStarts);
        if (!melisma) staff.sung = (staff.sung ?? 0) + 1;
        else for (const syllables of staff.lyrics.values()) if (syllables.length > staff.sung) syllables.length = staff.sung;
      }
    }
  }
  if (lanes.some((st) => st.pending.length)) warnings.add("words or marks after the last note");
  for (const st of lanes) {
    if (st.alternative === "between") st.lanes[0].push("}");
    else if (st.alternative === "in") st.lanes[0].push("} }");
    const k = st.lanes[0].lastIndexOf("\\repeat volta @ {");
    if (k >= 0) st.lanes[0][k] = `\\repeat volta ${Math.max(2, st.endings ?? 2)} {`;
  }

  // The staves, each with its voices and its verses.
  const staffText = (st, k) => {
    for (const [key, open] of tupletOpen) if (open && key.startsWith(`${k + 1}:`)) st.lanes[Number(key.split(":")[1])].push("}");
    const tidy = (lane) => {
      while (lane.length && lane[lane.length - 1] === "|") lane.pop();
      return lane.filter(Boolean).join(" ");
    };
    const one = tidy(st.lanes[0]);
    const music = st.voices.length > 1 ? `<< { ${one} } \\\\ { ${tidy(st.lanes[1])} } >>` : one;
    const named = lanes.length === 1 && (info.name || info.short || info.sound);
    const props = [];
    if (named && info.name) props.push(`instrumentName = ${quoted(info.name)}`);
    if (named && info.short) props.push(`shortInstrumentName = ${quoted(info.short)}`);
    if (info.sound && info.sound !== "acoustic grand" && !st.drums) props.push(`midiInstrument = ${quoted(info.sound)}`);
    const withBlock = props.length ? ` \\with { ${props.join(" ")} }` : "";
    const verses = [...st.lyrics.keys()].sort((a, b) => a - b).map((n) => `\\addlyrics { ${st.lyrics.get(n).join(" ")} }`);
    if (st.drums) return `\\new DrumStaff${withBlock} \\drummode { ${music.replace(/\\clef [^ ]+ /g, "").replace(/\\key [a-z]+ \\[a-z]+ ?/g, "")} }`;
    return [`\\new Staff${withBlock} { ${music} }`, ...verses].join("\n");
  };
  const blocks = lanes.map(staffText);
  if (blocks.length === 1) return blocks[0];
  const props = [];
  if (info.name) props.push(`instrumentName = ${quoted(info.name)}`);
  if (info.short) props.push(`shortInstrumentName = ${quoted(info.short)}`);
  return `\\new PianoStaff${props.length ? ` \\with { ${props.join(" ")} }` : ""} <<\n${blocks.map((b) => `  ${b.replace(/\n/g, "\n  ")}`).join("\n")}\n>>`;
}

const KIND_TEXT = {
  major: "", minor: "m", augmented: "aug", diminished: "dim", dominant: "7", "major-seventh": "maj7", "minor-seventh": "m7", "diminished-seventh": "dim7",
  "augmented-seventh": "aug7", "half-diminished": "m7b5", "major-minor": "m(maj7)", "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "9", "major-ninth": "maj9",
  "minor-ninth": "m9", "dominant-11th": "11", "dominant-13th": "13", "suspended-second": "sus2", "suspended-fourth": "sus4", power: "5",
};

/** A <harmony>'s chord symbol, "F#m7/C#", or null. */
function chordName(el) {
  const step = textIn(kid(el, "root"), "root-step");
  if (!step) return null;
  const sign = (alter) => (alter > 0 ? "#" : alter < 0 ? "b" : "");
  const kind = kid(el, "kind");
  const suffix = kind?.attrs.text ?? KIND_TEXT[kind?.text.trim()] ?? "";
  const bass = textIn(kid(el, "bass"), "bass-step");
  return step + sign(numberIn(kid(el, "root"), "root-alter") ?? 0) + suffix + (bass ? `/${bass}${sign(numberIn(kid(el, "bass"), "bass-alter") ?? 0)}` : "");
}

// ---- The model → MusicXML ----------------------------------------------------------

const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ARTICULATIONS_OUT = { staccato: "staccato", accent: "accent", tenuto: "tenuto", marcato: "strong-accent", staccatissimo: "staccatissimo", portato: "detached-legato" };
const ORNAMENTS_OUT = { trill: "trill-mark", prall: "inverted-mordent", mordent: "mordent", turn: "turn" };
const CLEFS_OUT = {
  treble: ["G", 2, 0], bass: ["F", 4, 0], alto: ["C", 3, 0], tenor: ["C", 4, 0], treble_8: ["G", 2, -1], bass_8: ["F", 4, -1], soprano: ["C", 1, 0], percussion: ["percussion", 0, 0],
};
const KIND_OF_CHORD = [
  [/^maj7|^Δ7?/, "major-seventh"], [/^m7b5|^ø/, "half-diminished"], [/^(m|min|-)7/, "minor-seventh"], [/^(dim|°)7/, "diminished-seventh"], [/^(m|min|-)/, "minor"],
  [/^(dim|°)/, "diminished"], [/^(aug|\+)/, "augmented"], [/^7/, "dominant"], [/^sus4/, "suspended-fourth"], [/^sus2/, "suspended-second"], [/^6/, "major-sixth"], [/^9/, "dominant-ninth"],
];

/** A chord symbol, "F#m7/C#", as <harmony>; null for one it cannot read. */
function harmony(text) {
  const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/.exec(text.trim());
  if (!m) return null;
  const alter = (a) => (a === "#" || a === "♯" ? 1 : a === "b" || a === "♭" ? -1 : 0);
  const kind = KIND_OF_CHORD.find(([re]) => re.test(m[3]))?.[1] ?? (m[3] ? "other" : "major");
  let out = `<harmony><root><root-step>${m[1]}</root-step>${alter(m[2]) ? `<root-alter>${alter(m[2])}</root-alter>` : ""}</root>`;
  out += `<kind text="${xml(m[3])}">${kind}</kind>`;
  if (m[4]) out += `<bass><bass-step>${m[4]}</bass-step>${alter(m[5]) ? `<bass-alter>${alter(m[5])}</bass-alter>` : ""}</bass>`;
  return `${out}</harmony>`;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** The interval a transposing staff is written at above its sound: { diatonic, chromatic }, or null. */
function writtenInterval(staff) {
  const at = M.transpositionOf(staff);
  if (!at) return null;
  const m = /^([a-g])((?:is|es|s)*)([',]*)$/.exec(at);
  if (!m) return null;
  const step = "cdefgab".indexOf(m[1]);
  const alter = (m[2].match(/is/g)?.length ?? 0) - (m[2].match(/es|^s/g)?.length ?? 0);
  const octave = (m[3].match(/'/g)?.length ?? 0) - (m[3].match(/,/g)?.length ?? 0);
  return { diatonic: step + 7 * octave, chromatic: NATURAL[step] + alter + 12 * octave };
}

/** The editor's score as a MusicXML 4.0 partwise document. */
export function toMusicXML(score) {
  const quarter = M.WHOLE / 4;
  // Divisions a quarter: as coarse as every value and bar of the score allows.
  let grain = quarter;
  for (const staff of score.staves) for (const ev of staff.events) grain = gcd(grain, Math.round(M.ticksOf(ev)));
  const divisions = quarter / grain;
  const dur = (ticks) => Math.round(ticks / grain);
  const bars = M.barsOf(score);

  // Parts: a brace of two staves is one part (a piano); every other staff its own.
  const uppers = M.staffLanes(score);
  const parts = [];
  const braced = new Set();
  for (const g of score.groups ?? []) {
    if (g.kind === "brace" && g.last === g.first + 1) {
      parts.push({ staves: [uppers[g.first], uppers[g.last]], name: g.name || "", short: g.short || "" });
      braced.add(g.first).add(g.last);
    }
  }
  uppers.forEach((s, k) => {
    if (!braced.has(k)) parts.push({ staves: [s], name: score.staves[s].name || "", short: score.staves[s].short || "" });
  });
  parts.sort((a, b) => a.staves[0] - b.staves[0]);
  parts.forEach((p, k) => {
    p.id = `P${k + 1}`;
    const staff = score.staves[p.staves[0]];
    // A staff with no name: one for the other programs' lists, not printed.
    p.hidden = !p.name;
    if (!p.name) p.name = `Staff ${k + 1}`;
  });

  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">', '<score-partwise version="4.0">'];
  const title = score.header?.title;
  if (title && title !== "Untitled") out.push(`<work><work-title>${xml(title)}</work-title></work>`);
  const h = score.header ?? {};
  out.push("<identification>");
  if (h.composer) out.push(`<creator type="composer">${xml(h.composer)}</creator>`);
  if (h.arranger) out.push(`<creator type="arranger">${xml(h.arranger)}</creator>`);
  if (h.poet) out.push(`<creator type="lyricist">${xml(h.poet)}</creator>`);
  if (h.copyright) out.push(`<rights>${xml(h.copyright)}</rights>`);
  out.push("<encoding><software>eui-score</software></encoding></identification>");
  if (h.subtitle) out.push(`<credit page="1"><credit-type>subtitle</credit-type><credit-words>${xml(h.subtitle)}</credit-words></credit>`);
  // The groups of staves, as groups of the parts holding them; a piano's own brace is its part.
  const partOfStaff = (k) => parts.findIndex((p) => p.staves.includes(uppers[k]));
  const symbols = { brace: ["brace", "yes"], bracket: ["bracket", "yes"], choir: ["bracket", "no"] };
  const partGroups = [];
  if (symbols[score.group] && parts.length > 1) partGroups.push({ kind: score.group, first: 0, last: parts.length - 1, name: "", short: "" });
  for (const g of score.groups ?? []) {
    const first = partOfStaff(g.first);
    const last = partOfStaff(g.last);
    if (symbols[g.kind] && first >= 0 && last > first) partGroups.push({ ...g, first, last });
  }
  out.push("<part-list>");
  for (const [k, p] of parts.entries()) {
    partGroups.forEach((g, n) => {
      if (g.first !== k) return;
      const [symbol, barline] = symbols[g.kind];
      out.push(`<part-group type="start" number="${n + 1}">${g.name ? `<group-name>${xml(g.name)}</group-name>` : ""}${g.short ? `<group-abbreviation>${xml(g.short)}</group-abbreviation>` : ""}<group-symbol>${symbol}</group-symbol><group-barline>${barline}</group-barline></part-group>`);
    });
    const staff = score.staves[p.staves[0]];
    out.push(`<score-part id="${p.id}"><part-name${p.hidden ? ' print-object="no"' : ""}>${xml(p.name)}</part-name>${p.short ? `<part-abbreviation>${xml(p.short)}</part-abbreviation>` : ""}`);
    if (staff.drums) {
      for (const drum of M.DRUMS) out.push(`<score-instrument id="${p.id}-${drum.name}"><instrument-name>${xml(drum.label)}</instrument-name></score-instrument>`);
      for (const drum of M.DRUMS) out.push(`<midi-instrument id="${p.id}-${drum.name}"><midi-channel>10</midi-channel><midi-unpitched>${drum.key + 1}</midi-unpitched></midi-instrument>`);
    } else {
      out.push(`<score-instrument id="${p.id}-I1"><instrument-name>${xml(p.name || "Piano")}</instrument-name></score-instrument>`);
      out.push(`<midi-instrument id="${p.id}-I1"><midi-program>${M.programOf(staff.instrument) + 1}</midi-program></midi-instrument>`);
    }
    out.push("</score-part>");
    partGroups.forEach((g, n) => {
      if (g.last === k) out.push(`<part-group type="stop" number="${n + 1}"/>`);
    });
  }
  out.push("</part-list>");

  // Repeats as bar lines: { bar: { left: […], right: […] } }.
  const lines = {};
  const line = (b, side, text) => {
    lines[b] ??= { left: [], right: [] };
    lines[b][side].push(text);
  };
  for (const r of score.repeats ?? []) {
    line(r.from, "left", '<repeat direction="forward"/>');
    if (!r.endings.length) line(r.to, "right", '<repeat direction="backward"/>');
    let at = r.to + 1;
    r.endings.forEach((len, k) => {
      const last = k === r.endings.length - 1;
      line(at, "left", `<ending number="${k + 1}" type="start"/>`);
      line(at + len - 1, "right", last ? `<ending number="${k + 1}" type="discontinue"/>` : `<ending number="${k + 1}" type="stop"/><repeat direction="backward"/>`);
      at += len;
    });
  }

  let letters = 0;
  const marks = {};
  for (const c of score.changes ?? []) if (c.mark === "letter") marks[c.bar] = String.fromCharCode(65 + letters++ % 26);

  for (const p of parts) {
    out.push(`<part id="${p.id}">`);
    // Each staff's lanes, its events with their start, by bar.
    const lanesOf = p.staves.map((s) => {
      const lower = M.lowerOf(score, s);
      return [s, ...(lower >= 0 ? [lower] : [])].map((lane) => {
        const at = M.starts(score.staves[lane]);
        return score.staves[lane].events.map((ev, i) => ({ ev, t: at[i], bar: M.barAt(score, at[i]), i, lane }));
      });
    });
    const interval = writtenInterval(score.staves[p.staves[0]]);
    const drums = Boolean(score.staves[p.staves[0]].drums);
    for (let b = 0; b < bars; b++) {
      const change = M.changeAt(score, b);
      const brk = score.breaks?.[b - 1];
      out.push(`<measure number="${b + 1}">`);
      if (b > 0 && brk) out.push(brk === "page" ? '<print new-page="yes"/>' : '<print new-system="yes"/>');
      const bl = lines[b]?.left;
      if (bl?.length) out.push(`<barline location="left">${bl.join("")}</barline>`);
      // The attributes: all of them at the start, then what changes.
      const attrs = [];
      if (b === 0) attrs.push(`<divisions>${divisions}</divisions>`);
      const key = b === 0 ? score.staves[p.staves[0]].key ?? score.key : change?.key;
      if (key != null && !drums) attrs.push(`<key><fifths>${interval ? writtenKey(key, interval) : key}</fifths></key>`);
      const time = b === 0 ? score.time : change?.time;
      if (time) attrs.push(`<time><beats>${b === 0 && score.timeParts ? score.timeParts.join("+") : time[0]}</beats><beat-type>${time[1]}</beat-type></time>`);
      if (b === 0 && p.staves.length > 1) attrs.push(`<staves>${p.staves.length}</staves>`);
      p.staves.forEach((s, k) => {
        const staff = score.staves[s];
        const clef = b === 0 ? (staff.drums ? "percussion" : staff.clef) : staff.clefs?.find((c) => c.bar === b)?.clef;
        if (!clef) return;
        const [sign, lineNo, octave] = CLEFS_OUT[clef] ?? CLEFS_OUT.treble;
        attrs.push(`<clef${p.staves.length > 1 ? ` number="${k + 1}"` : ""}><sign>${sign}</sign>${lineNo ? `<line>${lineNo}</line>` : ""}${octave ? `<clef-octave-change>${octave}</clef-octave-change>` : ""}</clef>`);
      });
      if (b === 0 && interval) attrs.push(`<transpose><diatonic>${-(interval.diatonic % 7)}</diatonic><chromatic>${-(interval.chromatic % 12)}</chromatic>${Math.trunc(interval.diatonic / 7) ? `<octave-change>${-Math.trunc(interval.diatonic / 7)}</octave-change>` : ""}</transpose>`);
      if (attrs.length) out.push(`<attributes>${attrs.join("")}</attributes>`);
      // The bar's marks and tempo, over the first staff.
      if (p === parts[0]) {
        if (marks[b]) out.push(`<direction placement="above"><direction-type><rehearsal>${marks[b]}</rehearsal></direction-type></direction>`);
        if (change?.mark === "segno") out.push('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>');
        if (change?.mark === "coda") out.push('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>');
        const tempo = b === 0 ? score.tempo : change?.tempo;
        if (tempo) out.push(tempoDirection(tempo));
      }
      const barLength = M.barLength(score, b);
      lanesOf.forEach((lanes, k) => {
        lanes.forEach((lane, v) => {
          if (k > 0 || v > 0) out.push(`<backup><duration>${dur(barLength)}</duration></backup>`);
          const voice = k * 4 + v + 1;
          const staffNo = p.staves.length > 1 ? k + 1 : 0;
          for (const item of lane.filter((x) => x.bar === b)) out.push(...noteXml(lane, item, { voice, staffNo, dur, barLength, interval, drums, firstLane: v === 0, part: p.id }));
        });
      });
      if (p === parts[0] && change?.jump) {
        const j = change.jump;
        const sound = j.startsWith("ds") ? ' dalsegno="segno"' : j.startsWith("dc") ? ' dacapo="yes"' : j === "fine" ? ' fine="yes"' : j === "to-coda" ? ' tocoda="coda"' : "";
        out.push(`<direction placement="above"><direction-type><words font-style="italic">${xml(M.JUMPS[j] ?? j)}</words></direction-type>${sound ? `<sound${sound}/>` : ""}</direction>`);
      }
      const right = [...(lines[b]?.right ?? [])];
      const next = M.changeAt(score, b + 1);
      const style = b === bars - 1 ? "light-heavy" : next?.line === "||" ? "light-light" : right.some((x) => x.includes("backward")) ? "light-heavy" : null;
      if (right.length || style) out.push(`<barline location="right">${style ? `<bar-style>${style}</bar-style>` : ""}${right.join("")}</barline>`);
      out.push("</measure>");
    }
    out.push("</part>");
  }
  out.push("</score-partwise>");
  return out.join("\n") + "\n";
}

/** A number of fifths spelled as a key: within six flats and five sharps… or six sharps, F♯. */
function spellFifths(k) {
  return (((k % 12) + 12 + 6) % 12) - 6;
}

/** A key's fifths as a transposing staff writes it: each semitone up adds 7 fifths. */
function writtenKey(fifths, interval) {
  return spellFifths(fifths + 7 * interval.chromatic);
}

function tempoDirection(tempo) {
  const unit = TYPE_OF[tempo.base] ?? "quarter";
  const words = tempo.text ? `<direction-type><words font-weight="bold">${xml(tempo.text)}</words></direction-type>` : "";
  const metronome = tempo.bpm ? `<direction-type><metronome><beat-unit>${unit}</beat-unit><per-minute>${tempo.bpm}</per-minute></metronome></direction-type>` : "";
  const sound = tempo.bpm ? `<sound tempo="${+((tempo.bpm * 4) / (tempo.base || 4)).toFixed(2)}"/>` : "";
  return `<direction placement="above">${words}${metronome}${sound}</direction>`;
}

/** One event of a lane as <note> elements (a chord's heads one after the other), with its directions before. */
function noteXml(lane, item, { voice, staffNo, dur, barLength, interval, drums, firstLane, part }) {
  const { ev, i } = item;
  const before = lane[i - 1]?.ev;
  const after = lane[i + 1]?.ev;
  const out = [];
  const staffTag = staffNo ? `<staff>${staffNo}</staff>` : "";
  const direction = (type, placement = "below") => `<direction placement="${placement}"><direction-type>${type}</direction-type>${staffTag}</direction>`;
  if (ev.chord && firstLane) {
    const h = harmony(ev.chord);
    out.push(h ?? direction(`<words>${xml(ev.chord)}</words>`, "above"));
  }
  if (ev.dynamic) out.push(direction(`<dynamics><${ev.dynamic}/></dynamics>`));
  if (ev.hairpinEnd) out.push(direction('<wedge type="stop"/>'));
  if (ev.hairpin) out.push(direction(`<wedge type="${ev.hairpin === "<" ? "crescendo" : "diminuendo"}"/>`));
  for (const t of ev.texts) out.push(direction(`<words${t.italic ? ' font-style="italic"' : ""}>${xml(t.text)}</words>`, t.dir > 0 ? "below" : "above"));
  if (ev.pedalOff) out.push(direction('<pedal type="stop"/>'));
  if (ev.pedalOn) out.push(direction('<pedal type="start" line="no" sign="yes"/>'));

  const pitchXml = (p) => {
    if (drums) {
      const step = ((p.d % 7) + 7) % 7;
      return `<unpitched><display-step>${STEPS[step]}</display-step><display-octave>${Math.floor(p.d / 7) + 3}</display-octave></unpitched>`;
    }
    let d = p.d;
    let key = M.midiKey(p.d, p.alter);
    if (interval) {
      d += interval.diatonic;
      key += interval.chromatic;
    }
    const step = ((d % 7) + 7) % 7;
    const octave = Math.floor(d / 7) + 3;
    const alter = key - M.midiKey(d, 0);
    return `<pitch><step>${STEPS[step]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
  };
  const instrumentTag = (p) => (drums && M.DRUMS.some((x) => x.name === p.drum) ? `<instrument id="${part}-${p.drum}"/>` : "");

  // Grace notes first, without a duration.
  if (ev.graces.length && !ev.rest) {
    for (const g of ev.graces) {
      g.pitches.forEach((p, k) => {
        out.push(`<note><grace${ev.grace === "acciaccatura" || ev.grace === "slashedGrace" ? ' slash="yes"' : ""}/>${k ? "<chord/>" : ""}${pitchXml(p)}<voice>${voice}</voice><type>${TYPE_OF[g.base] ?? "eighth"}</type>${"<dot/>".repeat(g.dots)}${staffTag}</note>`);
      });
    }
  }

  const ticks = M.ticksOf(ev);
  const wholeBar = ev.rest && !ev.tuplet && Math.abs(ticks - barLength) < 1e-6;
  const type = `<type>${TYPE_OF[ev.base] ?? "quarter"}</type>${"<dot/>".repeat(ev.dots)}`;
  const tm = ev.tuplet ? `<time-modification><actual-notes>${ev.tuplet.n}</actual-notes><normal-notes>${ev.tuplet.d}</normal-notes></time-modification>` : "";
  const tiedFrom = before && before.tie && !before.rest && !ev.rest;
  const heads = ev.rest ? [null] : ev.pitches;
  heads.forEach((p, k) => {
    const n = [];
    if (k) n.push("<chord/>");
    n.push(p ? pitchXml(p) : wholeBar ? '<rest measure="yes"/>' : "<rest/>");
    n.push(`<duration>${dur(ticks)}</duration>`);
    if (tiedFrom) n.push('<tie type="stop"/>');
    if (ev.tie && p) n.push('<tie type="start"/>');
    if (p) n.push(instrumentTag(p));
    n.push(`<voice>${voice}</voice>`);
    if (!wholeBar) n.push(type);
    n.push(tm);
    if (staffNo) n.push(staffTag);
    // Notations go on the first head only, but ties on each.
    const notations = [];
    if (tiedFrom) notations.push('<tied type="stop"/>');
    if (ev.tie && p) notations.push('<tied type="start"/>');
    if (k === 0) {
      if (ev.slurEnd) notations.push('<slur type="stop" number="1"/>');
      if (ev.slurStart) notations.push('<slur type="start" number="1"/>');
      if (ev.tuplet && !(before?.tuplet?.id === ev.tuplet.id)) notations.push('<tuplet type="start"/>');
      if (ev.tuplet && !(after?.tuplet?.id === ev.tuplet.id)) notations.push('<tuplet type="stop"/>');
      const arts = ev.arts.filter((a) => ARTICULATIONS_OUT[a]).map((a) => `<${ARTICULATIONS_OUT[a]}/>`);
      if (arts.length) notations.push(`<articulations>${arts.join("")}</articulations>`);
      const orns = ev.arts.filter((a) => ORNAMENTS_OUT[a]).map((a) => `<${ORNAMENTS_OUT[a]}/>`);
      if (ev.tremolo && p) orns.push(`<tremolo type="single">${Math.max(1, Math.log2(ev.tremolo / 4))}</tremolo>`);
      if (orns.length) notations.push(`<ornaments>${orns.join("")}</ornaments>`);
      if (ev.arts.includes("fermata")) notations.push("<fermata/>");
      if (before?.gliss && !ev.rest) notations.push('<glissando type="stop"/>');
      if (ev.gliss && p) notations.push('<glissando type="start"/>');
    }
    if (ev.arpeggio && p) notations.push("<arpeggiate/>");
    if (notations.length) n.push(`<notations>${notations.join("")}</notations>`);
    if (k === 0 && p && firstLane) n.push(...lyricsXml(lane, i));
    out.push(`<note>${n.join("")}</note>`);
  });
  return out;
}

/** An event's syllables, a <lyric> a verse. */
function lyricsXml(lane, i) {
  const out = [];
  const ev = lane[i].ev;
  const syllables = [ev.lyric, ...(ev.verses ?? [])];
  syllables.forEach((syl, k) => {
    if (!syl?.text) return;
    const verse = k + 1;
    // Inside a word when the last syllable of this verse before it carried a hyphen.
    let previous = null;
    for (let j = i - 1; j >= 0 && !previous; j--) previous = (verse === 1 ? lane[j].ev.lyric : lane[j].ev.verses?.[verse - 2]) ?? null;
    const inside = Boolean(previous?.hyphen);
    const syllabic = inside ? (syl.hyphen ? "middle" : "end") : syl.hyphen ? "begin" : "single";
    out.push(`<lyric number="${verse}"><syllabic>${syllabic}</syllabic><text>${xml(syl.text)}</text>${syl.extend ? "<extend/>" : ""}</lyric>`);
  });
  return out;
}

// ---- .mxl ---------------------------------------------------------------------------
//
// A compressed MusicXML file is a zip: its META-INF/container.xml names the
// score in it. Its entries are stored or deflated; the browser inflates.

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The entries of a zip: name → { method, data (still compressed) }. */
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record, searched from the end.
  let end = -1;
  for (let k = bytes.length - 22; k >= Math.max(0, bytes.length - 65557); k--) {
    if (view.getUint32(k, true) === 0x06054b50) {
      end = k;
      break;
    }
  }
  if (end < 0) throw new Error("This .mxl file is not a zip archive.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("This .mxl file's directory is damaged.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, { method, data: bytes.subarray(dataAt, dataAt + size) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The MusicXML text a .mxl file holds. */
export async function unzipMxl(bytes) {
  const entries = zipEntries(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const read = async (name) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`This .mxl file names ${name}, which it does not hold.`);
    if (entry.method === 0) return new TextDecoder().decode(entry.data);
    if (entry.method === 8) return new TextDecoder().decode(await inflate(entry.data));
    throw new Error("This .mxl file is compressed in a way this page does not read.");
  };
  let name = null;
  if (entries.has("META-INF/container.xml")) {
    const container = parseXml(await read("META-INF/container.xml"));
    name = kid(kid(container, "rootfiles"), "rootfile")?.attrs["full-path"] ?? null;
  }
  name ??= [...entries.keys()].find((n) => !n.startsWith("META-INF/") && /\.(xml|musicxml)$/i.test(n));
  if (!name) throw new Error("This .mxl file holds no score.");
  return read(name);
}

/** A file's MusicXML text, whichever form it comes in: plain or compressed. */
export async function musicXmlOf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A zip starts "PK".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return unzipMxl(bytes);
  return new TextDecoder().decode(bytes);
}

/** Whether a file's name is a MusicXML one. */
export function isMusicXml(name) {
  return /\.(musicxml|mxl|xml)$/i.test(name ?? "");
}
