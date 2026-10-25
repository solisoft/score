// The studio's mix (studio.js): mute, solo and the mixer (mixer.js,
// mixer-ui.js), the instruments (instruments-ui.js), the audio tracks
// (audio-ui.js).

/** The mixer, the instruments and the audio tracks set up; answers the mix as heard. */
export function install(ctx) {
  const { root, options, st, quantizeBox, M, P, R, X, mixerPanel, Sy, installInstruments, audioTracks } = ctx;
  const {
    barNo, edit, changeBar, keepOn, draw, say, heardMidi, playOption, exportPractice, togglePlay, stopPlay, laneName
  } = ctx.call;

  // ---- Mute, solo, and where the sound goes ----------------------------------------

  // The mixer (mixer.js) is the score's: kept in its text, one Undo away,
  // its M and S the same as the Playback section's. Its graph is built on
  // Play's AudioContext with the synthesizer, and again on each WAV's.

  /** Mute and solo as the Playback section shows them: the score's mixer's, and the staff recorded into. */
  function mixFromMeta() {
    const mix = X.mixOf(st.score);
    st.mix = { mute: new Set(X.lanesWith(mix, "mute")), solo: new Set(X.lanesWith(mix, "solo")) };
    if (st.recording?.mutedByRecording) st.mix.mute.add(st.recording.lane);
  }
  mixFromMeta();

  /** The mixer as heard: the score's, or the one a moving fader previews; the staff recorded into silent. */
  function mixHeard() {
    // A stem being made: its staff alone.
    if (st.stemMix) return st.stemMix;
    const mix = st.heardMix ?? X.mixOf(st.score);
    return st.recording?.mutedByRecording ? (X.patched(mix, st.recording.lane, { mute: true }) ?? {}) : mix;
  }

  // Play's mixer goes out through the MIDI-learn volume (player.js), a WAV's straight to its file.
  P.setRouter((ctx, synth, offline, destination) => {
    const graph = X.mixerGraph(ctx, synth, destination);
    graph.apply(mixHeard(), st.score ? M.channels(st.score) : []);
    if (!offline) st.liveMixer = graph;
    // Save the sound: the synthesizer's notes, all scheduled, into their strips (#391).
    else if (st.offlineNotes?.notes.length) Sy.scheduleAll(ctx, st.offlineNotes.notes, st.offlineNotes.settingsOf, (channel) => graph.strips[channel % 16].input);
  });

  /**
   * What Save the sound renders: the heard MIDI (practised, when Playback
   * asks), its own SoundFonts' presets in, its synthesizer's notes out —
   * those ready for the router to schedule.
   */
  async function soundMidi() {
    const bytes = await heardMidi(st.score, undefined, { practice: exportPractice() });
    const sound = await st.instruments.prepare(st.score);
    const made = st.instruments.forSound(bytes, sound);
    st.offlineNotes = { notes: made.notes, settingsOf: st.instruments.settingsFor(sound) };
    return made.bytes;
  }

  /** Each staff's channel as the mixer says: muted, or not soloed while another is; its level, pan and effects. */
  function applyMix() {
    if (!st.score) return;
    const mix = mixHeard();
    for (const { lane, channel } of M.channels(st.score)) P.mute(channel, !X.audible(mix, lane));
    st.liveMixer?.apply(mix, M.channels(st.score));
    st.audio?.applyMix(mix);
  }

  /** A track's (or the master's) settings changed: kept in the score, heard at once. */
  function mixCommit(lane, patch) {
    st.heardMix = null;
    edit((score) => X.setMix(score, lane, patch));
    mixFromMeta();
    applyMix();
    renderMix();
  }

  st.instruments = installInstruments({ root, st, M, P, edit, say });
  st.mixer = mixerPanel({
    root,
    instrument: st.instruments,
    tracks: () => (st.score ? [...M.channels(st.score).map(({ lane, name }) => ({ lane, name, colour: R.laneColour(st.score, lane) })), ...(st.audio?.mixerTracks() ?? [])] : []),
    mix: () => X.mixOf(st.score),
    preview: (mix) => {
      st.heardMix = mix;
      applyMix();
    },
    commit: mixCommit,
    level: () => (st.playing?.handle && st.liveMixer ? st.liveMixer.level().peak : 0),
  });

  // The microphone (audio-ui.js, #390): what of the editor it works with.
  st.audio = audioTracks({
    root,
    st,
    options: options.audio ?? {},
    studio: {
      say,
      edit,
      draw,
      play: () => togglePlay(),
      stop: () => stopPlay(),
      showPlace: (lane, tick) => {
        keepOn(lane, tick);
        draw();
      },
      changeBar,
      laneName,
      barNo,
      grid: () => M.RECORDING_GRIDS[quantizeBox?.value] ?? M.RECORDING_GRIDS.sixteenth,
      gridName: () => quantizeBox?.selectedOptions[0]?.textContent ?? "sixteenths",
      mixHeard,
    },
  });

  /** The Playback section's staves, a Mute and a Solo for each. */
  function renderMix() {
    st.mixer?.refresh();
    st.instruments?.check();
    const box = playOption("staves");
    if (!box) return;
    const rows = st.score ? M.channels(st.score) : [];
    const key = JSON.stringify([rows.map((r) => r.name), [...st.mix.mute], [...st.mix.solo]]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = "";
    if (rows.length < 2) return;
    for (const { lane, name } of rows) {
      const row = Object.assign(document.createElement("div"), { className: "tool-staff" });
      row.append(Object.assign(document.createElement("span"), { textContent: name, title: name }));
      for (const [act, letter, words] of [["mute", "M", "Mute"], ["solo", "S", "Solo"]]) {
        const on = st.mix[act].has(lane);
        const button = Object.assign(document.createElement("button"), { type: "button", className: `tool${on ? " on" : ""}`, textContent: letter, title: `${words} ${name}` });
        button.dataset.act = act;
        button.dataset.lane = String(lane);
        button.setAttribute("aria-pressed", String(on));
        button.setAttribute("aria-label", `${words} ${name}`);
        row.append(button);
      }
      box.append(row);
    }
  }

  return { mixFromMeta, mixHeard, soundMidi, applyMix, mixCommit, renderMix };
}
