// The microphone in the score editor (#390): audio tracks recorded along
// with the score, the notes of a take written into a staff, a tuner, and a
// practice mode where the place in the score follows what is played.
//
//   const audio = audioTracks({ root, st, studio, options });
//   audio.html();                 // the takes' waveforms, under the MIDI view's staves
//   audio.startPlayback(handle);  // Play started: the takes play with it
//   audio.sync(handle);           // every tick: a seek, a pause, a new speed followed
//   audio.stopPlayback();
//   audio.finishTake();           // the music stopped while a take was recorded
//   audio.mixerTracks();          // the takes' strips in the mixer
//   audio.applyMix(mix);
//   audio.open(); audio.tuner(); audio.practice();
//
// `studio` is what the editor lends: `say(text, error)`, `edit(fn)`,
// `draw()`, `play()` (Play, as its button), `stop()`, `showPlace(lane,
// tick)`, `changeBar()`, `laneName(lane)`, `barNo(bar)`, `grid()` and
// `gridName()` (the Quantize grid), `mixHeard()`.
//
// `options.url` is the score's takes in the app (AppTakesController):
// without it (the playground) there are no audio tracks, the tuner and
// practice work all the same. A take is kept on the server as a WAV
// (takes.js); its place in the score's time is measured as it is recorded
// (takes.js `musicAt`, `offsetOf`).
//
// The microphone is asked for on a press of a button, never before
// (mic.js), and let go as soon as it is not needed.

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const P = await import(`./player.js${V}`);
const R = await import(`./piano-roll.js${V}`);
const X = await import(`./mixer.js${V}`);
const Vel = await import(`./velocity.js${V}`);
const Pi = await import(`./pitch.js${V}`);
const T = await import(`./takes.js${V}`);
const Fo = await import(`./follow.js${V}`);
const Mic = await import(`./mic.js${V}`);
const { tr } = await import(`./words.js${V}`);

const escape = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** The waveform strip's height under the roll, in pixels. */
export const WAVE_H = 56;
const COLOUR = "#9a6a2f";
const A4_KEY = "eui-score-tuner-a4";

/** Seconds as "0:07". */
const clock = T.lengthText;

/**
 * The waveform of a take as SVG for the roll's layout `geo`: a line per
 * pixel column, as loud as the loudest sample there. `tickAt(sec)` places
 * the score's second `sec` (null past the end).
 */
