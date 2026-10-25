// The studio's playing (studio.js, player.js): the MIDI heard, Play and
// Stop, the metronome and the count-in, practice, the loop, the progress.

/** The Playback section set up; answers Play, Stop, the loop, and the MIDI heard. */
export function install(ctx) {
  const { root, state, playhead, st, toMidi, M, P, X, Vel, Pr, Sy, F, A, Ch, G } = ctx;
  const {
    barNo, changeBar, selectedBarsOrNull, selectedBars, draw, showState, say, followPlaying, mixHeard, applyMix,
    finishRecording, chooseOutput
  } = ctx.call;

  // ---- Playing --------------------------------------------------------------------
  //
  // player.js plays the MIDI with MuseScore_General. The MIDI is written from
  // the score with every repeat played out, and `passes` says when each bar
  // sounds on each pass: the notes light up on the second time through too.

  /**
   * toMidi's arguments for what is heard: the score with its repeats played
   * out and its jumps taken; a piece edited in its text, as toMidi plays it
   * (out, when the model reads it; as written otherwise). Play, Save as
   * MIDI and Save the sound all play this, at 100 a quarter when the source
   * sets no tempo.
   */
  const heard = (score) =>
    score
      ? [M.toLilyPond(score, { unfold: true }).source, { bpm: M.DEFAULT_BPM, beat: 4, unfold: false }]
      : [st.text, { bpm: M.DEFAULT_BPM, beat: 4 }];

  /**
   * The MIDI of what is heard: each note at the velocity set for it
   * (velocity.js), the curves drawn played (automation.js), then as it is
   * played (feel.js) — swung and humanized as the meta line asks, on top of
   * those velocities, its rit. and accel. gliding. Play, Save as MIDI and
   * Save the sound all play this; `mix` (Save as MIDI) writes the mixer's
   * volume and pan in too; `practice` transposes it, and sets its speed (a
   * saved file's, when asked: practice.js).
   */
  const heardMidi = (score, passes = score ? M.playback(score) : [], { mix = null, practice = null } = {}) =>
    engraved(score).then((bytes) => {
      const velocities = score ? Vel.applyVelocities(score, bytes) : bytes;
      // Past fifteen channels, two staves may go through one mixer strip: their volume and pan in the file (#389).
      const shared = score && !mix ? X.fileMixLanes(mixHeard(), M.channels(score)) : [];
      const fileMix = mix ?? (shared.length ? mixHeard() : null);
      const curves = score ? A.applyAutomation(score, velocities, { passes, mix: fileMix, mixLanes: mix ? null : shared, volumeMin: X.VOLUME_MIN }) : velocities;
      const graced = score ? G.applyGraces(score, curves, { passes }) : curves;
      const felt = F.feel(graced, { score, passes, ...F.feelOf(score ? score.meta : M.readMeta(st.text)) });
      return practice ? Pr.applyPractice(felt, practice) : felt;
    });

  /** The engraver's MIDI of what is heard, each staff on its own channel (channels.js, #389). */
  function engraved(score) {
    return toMidi(...heard(score)).then((bytes) => Ch.assignChannels(score, bytes));
  }

  // The Playback section's settings, kept from one visit to the next.
  const PLAYBACK = "eui-score-studio-playback";
  const playOption = (name) => root.querySelector(`[data-play="${name}"]`);
  try {
    const kept = JSON.parse(localStorage.getItem(PLAYBACK) || "{}");
    if (kept.rate) playOption("rate").value = kept.rate;
    playOption("metronome").checked = Boolean(kept.metronome);
    playOption("count-in").checked = Boolean(kept.countIn);
    if (playOption("subdivide") && kept.subdivide) playOption("subdivide").value = kept.subdivide;
    if (playOption("accent")) playOption("accent").checked = kept.accent !== false;
  } catch (error) {}
  /** The metronome's first beat of each bar accented (Playback), as it always was unless turned off. */
  const accent = () => playOption("accent")?.checked ?? true;
  root.querySelector('[data-section="playback"]')?.addEventListener("change", (event) => {
    if (event.target.dataset.play === "output") return chooseOutput(event.target);
    if (event.target.dataset.play === "rate" && st.playing?.handle) st.playing.handle.rate = rate();
    try {
      localStorage.setItem(
        PLAYBACK,
        JSON.stringify({ rate: playOption("rate").value, metronome: playOption("metronome").checked, countIn: playOption("count-in").checked, subdivide: playOption("subdivide")?.value, accent: accent() }),
      );
    } catch (error) {}
  });
  const rate = () => Number(playOption("rate")?.value) || 1;

  // Practice (#391): Play transposed, saved files as practised, the loop
  // faster each pass — kept in this browser, like the rest of Playback.
  const PRACTICE = "eui-score-studio-practice";
  const practiceOption = (name) => root.querySelector(`[data-practice="${name}"]`);
  try {
    const kept = JSON.parse(localStorage.getItem(PRACTICE) || "{}");
    for (const [name, value] of Object.entries(kept)) {
      const el = practiceOption(name);
      if (el?.type === "checkbox") el.checked = Boolean(value);
      else if (el) el.value = value;
    }
  } catch (error) {}
  root.querySelector("[data-practice-box]")?.closest(".tool-section")?.addEventListener("change", (event) => {
    const name = event.target.dataset?.practice;
    if (!name) return;
    // The audio takes (#390) are sound, not notes: they keep their pitch.
    const takes = st.audio?.mixerTracks().length ? " The audio takes keep their own pitch." : "";
    if (name === "transpose") say(`Play transposed: ${Pr.transposeText(transposeNow())}${st.playing ? ", heard from the next Play" : ""}.${takes}`);
    try {
      const all = Object.fromEntries([...root.querySelectorAll("[data-practice]")].map((el) => [el.dataset.practice, el.type === "checkbox" ? el.checked : el.value]));
      localStorage.setItem(PRACTICE, JSON.stringify(all));
    } catch (error) {}
  });
  const transposeNow = () => Pr.transposition(practiceOption("transpose")?.value);
  const rampNow = () => Pr.rampOf({ from: practiceOption("from")?.value, step: practiceOption("step")?.value, to: practiceOption("to")?.value, atTarget: practiceOption("at")?.value });
  /** The practice a saved file gets: the speed and the transposition, when Playback asks for it. */
  const exportPractice = () => (practiceOption("exports")?.checked ? { transpose: transposeNow(), tempo: rate() } : null);
  const showRamp = (text) => {
    const out = root.querySelector("[data-practice-now]");
    if (out) out.textContent = text;
  };

  /** A pass of the rising loop is over: the next a step faster, or the end at the target. */
  function rampPass(state, handle) {
    const next = Pr.rampAfter(state.ramp, state.pass);
    if (next.done) {
      stopPlay();
      const text = `Practice loop: ${next.percent} % reached after ${state.pass + 1} passes.`;
      showRamp(text);
      return say(text);
    }
    state.pass = next.pass;
    // The audio takes follow on the next tick (audio-ui.js `sync`: a new rate starts them again
    // there). TIME-STRETCH: they follow by playbackRate, their pitch with it (takes.js `scheduleOf`).
    handle.rate = next.percent / 100;
    showRamp(Pr.rampText(state.ramp, state.pass));
  }

  /** Play; pause; play on. A second press while the sounds load gives up. */
  async function togglePlay() {
    const playing = st.playing;
    if (playing?.handle) {
      // A take being recorded is not paused: it ends.
      if (st.taking) return stopPlay();
      if (playing.handle.paused) {
        playing.handle.resume();
        playing.next = null;
        say("Playing — Space to pause");
      } else {
        playing.handle.pause();
        playing.voices?.silence();
        say("Paused — Space to play on, Stop to go back to the start");
      }
      return showState();
    }
    if (playing) return stopPlay();
    // Inside the click, before anything waits: a browser starts sound only
    // from a gesture, and a gesture does not outlive a download.
    P.unlock();
    // Looped: the loop's bars over and over (set on the MIDI view's ruler,
    // or Play › Loop), else the selected bars when Playback asks for it —
    // recorded into or not. Recorded into or looped, the score plays on past
    // its last note (M.padded).
    // A take is recorded straight through, never looped.
    const looping = !st.taking && (Boolean(st.loopBars) || playOption("loop")?.checked);
    const played = st.score && (st.recording || looping) ? M.padded(st.score) : st.score;
    // The staff recorded into is silent: in this browser it is muted, and a
    // MIDI device (Sound to) is not sent its old notes at all.
    if (st.recording) M.write(played, st.recording.lane, 0, M.barStart(played, M.barsOf(played)), { rest: true });
    const passes = played ? M.playback(played) : [];
    // From the selection's bar (its first pass), or from the start.
    const loopBars = st.taking ? null : (st.loopBars ?? (looping ? selectedBarsOrNull() : null));
    const loop = loopBars && st.score ? loopOf(passes, loopBars) : null;
    if (looping && !loop) say("Select the bars to loop: playing from the start.");
    if (st.recording) st.recording.loop = loop ? loopBars : null;
    const from = changeBar();
    const at = loop ? loop.start : from == null ? 0 : (passes.find((p) => p.bar === from)?.start ?? 0);
    let bytes;
    let sound = null;
    let notes = [];
    try {
      bytes = await heardMidi(played, passes, { practice: { transpose: transposeNow() } });
      // The synthesizer's staves and the own SoundFonts' (#391): in this browser only, not to a MIDI device.
      if (!P.outputPort()) {
        sound = await st.instruments.prepare(played);
        ({ bytes, notes } = st.instruments.forSound(bytes, sound));
      }
    } catch (error) {
      return say(error.message ?? String(error), true);
    }
    const state = { handle: null, passes, times: noteTimes(passes), beats: played ? M.beats(played, passes, { subdivide: Number(playOption("subdivide")?.value) || 0 }) : [], loop, next: null, now: [], lit: -1, frame: 0, timer: 0, ticker: 0 };
    // The loop faster each pass, from its first speed (#391).
    if (practiceOption("ramp")?.checked) {
      if (loop) Object.assign(state, { ramp: rampNow(), pass: 0 });
      else state.unramped = true;
    }
    st.playing = state;
    showState();
    const progress = (f) => st.playing === state && say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`);
    try {
      if (!P.isReady()) say("Loading the sounds…");
      await P.prepare(progress);
      if (st.playing !== state) return;
      // A recording always counts a bar in.
      if ((st.recording || st.taking || playOption("count-in")?.checked) && passes.length) await countIn(state, at);
      if (st.playing !== state) return;
      state.handle = await P.play(bytes, { at, onStop: () => st.playing === state && stopPlay() });
    } catch (error) {
      if (st.playing === state) stopPlay();
      return say("The sounds could not be loaded.", true);
    }
    if (!state.handle || st.playing !== state) return;
    state.handle.rate = state.ramp ? Pr.rampPercent(state.ramp, 0) / 100 : rate();
    if (state.ramp) showRamp(Pr.rampText(state.ramp, 0));
    if (notes.length) {
      state.voices = new Sy.Scheduler({
        ctx: P.unlock(),
        notes,
        settingsOf: st.instruments.settingsFor(sound),
        destinationOf: (channel) => st.liveMixer?.strips[channel % 16].input ?? P.unlock().destination,
      });
    }
    applyMix();
    // The audio tracks, in time with it.
    st.audio?.startPlayback(state.handle);
    // The padding staff's note, silent.
    if (played !== st.score) {
      state.padChannel = M.channels(played).at(-1).channel;
      P.mute(state.padChannel, true);
    }
    if (state.unramped) say("Faster each pass plays a loop: set one first (Play ▸ Loop, or the MIDI view's ruler). Playing from the start — Space to pause");
    else if (!st.recording && !st.taking) say(loop ? "Looping the selected bars — Space to pause" : "Playing — Space to pause");
    showState();
    state.timer = setInterval(showProgress, 200);
    state.ticker = setInterval(tick, 25);
    const follow = () => {
      if (st.playing !== state) return;
      light(state.handle.heard);
      state.frame = requestAnimationFrame(follow);
    };
    follow();
  }

  /** The selected bars as a loop: from their first pass to the end of that pass through the last; null with none selected. */
  function loopOf(passes, bars = null) {
    if (!bars) {
      try {
        bars = selectedBars();
      } catch (error) {
        return null;
      }
    }
    const first = passes.findIndex((p) => p.bar === bars[0]);
    if (first < 0) return null;
    const last = passes.findIndex((p, k) => k >= first && p.bar === bars[1]);
    return last < 0 ? null : { start: passes[first].start, end: passes[last].end };
  }

  /** One bar of clicks, at the speed of the bar the music starts in; resolves when it is over. */
  function countIn(state, at) {
    const pass = M.passAt(state.passes, at);
    const [num, den] = M.timeAt(st.score, pass.bar);
    const beat = ((M.WHOLE / den) / (M.WHOLE / pass.base)) * (60 / pass.bpm) / (state.ramp ? Pr.rampPercent(state.ramp, 0) / 100 : rate());
    const t0 = P.audioTime() + 0.05;
    for (let k = 0; k < num; k++) P.click(t0 + k * beat, k === 0 && accent());
    say("One bar to come in…");
    return new Promise((resolve) => setTimeout(resolve, (num * beat + 0.05) * 1000));
  }

  /** Every 25 ms: the loop's jump back, and the metronome's clicks due in the next 120 ms, each once. */
  function tick() {
    const state = st.playing;
    const handle = state?.handle;
    // The audio tracks follow a seek, the loop's jump, a pause, a new speed.
    if (handle) st.audio?.sync(handle);
    if (!handle || handle.paused) return;
    const now = handle.time;
    if (state.loop && now >= state.loop.end - 0.02) {
      handle.time = state.loop.start;
      state.next = null;
      if (state.ramp) rampPass(state, handle);
      return;
    }
    state.voices?.tick(now, handle.rate);
    // A recording always has the metronome.
    if (!(st.recording || playOption("metronome")?.checked) || !state.beats.length) return;
    const beats = state.beats;
    // After a jump — a seek, the loop — the count starts again where the music is.
    const lost = state.next == null || (state.next > 0 && beats[state.next - 1].sec > now + 0.3) || (beats[state.next] && beats[state.next].sec < now - 0.3);
    if (lost) state.next = Math.max(0, beats.findIndex((b) => b.sec >= now - 0.01));
    while (state.next < beats.length && beats[state.next].sec < now + 0.12) {
      const b = beats[state.next++];
      if (b.sec >= now - 0.01) P.click(P.audioTime() + (b.sec - now) / handle.rate, b.down && accent(), b.sub);
    }
  }

  /** Lights the notes that started last, at `sec`; draws only when they change. */
  function light(sec) {
    const playing = st.playing;
    const times = playing.times;
    let k = -1;
    while (k + 1 < times.length && times[k + 1].sec <= sec + 0.01) k++;
    if (k === playing.lit) return;
    playing.lit = k;
    playing.now = k < 0 ? [] : times[k].items;
    draw().then(followPlaying);
  }

  function stopPlay() {
    const playing = st.playing;
    // Where the music got to, for the keys still held when a recording stops.
    const reached = st.recording && playing?.handle ? M.tickAtPlayed(st.score, playing.passes, playing.handle.heard) : null;
    st.playing = null;
    if (playing) {
      clearInterval(playing.timer);
      clearInterval(playing.ticker);
      cancelAnimationFrame(playing.frame);
      playing.voices?.silence();
      if (playing.handle) playing.handle.stop();
      else P.stop(); // still loading: it must not start after all
      if (playing.padChannel != null) P.mute(playing.padChannel, false);
    }
    st.audio?.stopPlayback();
    progress.hidden = true;
    playhead.hidden = true;
    say("");
    if (st.recording) return finishRecording(reached);
    if (st.taking) {
      draw();
      return st.audio.finishTake();
    }
    draw();
  }

  // The bar under the menu: how far the music has played, the bar it is in;
  // a click on it plays from there.
  const progress = document.createElement("div");
  progress.className = "studio-progress";
  progress.hidden = true;
  progress.innerHTML = '<div class="studio-progress-fill"></div><span class="studio-progress-text"></span>';
  root.querySelector(".studio-menubar").after(progress);
  // On a narrow screen the menu bar wraps: the progress bar sticks under it, however tall.
  const menubar = root.querySelector(".studio-menubar");
  const menubarSize = new ResizeObserver(() => root.style.setProperty("--studio-menubar-h", `${menubar.offsetHeight}px`));
  menubarSize.observe(menubar);
  ctx.observers.push(menubarSize);
  progress.addEventListener("click", (event) => {
    const handle = st.playing?.handle;
    if (!handle?.duration) return;
    const rect = progress.getBoundingClientRect();
    handle.time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * handle.duration;
  });

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  function showProgress() {
    const handle = st.playing?.handle;
    if (!handle) return;
    const total = handle.duration || 0;
    const now = Math.min(Math.max(0, handle.time || 0), total);
    progress.hidden = false;
    progress.querySelector(".studio-progress-fill").style.width = total ? `${(100 * now) / total}%` : "0";
    const pass = M.passAt(st.playing.passes, now);
    const bars = pass && st.score ? ` · bar ${barNo(pass.bar)} of ${barNo(M.barsOf(st.score) - 1)}` : "";
    progress.querySelector(".studio-progress-text").textContent = `${clock(now)} / ${clock(total)}${bars}`;
    state.textContent = `Playing${bars} · ${clock(now)} / ${clock(total)} — Space to stop`;
  }

  // ---- The loop ---------------------------------------------------------------------
  //
  // The bars played over and over, kept apart from the selection: set on the
  // MIDI view's ruler (a drag, or a click on a bar), or with Play › Loop the
  // selected bars; a click on it, or Play › No loop, takes it away.

  function setLoop(bars) {
    if (bars === undefined || (bars === null && !st.loopBars)) return say(bars === null ? "No loop" : "Select the bars to loop first", bars !== null);
    st.loopBars = bars ? [Math.min(...bars), Math.max(...bars)] : null;
    if (st.playing) stopPlay();
    const [a, b] = st.loopBars ?? [];
    say(st.loopBars ? `Loop: ${a === b ? `bar ${barNo(a)}` : `bars ${barNo(a)}–${barNo(b)}`}, played over and over (and recorded into). A click on it in the MIDI view's ruler, or Play › No loop, takes it away.` : "No loop: the music plays on.");
    draw();
  }

  /** When notes start, in seconds, on every pass: [{ sec, items }], in order. */
  function noteTimes(passes) {
    if (!st.score) return [];
    const at = new Map();
    const starts = st.score.staves.map((staff) => M.starts(staff));
    st.items.forEach(({ staff, index }, item) => {
      if (st.score.staves[staff].events[index].rest) return;
      for (const sec of G.heardAt(st.score, passes, staff, index, starts[staff][index])) {
        const key = Math.round(sec * 1000);
        if (!at.has(key)) at.set(key, { sec, items: [] });
        at.get(key).items.push(item);
      }
    });
    return [...at.values()].sort((a, b) => a.sec - b.sec);
  }

  return { heardMidi, engraved, playOption, exportPractice, togglePlay, stopPlay, showProgress, setLoop };
}
