// The studio's MIDI devices (studio.js): a MIDI keyboard writing notes, or
// recorded into the score; the sound sent to a MIDI device.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** The MIDI keyboard and the Sound to menu wired; answers recording. */
export function install(ctx) {
  const { root, st, quantizeBox, M, P, S, Vel, A } = ctx;
  const {
    barNo, edit, changeBar, hear, need, setInput, inputWrite, draw, say, togglePlay, stopPlay, renderMix
  } = ctx.call;

  // ---- A MIDI keyboard ------------------------------------------------------------
  //
  // A key played writes its note at the cursor, in the duration chosen —
  // note input starts if it was off; keys held together make a chord. With
  // notes selected and note input off, the key gives the selected note its
  // pitch, as a letter does.

  const midiIn = root.querySelector("[data-midi-in]");
  midiIn?.addEventListener("change", () => chooseInput(midiIn));

  function playKey(key, held) {
    if (!st.score || !root.isConnected) return;
    if (!st.input.on && !st.sel) setInput(true);
    // A key pressed while others are down joins their chord.
    const add = held.length > 0 && st.input.on && st.input.last;
    if (st.input.on) inputWrite({ key }, add);
    else edit((score) => {
      const t = need();
      M.setPitch(score, t.s, t.i, M.pitchOfKey(key, M.keyOf(score, t.s, M.starts(score.staves[t.s])[t.i])), false, t.head);
    });
    hear();
  }

  // The keyboard is the tab's (player.js), not the page's: once this editor
  // is gone (instant navigation), its keys write no more into this score.
  ctx.ends.push(() => P.unlisten(playKey, recordKey));

  // ---- Recording from a MIDI keyboard --------------------------------------------
  //
  // R (or Record) plays the score from the selected bar after a bar of
  // count-in, the metronome on and the staff recorded into silent; the keys
  // played are kept with the times they were heard at, and written when the
  // music stops, fitted to the Quantize grid. One Undo takes it all back.

  const dynamicsBox = root.querySelector("[data-record-dynamics]");
  const recordButtons = () => root.querySelectorAll("[data-record]");

  function keyboardChosen() {
    return midiIn && midiIn.value && midiIn.value !== "find" ? midiIn.value : null;
  }

  async function record() {
    if (st.recording) return stopPlay();
    if (!st.score) return say(tr("Recording needs the score tools: this piece is edited in its text."), true);
    const port = keyboardChosen();
    if (!port) return say(tr("Choose a MIDI keyboard first (Playback › MIDI keyboard), then record."), true);
    const lane = st.input.on ? st.input.staff : (st.sel?.staff ?? 0);
    if (st.playing) stopPlay();
    if (st.input.on) setInput(false);
    const sound = st.score.staves[M.upperOf(st.score, lane)]?.instrument;
    const mutedByRecording = !st.mix.mute.has(lane);
    st.mix.mute.add(lane);
    st.recording = { lane, bar: changeBar() ?? 0, program: M.programOf(sound), drums: M.isDrums(st.score, lane), channel: laneChannel(lane), down: new Map(), played: [], mutedByRecording };
    P.listen(port, recordKey, releaseKey);
    for (const button of recordButtons()) {
      button.textContent = tr("■ Stop rec");
      button.setAttribute("aria-pressed", "true");
    }
    await togglePlay();
    if (st.recording && st.playing) {
      const loop = st.recording.loop;
      say(loop
        ? tr("Recording into {staff}, bars {a}–{b} in a loop: each pass adds its notes; R stops.", { staff: laneName(lane), a: barNo(loop[0]), b: barNo(loop[1]) })
        : tr("Recording into {staff} from bar {n}: play after the count-in; R stops.", { staff: laneName(lane), n: barNo(st.recording.bar) }));
    }
  }

  /** Lane `s`'s MIDI channel, as the music is sent: its staff's. */
  function laneChannel(s) {
    return M.channels(st.score).find((c) => c.lane === M.upperOf(st.score, s))?.channel ?? 0;
  }

  function laneName(s) {
    const staff = st.score.staves[M.upperOf(st.score, s)];
    return staff?.name || tr("staff {n}", { n: M.staffNumber(st.score, s) + 1 });
  }

  /**
   * The tick being heard now, while recording — or when the key's message
   * was `stamp` (ms, performance.now()), less the time it waited to be read;
   * null before the music has started or while it is paused.
   */
  function recordingNow(stamp = null) {
    const handle = st.playing?.handle;
    if (!st.recording || !handle || handle.paused) return null;
    const sec = stamp == null ? handle.heard : S.struckAt(handle.heard, handle.rate, performance.now() - stamp);
    return M.tickAtPlayed(st.score, st.playing.passes, sec);
  }

  function recordKey(key, held, velocity = 100, stamp = null) {
    if (!st.recording) return;
    P.hold(key, true, st.recording.program, { drums: st.recording.drums, velocity, channel: st.recording.channel });
    const t = recordingNow(stamp);
    if (t != null) st.recording.down.set(key, { t, velocity });
  }

  function releaseKey(key) {
    if (!st.recording) return;
    P.hold(key, false, 0, { drums: st.recording.drums, channel: st.recording.channel });
    const down = st.recording.down.get(key);
    if (!down) return;
    st.recording.down.delete(key);
    const { t: t0, velocity } = down;
    const t1 = recordingNow() ?? t0;
    // The music went back meanwhile — a repeat, the loop: the note lasts to its bar's end, or the loop's.
    const back = st.recording.loop ? M.barStart(st.score, st.recording.loop[1] + 1) : M.barStart(st.score, M.barAt(st.score, t0) + 1);
    st.recording.played.push({ key, t0, t1: t1 > t0 ? t1 : back, velocity });
  }

  /** The music stopped: the keys played written into the staff, from the bar recording began to the end of the last note's. */
  function finishRecording(reached) {
    const rec = st.recording;
    st.recording = null;
    P.listen(keyboardChosen(), playKey);
    if (rec.mutedByRecording) st.mix.mute.delete(rec.lane);
    renderMix();
    for (const button of recordButtons()) {
      button.textContent = tr("● Rec");
      button.setAttribute("aria-pressed", "false");
    }
    for (const [key, { t: t0, velocity }] of rec.down) {
      P.hold(key, false, 0, { drums: rec.drums, channel: rec.channel });
      rec.played.push({ key, t0, t1: Math.max(reached ?? t0, t0 + 1), velocity });
    }
    if (!rec.played.length) {
      say(tr("Nothing was played: the score is as it was."));
      return draw();
    }
    const grid = M.RECORDING_GRIDS[quantizeBox?.value] ?? M.RECORDING_GRIDS.sixteenth;
    // Looped, every pass is kept (each played over the others) and the loop's bars written whole.
    const first = rec.loop ? rec.loop[0] : rec.bar;
    const from = M.barStart(st.score, first);
    const lastBar = rec.loop ? rec.loop[1] : M.barAt(st.score, Math.max(from, Math.max(...rec.played.map((n) => n.t1)) - 1));
    let written = 0;
    edit((score) => {
      written = M.writeRecording(score, rec.lane, from, M.barStart(score, lastBar + 1), rec.played, grid, { dynamics: Boolean(dynamicsBox?.checked) });
      // How hard each key was struck: the velocity of the note it wrote.
      Vel.setVelocities(score, Vel.fromRecording(score, rec.lane, rec.played, grid));
      // The knobs, the pedal and the bend played meanwhile (automation-ui.js), as curves.
      A.writeRecorded(score, M.upperOf(score, rec.lane), rec.cc, from, M.barStart(score, lastBar + 1));
    });
    const said = {
      staff: laneName(rec.lane),
      bars: lastBar === first ? tr("bar {n}", { n: barNo(first) }) : tr("bars {a}–{b}", { a: barNo(first), b: barNo(lastBar) }),
      grid: quantizeBox?.selectedOptions[0]?.textContent ?? tr("sixteenths"),
      n: written,
    };
    say(written === 1
      ? tr("Recorded 1 note into {staff}, {bars}, fitted to {grid}. Ctrl+Z takes it back.", said)
      : tr("Recorded {n} notes into {staff}, {bars}, fitted to {grid}. Ctrl+Z takes it back.", said));
  }

  /** The "MIDI keyboard" menu: none, or a keyboard, found when asked for. */
  async function chooseInput(select) {
    if (select.value === "") {
      P.listen(null);
      return say(tr("No MIDI keyboard: the letters write the notes."));
    }
    if (select.value !== "find") {
      P.listen(select.value, playKey);
      return say(tr("Play on {device}: each key writes its note at the cursor.", { device: select.selectedOptions[0].textContent }));
    }
    let ports = [];
    try {
      ports = await P.midiInputs();
    } catch (error) {
      select.value = "";
      return say(error.message ?? tr("The browser gave no access to MIDI keyboards."), true);
    }
    select.innerHTML = "";
    select.append(new Option(tr("none"), ""));
    for (const port of ports) select.append(new Option(port.name, port.id));
    select.append(new Option(tr("look again…"), "find"));
    if (!ports.length) {
      select.value = "";
      return say(tr("No MIDI keyboard found: plug one in (USB or Bluetooth), then look again."), true);
    }
    select.value = ports[0].id;
    P.listen(ports[0].id, playKey);
    say(tr("Play on {device}: each key writes its note at the cursor, in the duration chosen; keys held together make a chord.", { device: ports[0].name }));
  }

  /** The "Sound to" menu: this browser, or a MIDI device, found when asked for. */
  async function chooseOutput(select) {
    if (select.value === "") {
      P.setOutput(null);
      return say(tr("The sound plays in this browser."));
    }
    if (select.value !== "find") {
      P.setOutput(select.value);
      return say(tr("From the next Play on, the music goes to {device}.", { device: select.selectedOptions[0].textContent }));
    }
    let ports = [];
    try {
      ports = await P.midiOutputs();
    } catch (error) {
      select.value = "";
      return say(error.message ?? tr("The browser gave no access to MIDI devices."), true);
    }
    select.innerHTML = "";
    select.append(new Option(tr("this browser"), ""));
    for (const port of ports) select.append(new Option(port.name, port.id));
    select.append(new Option(tr("look again…"), "find"));
    if (!ports.length) {
      select.value = "";
      return say(tr("No MIDI device found. On a Mac, open Audio MIDI Setup → MIDI Studio, and set the IAC Driver online; then look again."), true);
    }
    select.value = ports[0].id;
    P.setOutput(ports[0].id);
    say(tr("From the next Play on, the music goes to {device}. Open GarageBand (or Logic) on an instrument track to hear it.", { device: ports[0].name }));
  }

  return { record, laneChannel, laneName, recordingNow, finishRecording, chooseOutput };
}