export function waveSvg(geo, peaks, { offset, takeRate = 1, step = 0.01, tickAt, label = "", recording = false }) {
  const mid = WAVE_H / 2;
  const columns = new Map();
  for (let k = 0; k < peaks.length; k++) {
    const tick = tickAt(offset + k * step * takeRate);
    if (tick == null) continue;
    const x = Math.round(geo.x(tick));
    columns.set(x, Math.max(columns.get(x) ?? 0, peaks[k]));
  }
  const path = [...columns].map(([x, p]) => {
    const h = Math.max(0.5, Math.min(1, p) * (mid - 4));
    return `M${x} ${(mid - h).toFixed(1)}V${(mid + h).toFixed(1)}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wave-strip${recording ? " wave-recording" : ""}" width="${geo.width}" height="${WAVE_H}" viewBox="0 0 ${geo.width} ${WAVE_H}" role="img" aria-label="${escape(tr("{name}: waveform", { name: label }))}">`
    + `<rect class="wave-bg" x="${geo.left}" y="0" width="${Math.max(0, geo.width - geo.left)}" height="${WAVE_H}"/>`
    + `<text class="wave-label" x="8" y="18">${escape(label)}</text>`
    + `<path class="wave-line" stroke="${COLOUR}" d="${path.join("")}"/></svg>`;
}

export function audioTracks({ root, st, studio, options = {} }) {
  const url = options.url ?? null;
  const say = (text, error = false, link = null) => studio.say(text, error, link);
  st.taking = null;
  // The editor is gone (`end`): nothing more is listened to.
  let ended = false;
  // Track → { take, samples, rate, peaks, unsaved?, wav? }.
  const takes = new Map();
  let trackCount = T.TRACKS;
  let maxBytes = T.MAX_BYTES;
  let writable = Boolean(url);
  // The tracks this score's plan records on (#393), and the Pricing page.
  let tracksAllowed = T.TRACKS;
  let pricing = null;
  const plans = (href) => (href ? { href, text: tr("See the plans") } : null);
  let sources = [];
  let anchor = null;
  const strips = new Map();
  let waveCache = new Map();

  // ---- The panel -------------------------------------------------------------------

  const panel = Object.assign(document.createElement("dialog"), { className: "studio-audio" });
  panel.setAttribute("aria-label", tr("Audio tracks"));
  panel.innerHTML = `<div class="mixer-head"><h3>${tr("Audio tracks")}</h3><span class="mixer-note">${tr("A voice or an instrument, from the microphone, played with the score.")}</span><button type="button" class="tool" data-audio-close aria-label="${tr("Close")}">✕</button></div>
    <p class="audio-note" data-audio-note></p>
    <div class="audio-tracks" data-audio-tracks></div>
    <section class="audio-transcribe" data-audio-transcribe-box>
      <h4>${tr("Notes from a take")}</h4>
      <div class="audio-row">
        <label>${tr("Take")} <select data-audio-from aria-label="${tr("The take to write down")}"></select></label>
        <label>${tr("into")} <select data-audio-into aria-label="${tr("The staff the notes are written into")}"></select></label>
        <button type="button" class="tool" data-audio-transcribe>${tr("Write the notes")}</button>
      </div>
      <label class="audio-check"><input type="checkbox" data-audio-live> ${tr("Write the notes into that staff as I record")}</label>
      <p class="audio-hint">${tr("One voice or instrument at a time. The notes go over the bars of the take, fitted to the Quantize grid; Ctrl+Z takes them back.")}</p>
    </section>
    <div class="audio-row audio-more"><button type="button" class="tool" data-act="tuner">${tr("Tuner…")}</button><button type="button" class="tool" data-act="practice">${tr("Practice with the microphone…")}</button></div>`;
  root.append(panel);
  const list = panel.querySelector("[data-audio-tracks]");
  const fromBox = panel.querySelector("[data-audio-from]");
  const intoBox = panel.querySelector("[data-audio-into]");
  const liveBox = panel.querySelector("[data-audio-live]");

  function staffOptions(box) {
    const rows = st.score ? M.channels(st.score) : [];
    const key = JSON.stringify(rows.map((r) => [r.lane, r.name]));
    if (box.dataset.key === key) return;
    const was = box.value;
    box.dataset.key = key;
    box.innerHTML = rows.map((r) => `<option value="${r.lane}">${escape(r.name)}</option>`).join("");
    if ([...box.options].some((o) => o.value === was)) box.value = was;
    else if (st.sel?.staff != null) box.value = String(M.upperOf(st.score, st.sel.staff));
  }

  function nameOf(track) {
    return takes.get(track)?.take?.name ?? `Audio ${track}`;
  }

  function render() {
    const note = panel.querySelector("[data-audio-note]");
    note.textContent = url
      ? tr("Each track keeps one take: recording again replaces it. A take may last {length} at most. Headphones keep the score out of it.", { length: clock(T.maxSeconds(maxBytes)) })
      : tr("Audio tracks are kept with the score in the app: sign up to record them. The tuner and practice work here too.");
    panel.querySelector("[data-audio-transcribe-box]").hidden = !url;
    if (!url) {
      list.innerHTML = "";
      return;
    }
    const rows = [];
    for (let track = 1; track <= trackCount; track++) {
      const t = takes.get(track);
      const taking = st.taking?.track === track;
      const status = taking ? tr("● Recording…") : t?.unsaved ? tr("Not saved: {why}", { why: t.unsaved }) : t ? `${clock(t.samples.length / t.rate)} · ${T.sizeText(t.take.size ?? 0)}` : track > tracksAllowed ? tr("Not available") : tr("Empty");
      rows.push(`<div class="audio-track" data-track="${track}">
        <input class="audio-name" data-audio-name="${track}" value="${escape(nameOf(track))}" maxlength="60" aria-label="${escape(tr("The name of audio track {n}", { n: track }))}"${writable ? "" : " disabled"}>
        <span class="audio-status${t?.unsaved ? " audio-unsaved" : ""}">${escape(status)}</span>
        ${writable ? `<button type="button" class="tool studio-record${taking ? " on" : ""}" data-audio-record="${track}" aria-pressed="${taking}">${taking ? tr("■ Stop") : tr("● Record")}</button>` : ""}
        ${writable && t?.unsaved ? `<button type="button" class="tool" data-audio-save="${track}">${tr("Save again")}</button>` : ""}
        ${writable && t && !taking ? `<button type="button" class="tool" data-audio-delete="${track}">${tr("Delete")}</button>` : ""}
      </div>`);
    }
    list.innerHTML = rows.join("");
    const recorded = [...takes.keys()].filter((track) => takes.get(track)?.samples).sort((a, b) => a - b);
    const was = fromBox.value;
    fromBox.innerHTML = recorded.map((track) => `<option value="${track}">${escape(nameOf(track))}</option>`).join("");
    if (recorded.includes(Number(was))) fromBox.value = was;
    panel.querySelector("[data-audio-transcribe]").disabled = recorded.length === 0 || !st.score;
    staffOptions(intoBox);
  }

  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-audio-close]")) return panel.close();
    const record = event.target.closest("[data-audio-record]");
    if (record) return void recordTake(Number(record.dataset.audioRecord));
    const remove = event.target.closest("[data-audio-delete]");
    if (remove) return void deleteTake(Number(remove.dataset.audioDelete), remove);
    const again = event.target.closest("[data-audio-save]");
    if (again) return void saveTake(Number(again.dataset.audioSave));
    if (event.target.closest("[data-audio-transcribe]")) return void transcribeInto(Number(fromBox.value), Number(intoBox.value));
  });

  // ---- The takes, from the server ----------------------------------------------------

  async function request(path, init = {}) {
    const headers = { Accept: "application/json", ...(init.headers ?? {}) };
    if (options.csrf && init.method && init.method !== "GET") headers["X-CSRF-Token"] = options.csrf;
    const response = await fetch(`${url}${path}`, { credentials: "same-origin", ...init, headers });
    const json = (response.headers.get("Content-Type") || "").includes("application/json") ? await response.json() : null;
    if (!response.ok) throw Object.assign(new Error(json?.error ?? (response.status === 403 ? tr("You may not change this score's audio.") : response.status === 413 ? tr("That take is too big to send.") : tr("The server answered {status}.", { status: response.status }))), { upgrade: json?.upgrade });
    return json;
  }

  /** The score's takes and their sound, loaded once the editor is open. */
  async function load() {
    if (!url) return;
    let listed;
    try {
      listed = await request("");
    } catch (error) {
      return say(tr("The audio tracks could not be loaded: {why}", { why: error.message }), true);
    }
    trackCount = listed.tracks ?? T.TRACKS;
    maxBytes = listed.max_bytes ?? T.MAX_BYTES;
    tracksAllowed = listed.tracks_allowed ?? trackCount;
    pricing = listed.pricing ?? null;
    writable = Boolean(listed.writable);
    await Promise.all(listed.takes.map(async (take) => {
      try {
        const response = await fetch(`${url}/${take.id}/audio`, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const sound = T.decodeWav(new Uint8Array(await response.arrayBuffer()));
        if (!sound) throw new Error("not a WAV");
        keep(take.track, { take, samples: sound.samples, rate: sound.rate });
      } catch (error) {
        say(tr("{name}'s sound could not be loaded.", { name: take.name }), true);
      }
    }));
    render();
    studio.draw();
  }

  function keep(track, entry) {
    entry.peaks = T.peaks(entry.samples, entry.rate);
    entry.buffer = null;
    takes.set(track, entry);
    waveCache = new Map();
  }

  async function deleteTake(track, button) {
    const t = takes.get(track);
    if (!t) return;
    if (button.dataset.sure !== "1") {
      button.dataset.sure = "1";
      button.textContent = tr("Delete for good?");
      return;
    }
    try {
      if (t.take?.id) await request(`/${t.take.id}`, { method: "DELETE" });
    } catch (error) {
      return say(tr("The take was not deleted: {why}", { why: error.message }), true);
    }
    takes.delete(track);
    waveCache = new Map();
    render();
    studio.draw();
    say(tr("{name}'s take is deleted.", { name: t.take?.name ?? `Audio ${track}` }));
  }

  // ---- Recording a take -------------------------------------------------------------

  async function recordTake(track) {
    if (st.taking) return studio.stop();
    if (!url) return say(tr("Audio tracks are kept with the score in the app: sign up to record them."), true);
    if (!writable) return say(tr("This score is shared with you to read: its audio tracks are its editors'."), true);
    if (track > tracksAllowed) return say(tracksAllowed === 1 ? tr("This score records on {n} audio track.", { n: tracksAllowed }) : tr("This score records on {n} audio tracks.", { n: tracksAllowed }), true, plans(pricing));
    if (!st.score) return say(tr("Recording needs the score tools: this piece is edited in its text."), true);
    if (st.recording) return say(tr("A MIDI recording is under way: stop it first."), true);
    if (practising || tuning) stopListening();
    // Inside the click: the sound may start, and the microphone be asked for.
    const ctx = P.unlock();
    let stream;
    try {
      stream = await Mic.openMic();
    } catch (error) {
      render();
      return say(error.message, true);
    }
    if (ended) return Mic.closeMic(stream);
    if (st.playing) studio.stop();
    const bar = studio.changeBar() ?? 0;
    const passes = M.playback(st.score);
    const nameBox = panel.querySelector(`[data-audio-name="${track}"]`);
    const taking = {
      track,
      name: nameBox?.value.trim() || nameOf(track),
      stream,
      ctx,
      blocks: [],
      marks: [],
      samples: 0,
      speed: 1,
      bar,
      from: passes.find((p) => p.bar === bar)?.start ?? 0,
      latency: Mic.inputLatency(stream),
      into: liveBox.checked && intoBox.value !== "" ? Number(intoBox.value) : null,
    };
    st.taking = taking;
    try {
      taking.rec = await Mic.capture(ctx, stream, (block) => onBlock(taking, block));
    } catch (error) {
      st.taking = null;
      Mic.closeMic(stream);
      render();
      return say(tr("The microphone could not be recorded: {why}", { why: error.message ?? error }), true);
    }
    if (ended) return taking.rec.stop();
    render();
    await studio.play();
    if (st.taking !== taking) return;
    if (!st.playing) {
      // Play gave up (the sounds did not load): nothing to keep.
      st.taking = null;
      taking.rec.stop();
      Mic.closeMic(stream);
      return render();
    }
    say(tr("Recording into {name} from bar {bar}: sing or play after the count-in. Stop, or Space, ends it. Headphones keep the score out of the take.", { name: taking.name, bar: studio.barNo(bar) }));
  }

  function onBlock(taking, { samples, time }) {
    if (st.taking !== taking) return;
    const first = taking.samples;
    taking.blocks.push(samples);
    taking.samples += samples.length;
    const handle = st.playing?.handle;
    if (!handle || handle.paused) return;
    taking.speed = handle.rate;
    const music = T.musicAt({ blockTime: time, ctxNow: taking.ctx.currentTime, handleTime: handle.time, rate: handle.rate, inputLatency: taking.latency, outputLatency: P.outputDelay(taking.ctx) });
    taking.marks.push({ sample: first, music });
    // Full: as long as a take may be.
    if (music - taking.from > T.maxSeconds(maxBytes) * handle.rate - T.PREROLL - 0.5) {
      taking.full = true;
      studio.stop();
    }
  }

  /** The music stopped while a take was recorded: it is placed, kept and sent. */
  async function finishTake() {
    const taking = st.taking;
    if (!taking) return;
    st.taking = null;
    taking.rec?.stop();
    Mic.closeMic(taking.stream);
    if (!taking.marks.length) {
      render();
      return say(tr("Nothing was recorded: the music had not started."));
    }
    const all = new Float32Array(taking.samples);
    let at = 0;
    for (const block of taking.blocks) {
      all.set(block, at);
      at += block.length;
    }
    const rate = taking.ctx.sampleRate;
    const placed = T.offsetOf(taking.marks, rate, taking.speed);
    const { start, offset } = T.trimmed(placed, taking.from, rate, taking.speed);
    let samples = T.resample(all.subarray(start), rate, T.TAKE_RATE);
    const most = Math.floor(T.maxSeconds(maxBytes) * T.TAKE_RATE);
    if (samples.length > most) samples = samples.slice(0, most);
    if (samples.length < T.TAKE_RATE * 0.2) {
      render();
      return say(tr("The take was too short to keep."));
    }
    const take = { id: null, track: taking.track, name: taking.name, offset, rate: taking.speed, duration: samples.length / T.TAKE_RATE, size: 44 + samples.length * 2 };
    keep(taking.track, { take, samples, rate: T.TAKE_RATE, unsaved: tr("sending…") });
    render();
    studio.draw();
    const saved = await saveTake(taking.track);
    const length = clock(take.duration);
    if (saved) {
      const recorded = { length, name: take.name, bar: studio.barNo(taking.bar) };
      say(taking.full
        ? tr("Recorded {length} into {name}, from bar {bar} — as long as a take may be. It plays with the score; Audio tracks… deletes it.", recorded)
        : tr("Recorded {length} into {name}, from bar {bar}. It plays with the score; Audio tracks… deletes it.", recorded));
    }
    if (taking.into != null && st.score) await transcribeInto(taking.track, taking.into);
  }

  /** Sends track `track`'s take to the server; true once it is kept there. */
  async function saveTake(track) {
    const t = takes.get(track);
    if (!t) return false;
    const form = new FormData();
    form.append("audio", new Blob([T.encodeWav(t.samples, t.rate)], { type: "audio/wav" }), `track-${track}.wav`);
    for (const field of ["track", "name", "offset", "rate", "duration"]) form.append(field, String(t.take[field]));
    try {
      say(tr("Saving the take…"));
      const answer = await request("", { method: "POST", body: form });
      t.take = answer.take;
      t.unsaved = null;
      render();
      return true;
    } catch (error) {
      t.unsaved = error.message;
      render();
      say(tr("The take was not saved: {why} It is kept in this window: Audio tracks… › Save again.", { why: error.message }), true, plans(error.upgrade));
      return false;
    }
  }

  // ---- Playing the takes with the score ----------------------------------------------

  function bufferOf(t) {
    t.buffer ??= (() => {
      const buffer = new AudioBuffer({ length: Math.max(1, t.samples.length), sampleRate: t.rate, numberOfChannels: 1 });
      buffer.copyToChannel(t.samples, 0);
      return buffer;
    })();
    return t.buffer;
  }

  /** Track `track`'s strip on `ctx`: its volume, pan and effects, into the master. */
  function stripOf(ctx, track) {
    const destination = st.liveMixer?.master?.input ?? ctx.destination;
    let entry = strips.get(track);
    if (!entry || entry.ctx !== ctx) {
      entry = { ctx, strip: X.strip(ctx), to: null };
      strips.set(track, entry);
    }
    if (entry.to !== destination) {
      try {
        entry.strip.output.disconnect();
      } catch (error) {}
      entry.strip.output.connect(destination);
      entry.to = destination;
    }
    return entry.strip;
  }

  function stopSources() {
    for (const source of sources) {
      try {
        source.stop();
        source.disconnect();
      } catch (error) {}
    }
    sources = [];
  }

  function startPlayback(handle) {
    stopSources();
    anchor = null;
    if (!handle || !takes.size) return;
    const ctx = P.unlock();
    anchor = { at: ctx.currentTime, music: handle.time, rate: handle.rate, paused: handle.paused };
    if (handle.paused) return;
    for (const [track, t] of takes) {
      if (st.taking?.track === track || !t.samples) continue;
      const when = T.scheduleOf({ music: handle.time, rate: handle.rate, offset: t.take.offset, takeRate: t.take.rate || 1, duration: t.samples.length / t.rate });
      if (!when) continue;
      const source = ctx.createBufferSource();
      source.buffer = bufferOf(t);
      source.playbackRate.value = when.playbackRate;
      source.connect(stripOf(ctx, track).input);
      source.start(ctx.currentTime + when.delay, when.from);
      sources.push(source);
    }
    applyMix(studio.mixHeard());
  }

  /** Every tick of Play: started again where the music is after a seek, a loop's jump, a pause or a new speed. */
  function sync(handle) {
    if (!anchor || !handle) return;
    const ctx = P.unlock();
    if (handle.paused) {
      if (!anchor.paused) {
        stopSources();
        anchor.paused = true;
      }
      return;
    }
    const expected = anchor.music + (ctx.currentTime - anchor.at) * anchor.rate;
    if (anchor.paused || handle.rate !== anchor.rate || Math.abs(handle.time - expected) > 0.12) startPlayback(handle);
  }

  function stopPlayback() {
    stopSources();
    anchor = null;
  }

  function applyMix(mix) {
    for (const [track, entry] of strips) {
      const lane = T.laneOf(track);
      const s = X.trackOf(mix, lane);
      entry.strip.apply(s, X.audible(mix, lane) ? X.dbToGain(s.volume) : 0);
    }
  }

  function mixerTracks() {
    return [...takes.keys()].sort((a, b) => a - b).map((track) => ({ lane: T.laneOf(track), name: `${nameOf(track)} (audio)`, colour: COLOUR }));
  }

  // ---- The waveforms under the staves ------------------------------------------------

  function html() {
    if (!st.score || (!takes.size && !st.taking)) return "";
    const geo = R.rollLayout(st.score, { layout: st.rollLayout, zoom: st.zoom, only: st.rollLayout === "keys" ? st.rollOnly : null });
    const passes = M.playback(st.score);
    const end = passes.at(-1)?.end ?? 0;
    const tickAt = (sec) => (sec < 0 || sec > end ? null : M.tickAtPlayed(st.score, passes, sec));
    const out = [];
    for (const track of [...takes.keys()].sort((a, b) => a - b)) {
      const t = takes.get(track);
      if (!t?.peaks) continue;
      const key = `${st.text.length}:${st.text.slice(0, 400)}:${geo.width}:${st.rollLayout}`;
      const cached = waveCache.get(track);
      if (cached?.key === key) {
        out.push(cached.svg);
        continue;
      }
      const svg = waveSvg(geo, t.peaks, { offset: t.take.offset, takeRate: t.take.rate || 1, tickAt, label: nameOf(track) });
      waveCache.set(track, { key, svg });
      out.push(svg);
    }
    if (st.taking && !takes.has(st.taking.track)) {
      out.push(waveSvg(geo, new Float32Array(0), { offset: 0, tickAt, label: tr("● {name}, recording…", { name: st.taking.name }), recording: true }));
    }
    return `<div class="studio-waves">${out.join("")}</div>`;
  }

  // ---- Transcription --------------------------------------------------------------

  /** The frames of a take, read a slice at a time so that the page stays alive. */
  async function analyseSlowly(samples, rate) {
    const frames = [];
    const slice = rate * 4;
    for (let at = 0; at < samples.length; at += slice) {
      const part = samples.subarray(at, Math.min(samples.length, at + slice + Pi.FRAME));
      for (const f of Pi.analyse(part, rate)) {
        const t = f.t + at / rate;
        if (frames.length && t <= frames.at(-1).t + 1e-9) continue;
        frames.push({ ...f, t });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return frames;
  }

  async function transcribeInto(track, lane) {
    const t = takes.get(track);
    if (!t?.samples) return say(tr("Record a take first: its notes are written from it."), true);
    if (!st.score?.staves[lane]) return say(tr("Choose the staff the notes go into."), true);
    say(tr("Listening to {name}…", { name: nameOf(track) }));
    const notes = Pi.segmentNotes(await analyseSlowly(t.samples, t.rate)).map((n) => ({ key: n.key, t0: n.t0, t1: n.t1, velocity: Pi.velocityOf(n.peak) }));
    if (!notes.length) return say(tr("No notes were heard in {name}: one voice or instrument, clearly, is what is written down.", { name: nameOf(track) }), true);
    const padded = M.padded(st.score);
    const passes = M.playback(padded);
    const toTick = (sec) => M.tickAtPlayed(padded, passes, Math.max(0, t.take.offset + sec * (t.take.rate || 1)));
    const played = notes.map((n) => {
      const t0 = toTick(n.t0);
      return { key: n.key, t0, t1: Math.max(t0 + 1, toTick(n.t1)), velocity: n.velocity };
    });
    const grid = studio.grid();
    const first = M.barAt(padded, Math.min(...played.map((n) => n.t0)));
    const last = M.barAt(padded, Math.max(...played.map((n) => n.t1)) - 1);
    const from = M.barStart(padded, first);
    const to = M.barStart(padded, last + 1);
    let written = 0;
    const done = studio.edit((score) => {
      M.ensureLength(score, to);
      written = M.writeRecording(score, lane, from, to, played, grid);
      Vel.setVelocities(score, Vel.fromRecording(score, lane, played, grid));
    });
    if (!done) return;
    const bars = first === last ? tr("bar {n}", { n: studio.barNo(first) }) : tr("bars {from}–{to}", { from: studio.barNo(first), to: studio.barNo(last) });
    const wrote = { n: written, name: nameOf(track), staff: studio.laneName(lane), bars, grid: studio.gridName() };
    say(written === 1
      ? tr("Wrote 1 note from {name} into {staff}, {bars}, fitted to {grid}. Ctrl+Z takes it back.", wrote)
      : tr("Wrote {n} notes from {name} into {staff}, {bars}, fitted to {grid}. Ctrl+Z takes it back.", wrote));
  }

  // ---- Listening: the tuner and practice ------------------------------------------------

  let tuning = null;
  let practising = null;

  function stopListening() {
    for (const job of [tuning, practising]) {
      if (!job) continue;
      job.ear?.stop();
      Mic.closeMic(job.stream);
    }
    tuning = null;
    practising = null;
    for (const button of root.querySelectorAll("[data-tuner-start], [data-practice-start]")) {
      button.textContent = tr("Start listening");
      button.setAttribute("aria-pressed", "false");
    }
  }

  const tunerBox = Object.assign(document.createElement("dialog"), { className: "studio-tuner" });
  tunerBox.setAttribute("aria-label", tr("Tuner"));
  const ticks = [-50, -25, 0, 25, 50].map((c) => {
    const a = ((c * 0.9 - 90) * Math.PI) / 180;
    return `<line class="tuner-tick${c === 0 ? " tuner-zero" : ""}" x1="${(100 + 78 * Math.cos(a)).toFixed(1)}" y1="${(100 + 78 * Math.sin(a)).toFixed(1)}" x2="${(100 + 88 * Math.cos(a)).toFixed(1)}" y2="${(100 + 88 * Math.sin(a)).toFixed(1)}"/><text class="tuner-scale" x="${(100 + 70 * Math.cos(a)).toFixed(1)}" y="${(100 + 70 * Math.sin(a) + 4).toFixed(1)}" text-anchor="middle">${c > 0 ? `+${c}` : c}</text>`;
  });
  tunerBox.innerHTML = `<div class="mixer-head"><h3>${tr("Tuner")}</h3><button type="button" class="tool" data-tuner-close aria-label="${tr("Close the tuner")}">✕</button></div>
    <div class="tuner-face">
      <svg class="tuner-dial" viewBox="0 0 200 112" role="img" aria-label="${tr("How far off the note is")}">
        <path class="tuner-arc" d="M 12 100 A 88 88 0 0 1 188 100"/>
        <path class="tuner-band" d="M ${(100 - 88 * Math.sin((4.5 * Math.PI) / 180)).toFixed(1)} ${(100 - 88 * Math.cos((4.5 * Math.PI) / 180)).toFixed(1)} A 88 88 0 0 1 ${(100 + 88 * Math.sin((4.5 * Math.PI) / 180)).toFixed(1)} ${(100 - 88 * Math.cos((4.5 * Math.PI) / 180)).toFixed(1)}"/>
        ${ticks.join("")}
        <line class="tuner-needle" data-tuner-needle x1="100" y1="100" x2="100" y2="22"/>
        <circle class="tuner-hub" cx="100" cy="100" r="5"/>
      </svg>
      <div class="tuner-note" aria-live="polite"><span data-tuner-name>–</span><sub data-tuner-octave></sub></div>
      <div class="tuner-cents" data-tuner-cents>${tr("Play or sing a note")}</div>
      <div class="tuner-freq" data-tuner-freq></div>
    </div>
    <div class="audio-row">
      <label>A4 = <input type="number" data-tuner-a4 min="400" max="480" step="0.5" value="440" aria-label="${tr("The A above middle C, in hertz")}"> Hz</label>
      <button type="button" class="tool" data-tuner-start aria-pressed="false">${tr("Start listening")}</button>
    </div>`;
  root.append(tunerBox);
  const a4Box = tunerBox.querySelector("[data-tuner-a4]");
  try {
    const kept = Number(localStorage.getItem(A4_KEY));
    if (kept >= 400 && kept <= 480) a4Box.value = String(kept);
  } catch (error) {}
  const a4 = () => {
    const value = Number(a4Box.value);
    return value >= 400 && value <= 480 ? value : 440;
  };
  a4Box.addEventListener("change", () => {
    a4Box.value = String(a4());
    try {
      localStorage.setItem(A4_KEY, String(a4()));
    } catch (error) {}
  });

  /** The tuner shows `freq` (null: nothing heard). */
  function showPitch(freq) {
    const name = tunerBox.querySelector("[data-tuner-name]");
    const octave = tunerBox.querySelector("[data-tuner-octave]");
    const cents = tunerBox.querySelector("[data-tuner-cents]");
    const needle = tunerBox.querySelector("[data-tuner-needle]");
    tunerBox.classList.toggle("tuner-quiet", freq == null);
    if (freq == null) return;
    const n = Pi.noteOf(freq, a4());
    name.textContent = n.name;
    octave.textContent = String(n.octave);
    // Within 5 cents is in tune (the needle turns green there too); the cents still show.
    const off = `${n.cents > 0 ? "+" : "−"}${Math.abs(n.cents)} cents`;
    const inTune = Math.abs(n.cents) <= 5;
    cents.textContent = n.cents === 0 ? tr("in tune") : inTune ? tr("in tune, {off}", { off }) : n.cents > 0 ? tr("{off} sharp", { off }) : tr("{off} flat", { off });
    tunerBox.querySelector("[data-tuner-freq]").textContent = `${freq.toFixed(1)} Hz`;
    needle.setAttribute("transform", `rotate(${(n.cents * 0.9).toFixed(1)} 100 100)`);
    tunerBox.classList.toggle("tuner-in", inTune);
    tunerBox.dataset.heard = `${n.name}${n.octave} ${n.cents}`;
  }

  async function startTuner(button) {
    if (tuning) return stopListening();
    stopListening();
    const ctx = P.unlock();
    let stream;
    try {
      stream = await Mic.openMic();
    } catch (error) {
      tunerBox.querySelector("[data-tuner-cents]").textContent = error.message;
      return say(error.message, true);
    }
    if (ended) return Mic.closeMic(stream);
    let smooth = null;
    let quiet = 0;
    tuning = {
      stream,
      ear: Mic.listen(ctx, stream, (f) => {
        if (f.freq == null || f.clarity < Pi.CLARITY) {
          if (++quiet > 8) {
            smooth = null;
            showPitch(null);
          }
          return;
        }
        quiet = 0;
        // Smoothed in cents, so the needle does not shake; a new note jumps.
        smooth = smooth == null || Math.abs(Pi.midiOf(f.freq) - Pi.midiOf(smooth)) > 0.5 ? f.freq : smooth * (f.freq / smooth) ** 0.3;
        showPitch(smooth);
      }),
    };
    button.textContent = tr("Stop listening");
    button.setAttribute("aria-pressed", "true");
    tunerBox.querySelector("[data-tuner-cents]").textContent = tr("Listening…");
  }

  tunerBox.addEventListener("click", (event) => {
    if (event.target.closest("[data-tuner-close]")) {
      stopListening();
      return tunerBox.close();
    }
    const start = event.target.closest("[data-tuner-start]");
    if (start) startTuner(start);
  });

  const practiceBox = Object.assign(document.createElement("dialog"), { className: "studio-practice" });
  practiceBox.setAttribute("aria-label", tr("Practice"));
  practiceBox.innerHTML = `<div class="mixer-head"><h3>${tr("Practice")}</h3><button type="button" class="tool" data-practice-close aria-label="${tr("Close")}">✕</button></div>
    <p class="audio-hint">${tr("Play or sing your part: the microphone listens, and the score follows you, from the selected bar. No music plays. A wrong or missed note is passed over; after a jump, two or three notes find you again.")}</p>
    <div class="audio-row">
      <label>${tr("Staff")} <select data-practice-staff aria-label="${tr("The staff you play")}"></select></label>
      <label class="audio-check"><input type="checkbox" data-practice-octaves checked> ${tr("An octave off counts")}</label>
      <button type="button" class="tool" data-practice-start aria-pressed="false">${tr("Start listening")}</button>
    </div>
    <div class="practice-state" aria-live="polite"><span>${tr("Heard:")} <b data-practice-heard>–</b></span><span>${tr("Next:")} <b data-practice-next>–</b></span><span data-practice-said></span></div>`;
  root.append(practiceBox);
  const practiceStaff = practiceBox.querySelector("[data-practice-staff]");

  function expectedFor(lane) {
    const score = st.score;
    const passes = M.playback(score);
    return Fo.expectedNotes(R.rollNotes(score), lane, passes, {
      barAt: (t) => M.barAt(score, t),
      barStart: (b) => M.barStart(score, b),
      secOf: (pass, into) => {
        const length = M.barStart(score, pass.bar + 1) - M.barStart(score, pass.bar);
        return pass.start + (length ? (into / length) * (pass.end - pass.start) : 0);
      },
    });
  }

  const keyText = (keys) => keys.map((k) => R.keyName(k)).join(" ");

  async function startPractice(button) {
    if (practising) return stopListening();
    stopListening();
    if (!st.score) return say(tr("Practice needs the score tools: this piece is edited in its text."), true);
    const lane = Number(practiceStaff.value || 0);
    const expected = expectedFor(lane);
    if (!expected.length) return say(tr("That staff has no notes to follow."), true);
    const ctx = P.unlock();
    let stream;
    try {
      stream = await Mic.openMic();
    } catch (error) {
      practiceBox.querySelector("[data-practice-said]").textContent = error.message;
      return say(error.message, true);
    }
    if (ended) return Mic.closeMic(stream);
    if (st.playing) studio.stop();
    const follower = Fo.createFollower(expected, { octaves: practiceBox.querySelector("[data-practice-octaves]").checked });
    const bar = studio.changeBar() ?? 0;
    follower.jump(Math.max(0, expected.findIndex((e) => e.bar >= bar)));
    const next = () => {
      const e = expected[follower.at];
      practiceBox.querySelector("[data-practice-next]").textContent = e ? tr("{keys}, bar {bar}", { keys: keyText(e.keys), bar: studio.barNo(e.bar) }) : tr("the end");
    };
    next();
    const tracker = Pi.noteTracker({ minNote: 0.06 });
    const job = { stream, lane, expected, follower };
    job.ear = Mic.listen(ctx, stream, (f) => {
      if (practising !== job) return;
      const out = tracker.push(f);
      if (!out.started) return;
      hear(job, out.started.key);
      next();
    });
    practising = job;
    button.textContent = tr("Stop listening");
    button.setAttribute("aria-pressed", "true");
    say(tr("Practice: play {staff} from bar {bar}; the score follows you.", { staff: studio.laneName(lane), bar: studio.barNo(bar) }));
  }

  function hear(job, key) {
    const result = job.follower.hear(key);
    practiceBox.querySelector("[data-practice-heard]").textContent = R.keyName(key);
    const said = { match: "✓", skip: tr("✓ (notes missed before it)"), resync: tr("found you again"), wrong: tr("not the note expected"), end: tr("the end of the staff") }[result.kind];
    practiceBox.querySelector("[data-practice-said]").textContent = said;
    practiceBox.dataset.at = String(result.at);
    if (result.index >= 0) studio.showPlace(job.lane, job.expected[result.index].tick);
  }

  practiceBox.addEventListener("click", (event) => {
    if (event.target.closest("[data-practice-close]")) {
      stopListening();
      return practiceBox.close();
    }
    const start = event.target.closest("[data-practice-start]");
    if (start) startPractice(start);
  });

  load();

  /**
   * The editor is gone (instant navigation): the microphone let go — the
   * tuner's, practice's, a take's (not kept) — and the takes silent. A
   * microphone asked for meanwhile is let go as it comes (`ended`).
   */
  function end() {
    ended = true;
    stopListening();
    const taking = st.taking;
    st.taking = null;
    if (taking) {
      taking.rec?.stop();
      Mic.closeMic(taking.stream);
    }
    stopPlayback();
  }

  return {
    html,
    end,
    startPlayback,
    sync,
    stopPlayback,
    finishTake,
    mixerTracks,
    applyMix,
    get taking() {
      return Boolean(st.taking);
    },
    open() {
      render();
      if (!panel.open) panel.show();
    },
    toggle() {
      if (panel.open) panel.close();
      else this.open();
    },
    tuner() {
      if (!tunerBox.open) tunerBox.show();
    },
    practice() {
      staffOptions(practiceStaff);
      if (!practiceBox.open) practiceBox.show();
    },
    /** Records onto the first empty track (or the first): Play › Record from the microphone. */
    record() {
      if (st.taking) return studio.stop();
      if (!url) {
        this.open();
        return say(tr("Audio tracks are kept with the score in the app: sign up to record them."), true);
      }
      this.open();
      let track = 1;
      while (track < Math.min(trackCount, tracksAllowed) && takes.has(track)) track++;
      return recordTake(track);
    },
    refresh() {
      if (panel.open) render();
    },
  };
}
