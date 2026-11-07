// What each staff plays, in the mixer (#391): its General MIDI instrument
// from the default sounds, the subtractive synthesizer (synth.js) with its
// knobs, or a preset of a SoundFont of your own (soundbank.js). And the
// MPE keyboard (mpe.js): its per-note bend and pressure heard live.
//
//   const inst = installInstruments({ root, st, M, P, edit, say });
//   inst.html(lane);                     // the strip's Instrument part (mixer-ui.js)
//   const sound = await inst.prepare(score);   // before Play or Save the sound
//   const { bytes, notes } = inst.forSound(midi, sound);
//
// The studio (studio.js) plays `bytes` with SpessaSynth and `notes` with
// the synthesizer, into the staves' mixer strips.

const SEARCH = new URL(import.meta.url).search;
const V = SEARCH;
const { tr } = await import(`./words.js${V}`);
const Sy = await import(`./synth.js${SEARCH}`);
const Sb = await import(`./soundbank.js${SEARCH}`);
const { MpeInput } = await import(`./mpe.js${SEARCH}`);

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MPE_KEPT = "eui-score-mpe";

/** A knob's value as words. */
export function knobText(field, value) {
  const v = Number(value);
  const [, name] = field.split(".");
  if (name === "detune") return `${v > 0 ? "+" : ""}${Math.round(v)} ct`;
  if (name === "octave") return `${v > 0 ? "+" : ""}${v} oct`;
  if (name === "cutoff") return `${Math.round(Sy.cutoffHz(v))} Hz`;
  if (["attack", "decay", "release"].includes(name)) return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (name === "env") return `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;
  return `${Math.round(v * 100)} %`;
}

/** The patch a knob's value makes: "filter.cutoff" → { filter: { cutoff } }. */
export function synthPatch(field, value) {
  const [group, name] = field.split(".");
  if (!name) return { [group]: value };
  return { [group]: { [name]: name === "wave" ? value : Number(value) } };
}

/** The synthesizer's knobs, as HTML: for lane `lane`, settings `s` (synth.js `settings`). */
export function synthHtml(lane, s) {
  const range = (field, min, max, step, label) => {
    const [g, n] = field.split(".");
    const value = s[g][n];
    return `<label class="mixer-field"><span>${label}</span><input type="range" data-inst="${field}" data-inst-lane="${lane}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output>${knobText(field, value)}</output></label>`;
  };
  const waves = (k) =>
    `<label class="mixer-field"><span>${tr("Wave")}</span><select data-inst="${k}.wave" data-inst-lane="${lane}" aria-label="${tr("Oscillator {n} wave", { n: k.at(-1) })}">${Sy.WAVES.map((w) => `<option value="${w}"${s[k].wave === w ? " selected" : ""}>${Sy.WAVE_NAMES[w]}</option>`).join("")}</select></label>`;
  const presets = Object.entries(Sy.PRESETS)
    .map(([id, p]) => `<option value="${id}"${s.preset === id ? " selected" : ""}>${p.name}</option>`)
    .join("");
  const osc = (k, n) => `<div class="mixer-fx-group"><b>${tr("Oscillator {n}", { n })}</b>${waves(k)}${range(`${k}.detune`, -100, 100, 1, tr("Detune"))}${range(`${k}.octave`, -2, 2, 1, tr("Octave"))}${range(`${k}.level`, 0, 1, 0.01, tr("Level"))}</div>`;
  return `<label class="mixer-field"><span>${tr("Preset")}</span><select data-inst="preset" data-inst-lane="${lane}" aria-label="${tr("Synthesizer preset")}">${presets}</select></label>
    ${osc("osc1", 1)}${osc("osc2", 2)}
    <div class="mixer-fx-group"><b>${tr("Low-pass filter")}</b>${range("filter.cutoff", 0, 1, 0.01, tr("Cutoff"))}${range("filter.resonance", 0, 1, 0.01, tr("Resonance"))}${range("filter.env", -1, 1, 0.01, tr("Envelope"))}</div>
    <div class="mixer-fx-group"><b>${tr("Envelope")}</b>${range("amp.attack", 0.001, 5, 0.001, tr("Attack"))}${range("amp.decay", 0.001, 5, 0.001, tr("Decay"))}${range("amp.sustain", 0, 1, 0.01, tr("Sustain"))}${range("amp.release", 0.005, 8, 0.005, tr("Release"))}</div>`;
}

export function installInstruments({ root, st, M, P, edit, say }) {
  // The SoundFonts loaded in this visit: hash → { name, presets, bytes }; and those kept in this browser (no bytes).
  const loaded = new Map();
  let kept = [];
  let keptRead = null;
  const told = new Set();
  // A knob being moved: heard before it is let go (lane → patch).
  const moving = new Map();

  const refreshKept = () =>
    (keptRead = Sb.list().then((list) => {
      kept = list;
      st.mixer?.refresh();
      return list;
    }));
  refreshKept();

  const fontInfo = (hash) => loaded.get(hash) ?? kept.find((k) => k.hash === hash) ?? null;
  const fontsKnown = () => {
    const out = new Map();
    for (const k of kept) out.set(k.hash, k);
    for (const [hash, f] of loaded) out.set(hash, { hash, ...f });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  /** Lane `lane`'s synthesizer as heard: the score's, a knob being moved laid over it. */
  function synthHeard(lane) {
    const s = Sy.synthOf(st.score, lane);
    if (!s) return null;
    const patch = moving.get(lane);
    if (!patch) return s;
    const now = { ...s };
    for (const k of ["osc1", "osc2", "filter", "amp"]) now[k] = { ...s[k], ...(patch[k] ?? {}) };
    return Sy.settings(now);
  }

  /** The Instrument part of lane `lane`'s strip, as HTML. */
  function html(lane) {
    const score = st.score;
    if (!score?.staves?.[lane] || score.staves[lane].drums) return "";
    const synth = Sy.synthOf(score, lane);
    const font = Sb.soundfontOf(score, lane);
    const kind = synth ? "synth" : font ? "sf" : "gm";
    const choose = `<label class="mixer-field"><span>${tr("Sound")}</span><select data-inst="kind" data-inst-lane="${lane}" aria-label="${tr("What this staff plays")}">
      <option value="gm"${kind === "gm" ? " selected" : ""}>General MIDI</option>
      <option value="synth"${kind === "synth" ? " selected" : ""}>${tr("Synthesizer")}</option>
      <option value="sf"${kind === "sf" ? " selected" : ""}>${tr("Own SoundFont")}</option></select></label>`;
    let body = "";
    if (synth) body = synthHtml(lane, synth);
    else if (font) {
      const info = fontInfo(font.hash);
      const fonts = fontsKnown();
      if (!fonts.some((f) => f.hash === font.hash)) fonts.unshift({ hash: font.hash, name: font.name });
      const files = fonts.map((f) => `<option value="${f.hash}"${f.hash === font.hash ? " selected" : ""}>${escape(f.name)}</option>`).join("") + `<option value="load">${tr("Load an SF2 or SF3 file…")}</option>`;
      const presets = (info?.presets ?? [{ name: font.preset || tr("Preset {n}", { n: font.program }), bank: font.bank, program: font.program }])
        .map((p) => `<option value="${p.bank}:${p.program}"${p.bank === font.bank && p.program === font.program ? " selected" : ""}>${String(p.bank).padStart(3, "0")}:${String(p.program).padStart(3, "0")} ${escape(p.name)}</option>`)
        .join("");
      body = `<label class="mixer-field"><span>${tr("File")}</span><select data-inst="font" data-inst-lane="${lane}" aria-label="${tr("SoundFont file")}">${files}</select></label>
        <label class="mixer-field"><span>${tr("Preset")}</span><select data-inst="sf-preset" data-inst-lane="${lane}" aria-label="${tr("SoundFont preset")}">${presets}</select></label>
        ${info ? "" : `<p class="mixer-inst-missing" role="note">${tr("{name} is not in this browser: the default sounds play this staff. Load the file to hear it.", { name: escape(font.name) })}</p>`}`;
    }
    return `<details class="mixer-fx mixer-inst" data-inst-part="${lane}"${kind !== "gm" ? " open" : ""}><summary>${kind === "synth" ? tr("Instrument · Synthesizer") : kind === "sf" ? tr("Instrument · SoundFont") : tr("Instrument")}</summary>${choose}${body}</details>`;
  }

  // ---- Choosing ------------------------------------------------------------------------

  const picker = Object.assign(document.createElement("input"), { type: "file", accept: ".sf2,.sf3", hidden: true });
  picker.dataset.instFile = "";
  root.append(picker);
  let pickFor = null;

  function setKind(lane, kind) {
    if (kind === "sf") {
      const first = fontsKnown()[0];
      if (!first) return pick(lane);
      return useFont(lane, first.hash);
    }
    edit((score) => {
      Sb.setSoundfont(score, lane, null);
      Sy.setSynth(score, lane, kind === "synth" ? { preset: Sy.DEFAULT_PRESET } : null);
    });
    say(kind === "synth" ? tr("This staff plays the synthesizer: its preset and knobs are in the mixer, kept with the score.") : tr("This staff plays its General MIDI instrument again."));
    st.mixer?.refresh();
  }

  function useFont(lane, hash, choice = null) {
    const info = fontInfo(hash);
    const preset = choice ?? info?.presets?.[0];
    if (!info || !preset) return say(tr("That SoundFont is not in this browser: load the file again."), true);
    edit((score) => {
      Sy.setSynth(score, lane, null);
      Sb.setSoundfont(score, lane, { name: info.name, hash, bank: preset.bank, program: preset.program, preset: preset.name });
    });
    st.mixer?.refresh();
  }

  function pick(lane) {
    pickFor = lane;
    picker.value = "";
    picker.click();
  }

  /** A SoundFont file read, checked, kept (in this browser when it can), and given to lane `lane`. */
  async function loadFile(file, lane) {
    const bytes = await file.arrayBuffer();
    const wrong = Sb.refusal(file.name, bytes);
    if (wrong) return say(wrong, true);
    let presets;
    try {
      presets = Sb.presetsOf(bytes);
    } catch (error) {
      return say(`${file.name}: ${error.message}`, true);
    }
    if (!presets.length) return say(tr("{name} has no melodic preset to play.", { name: file.name }), true);
    const hash = await Sb.hashOf(bytes);
    loaded.set(hash, { name: file.name, presets, bytes });
    const keptHere = await Sb.keep({ hash, name: file.name, bytes, presets });
    await refreshKept();
    say(
      keptHere
        ? tr("{name}: {count} presets, kept in this browser. The score keeps its name and the preset chosen.", { name: file.name, count: presets.length })
        : tr("{name}: {count} presets, for this visit only (this browser keeps no files). The score keeps its name and the preset chosen.", { name: file.name, count: presets.length })
    );
    if (lane != null && st.score) useFont(lane, hash);
    return hash;
  }

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file) loadFile(file, pickFor).catch((error) => say(tr("The SoundFont could not be read: {reason}", { reason: error.message ?? error }), true));
  });

  /** The mixer's panel: its Instrument controls listened to. */
  function bind(panel) {
    const laneOf = (el) => Number(el.dataset.instLane);
    panel.addEventListener("input", (event) => {
      const control = event.target.closest("input[data-inst]");
      if (!control) return;
      const out = control.parentElement.querySelector("output");
      if (out) out.textContent = knobText(control.dataset.inst, control.value);
      const lane = laneOf(control);
      const patch = synthPatch(control.dataset.inst, control.value);
      const was = moving.get(lane) ?? {};
      for (const [k, v] of Object.entries(patch)) was[k] = { ...(was[k] ?? {}), ...v };
      moving.set(lane, was);
    });
    panel.addEventListener("change", (event) => {
      const control = event.target.closest("[data-inst]");
      if (!control) return;
      const lane = laneOf(control);
      const field = control.dataset.inst;
      moving.delete(lane);
      if (field === "kind") return setKind(lane, control.value);
      if (field === "font") return control.value === "load" ? pick(lane) : useFont(lane, control.value);
      if (field === "sf-preset") {
        const font = Sb.soundfontOf(st.score, lane);
        const [bank, program] = control.value.split(":").map(Number);
        const preset = fontInfo(font?.hash)?.presets?.find((p) => p.bank === bank && p.program === program);
        return font && preset && useFont(lane, font.hash, preset);
      }
      edit((score) => Sy.setSynth(score, lane, field === "preset" ? { preset: control.value } : synthPatch(field, control.value)));
      st.mixer?.refresh();
    });
  }

  // ---- Heard ---------------------------------------------------------------------------

  /** Tells, once a visit, of a staff whose SoundFont is not in this browser. */
  function tellMissing(missing) {
    const fresh = missing.filter((m) => !told.has(m.name));
    if (!fresh.length) return;
    for (const m of fresh) told.add(m.name);
    const names = [...new Set(fresh.map((m) => m.name))].join(", ");
    const staves = fresh.map((m) => st.score?.staves?.[m.lane]?.name || tr("staff {n}", { n: m.lane + 1 })).join(", ");
    say(
      fresh.length === 1
        ? tr("{names} is not in this browser: {staves} plays the default sounds. Load the file in the mixer to hear it.", { names, staves })
        : tr("{names} is not in this browser: {staves} play the default sounds. Load the file in the mixer to hear it.", { names, staves })
    );
  }

  /** On each draw: a score just opened whose SoundFont this browser does not have is told of. */
  async function check() {
    const lanes = Object.keys(st.score?.meta?.soundfont ?? {});
    if (!lanes.length) return;
    await keptRead;
    const missing = lanes.map(Number).map((lane) => ({ lane, font: Sb.soundfontOf(st.score, lane) })).filter((x) => x.font && !fontInfo(x.font.hash));
    tellMissing(missing.map((x) => ({ lane: x.lane, name: x.font.name })));
  }

  /**
   * What `score` needs to be heard (Play, Save the sound): its SoundFonts
   * given to the synthesizer, the presets its staves play, the channels the
   * synthesizer plays. Says which files this browser does not have.
   */
  async function prepare(score) {
    const channels = score ? M.channels(score) : [];
    const synth = new Map();
    for (const { lane, channel } of channels) if (Sy.synthOf(score, lane)) synth.set(channel, lane);
    if (!score?.meta?.soundfont) return { presets: [], synth };
    await (keptRead ?? refreshKept());
    const available = new Set([...loaded.keys(), ...kept.map((k) => k.hash)]);
    const plan = Sb.plan(score, channels, available);
    for (const font of plan.fonts) {
      const bytes = loaded.get(font.hash)?.bytes ?? (await Sb.load(font.hash))?.bytes;
      if (bytes) await P.useBank(font.hash, bytes, font.offset);
      else plan.missing.push({ lane: -1, name: font.name });
    }
    tellMissing(plan.missing.filter((m) => m.lane >= 0));
    return { presets: plan.presets, synth };
  }

  /** `bytes` (the heard MIDI) as SpessaSynth plays it — the synthesizer's notes taken out, own presets put in — and those notes. */
  function forSound(bytes, sound) {
    const channels = new Set(sound.synth.keys());
    const notes = Sy.notesOf(bytes, channels);
    return { bytes: Sb.applyPresets(Sy.stripNotes(bytes, channels), sound.presets), notes };
  }

  /** The synthesizer of the staff on `channel` while `sound` plays. */
  const settingsFor = (sound) => (channel) => synthHeard(sound.synth.get(channel)) ?? Sy.settings();

  // The keys played live on a synthesizer staff: through the master, so the
  // staff being recorded into (muted on its strip) is still heard.
  const live = Sy.liveKeys({
    context: () => P.unlock(),
    settingsOf: (channel) => {
      const row = st.score ? M.channels(st.score).find((r) => r.channel === channel) : null;
      return row ? synthHeard(row.lane) : null;
    },
    destinationOf: () => st.liveMixer?.master.input ?? P.unlock().destination,
  });
  const unvoice = P.setVoicer((channel, key, on, velocity) => (on ? live.on(channel, key, velocity) : live.off(channel, key)));

  // ---- MPE -----------------------------------------------------------------------------

  const mpeBox = root.querySelector("[data-mpe]");
  let manual = false;
  try {
    manual = localStorage.getItem(MPE_KEPT) === "1";
  } catch (error) {}
  if (mpeBox) mpeBox.checked = manual;
  let mpe = new MpeInput({ manual });
  mpeBox?.addEventListener("change", () => {
    manual = mpeBox.checked;
    mpe = new MpeInput({ manual });
    try {
      localStorage.setItem(MPE_KEPT, manual ? "1" : "0");
    } catch (error) {}
    say(manual ? tr("MPE keyboard: each note's bend and pressure heard on its own; recorded, they go to the staff's Pitch bend and Pressure curves.") : tr("MPE keyboard off: the keyboard's bend moves every note."));
  });

  // Each message of the keyboard, read for MPE first: a note's own bend and
  // pressure sound on its voice; the others hear them folded into the
  // staff's (the bend of the note struck last, the hardest pressure).
  const untranslate = P.translate((data) => {
    const events = mpe.message(data);
    for (const e of events) {
      if (e.type === "zone") {
        if (mpeBox) mpeBox.checked = e.members > 0 || manual;
        const found =
          e.zone === "upper"
            ? tr("MPE keyboard found: {count} member channels (upper zone). Each note's bend and pressure are heard on its own.", { count: e.members })
            : tr("MPE keyboard found: {count} member channels (lower zone). Each note's bend and pressure are heard on its own.", { count: e.members });
        say(e.members ? found : tr("The MPE keyboard's zone is off."));
      } else if (e.type === "bend") {
        for (const key of e.key == null ? live.held : [e.key]) live.expression(key, { bend: e.semitones });
      } else if (e.type === "pressure") live.expression(e.key, { pressure: e.value });
    }
    if (!mpe.active) return data;
    const kind = data[0] & 0xf0;
    const channel = data[0] & 15;
    // The configuration, read: not a knob to learn.
    if (kind === 0xb0 && [6, 38, 100, 101].includes(data[1]) && mpe.managerOf(channel)) return null;
    if (!mpe.zoneOf(channel)) return data;
    if (kind === 0xe0) {
      const v = mpe.staffBend() + 8192;
      return [0xe0, v & 127, v >> 7];
    }
    if (kind === 0xd0) return [0xd0, mpe.staffPressure()];
    return data;
  });

  return {
    html,
    bind,
    check,
    prepare,
    forSound,
    settingsFor,
    loadFile,
    /** The editor is gone (instant navigation): the keyboard's messages and keys no longer come here. */
    end() {
      untranslate();
      unvoice();
    },
    get mpe() {
      return mpe;
    },
  };
}
