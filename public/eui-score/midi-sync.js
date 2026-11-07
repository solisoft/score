// The editor with other MIDI gear: the clock sent to the "Sound to" device
// and followed from the MIDI keyboard, MIDI learn, and the device's latency.
//
// - MIDI clock out: 24 pulses a quarter note, Start / Stop / Continue and
//   Song Position Pointer, sent to the device the music goes to (Sound to),
//   so GarageBand, Logic or a drum machine play in time. Every message is
//   given its Web MIDI timestamp ahead of time (`output.send(data, at)`): the
//   25 ms loop only decides what to send next, never when it sounds.
// - MIDI clock in: Start, Stop, Continue, Song Position and the tempo of a
//   clock coming in on the MIDI keyboard chosen, followed by the playback.
// - MIDI learn: Play, Stop, Record, the speed, the volume, each staff's mute
//   and solo, given to a controller's knob, fader, pad or key. Per browser.
// - Pitch bend and aftertouch from the keyboard sound live.
//
// Ableton Link is not here: it is a network protocol (UDP multicast), and a
// web page can open no such socket. Web MIDI is all a browser has.
//
// The pure parts (the clock's times, the follower, the learnt controls) are
// exported for tests; `attach` wires them into the studio.

const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

export const PPQN = 24;
const SPP_MAX = 16383;

// ---- The clock's times ------------------------------------------------------------------

/**
 * The playback `passes` (score-model.js's playback(): { start, end, bpm,
 * base, holds }) as a line of quarter notes: [{ start, end, q0, q }], `q0`
 * the quarters before the pass, `q` its own. `whole` is the model's ticks
 * in a whole note. A fermata's held time stretches its bar's pulses.
 */
export function timeline(passes, whole) {
  let q0 = 0;
  return passes.flatMap((p) => {
    // A bar gliding through a rit. or an accel. (#379): its steps, each at its own speed.
    if (p.steps?.length > 1) {
      const lines = p.steps.slice(1).map((s, k) => ({ start: p.steps[k].sec, end: s.sec, q0: q0 + p.steps[k].q, q: s.q - p.steps[k].q }));
      q0 += p.steps.at(-1).q;
      return lines;
    }
    const held = (p.holds ?? []).reduce((sum, h) => sum + h.ticks, 0);
    const ticks = Math.max(0, ((p.end - p.start) * p.bpm) / 60 * (whole / p.base) - held);
    const q = ticks / (whole / 4);
    const line = { start: p.start, end: p.end, q0, q };
    q0 += q;
    return line;
  });
}

/** The quarter notes played by `sec` (a fraction between). */
export function quarterAt(line, sec) {
  if (!line.length) return 0;
  let k = 0;
  while (k + 1 < line.length && line[k + 1].start <= sec + 1e-9) k++;
  const p = line[k];
  const span = p.end - p.start;
  const into = span > 0 ? Math.max(0, Math.min(1, (sec - p.start) / span)) : 1;
  return p.q0 + into * p.q;
}

/** When quarter `q` (a fraction allowed) is played, in seconds; past the end, at the last pass's speed. */
export function secAtQuarter(line, q) {
  if (!line.length) return 0;
  let k = 0;
  while (k + 1 < line.length && line[k + 1].q0 <= q + 1e-9) k++;
  const p = line[k];
  if (p.q <= 0) return p.end;
  return p.start + ((q - p.q0) / p.q) * (p.end - p.start);
}

/**
 * The Song Position Pointer to start the clock from at `sec`: in MIDI beats
 * (sixteenth notes), the next one on — the device starts there on the next
 * pulse — and the pulse that is.
 */
export function songPosition(line, sec) {
  const sixteenths = Math.min(SPP_MAX, Math.max(0, Math.ceil(quarterAt(line, sec) * 4 - 1e-6)));
  return { sixteenths, pulse: sixteenths * (PPQN / 4) };
}

/** A Song Position Pointer message. */
export const sppBytes = (sixteenths) => [0xf2, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f];

/**
 * Sends the clock to `port` (a MIDIOutput, or anything with send(data, at))
 * as the playback moves. Call `tick(handle, line)` often (every 25 ms) with
 * the player's handle ({ time, rate, paused }) and the timeline; `stop()`
 * when the music stops. Each message goes out with its timestamp (ms, the
 * `now()` clock: performance.now()), up to `lookahead` seconds early.
 */
export class ClockSender {
  constructor(port, { now = () => performance.now(), lookahead = 0.1 } = {}) {
    this.port = port;
    this.now = now;
    this.lookahead = lookahead;
    this.running = false;
    this.anchor = null;
    this.next = 0;
  }

  send(data, at) {
    try {
      this.port.send(data, at);
    } catch (error) {}
  }

  /** The playback starts, or goes on, from `sec`: Start from the very beginning, else Song Position and Continue. */
  begin(handle, line, nowMs) {
    const { sixteenths, pulse } = songPosition(line, handle.time);
    this.anchor = { perf: nowMs, sec: handle.time, rate: handle.rate || 1 };
    this.next = pulse;
    const first = Math.max(nowMs, this.at(line, pulse) - 1);
    if (sixteenths === 0) this.send([0xfa], first);
    else {
      this.send(sppBytes(sixteenths), nowMs);
      this.send([0xfb], first);
    }
    this.running = true;
  }

  /** Pulse `n`'s timestamp. */
  at(line, n) {
    const sec = secAtQuarter(line, n / PPQN);
    return this.anchor.perf + ((sec - this.anchor.sec) / this.anchor.rate) * 1000;
  }

  tick(handle, line) {
    const nowMs = this.now();
    if (!handle || handle.paused) return this.stop(nowMs);
    if (!this.running) return this.begin(handle, line, nowMs), this.pulses(line, nowMs);
    const expected = this.anchor.sec + ((nowMs - this.anchor.perf) / 1000) * this.anchor.rate;
    const drift = handle.time - expected;
    if (Math.abs(drift) > 0.25) {
      // A jump — a seek, the loop going back: the device is told where to.
      this.send([0xfc], nowMs);
      this.begin(handle, line, nowMs);
    } else if ((handle.rate || 1) !== this.anchor.rate || Math.abs(drift) > 0.03) {
      // A new speed, or the clocks drifting apart: from here on, at the speed now.
      this.anchor = { perf: nowMs, sec: Math.abs(drift) > 0.03 ? handle.time : expected, rate: handle.rate || 1 };
    }
    if (this.at(line, this.next) < nowMs - 250) {
      // The loop was held up (a tab in the background): no burst of late pulses, the device is told where the music is.
      this.send([0xfc], nowMs);
      this.begin(handle, line, nowMs);
    }
    this.pulses(line, nowMs);
  }

  /** Every pulse due before the lookahead's end, each once. */
  pulses(line, nowMs) {
    const until = nowMs + this.lookahead * 1000;
    for (let guard = 0; guard < 256; guard++) {
      const at = this.at(line, this.next);
      if (at > until) break;
      this.send([0xf8], Math.max(nowMs, at));
      this.next++;
    }
  }

  stop(nowMs = this.now()) {
    if (!this.running) return;
    this.running = false;
    this.send([0xfc], nowMs);
  }
}

// ---- The clock coming in ------------------------------------------------------------------

/**
 * Follows a MIDI clock: `message(data, stampMs)` for each message in;
 * `on.start()`, `on.stop()`, `on.continue()`, `on.position(sixteenths)` and
 * `on.tempo(bpm)` — the tempo from the last quarter note's pulses, said
 * again when it moves by half a beat a minute or more. Answers true for
 * a clock message.
 */
export class ClockFollower {
  constructor(on = {}) {
    this.on = on;
    this.stamps = [];
    this.bpm = 0;
  }

  message(data, stamp) {
    switch (data[0]) {
      case 0xf8: {
        this.stamps.push(stamp);
        if (this.stamps.length > PPQN + 1) this.stamps.shift();
        const n = this.stamps.length - 1;
        if (n >= PPQN / 4) {
          const pulse = (this.stamps[n] - this.stamps[0]) / n;
          const bpm = pulse > 0 ? 60000 / (pulse * PPQN) : 0;
          if (bpm > 0 && Math.abs(bpm - this.bpm) >= 0.5) {
            this.bpm = bpm;
            this.on.tempo?.(bpm);
          }
        }
        return true;
      }
      case 0xfa:
        this.stamps = [];
        this.on.start?.();
        return true;
      case 0xfb:
        this.on.continue?.();
        return true;
      case 0xfc:
        this.on.stop?.();
        return true;
      case 0xf2:
        this.on.position?.((data[1] & 0x7f) | ((data[2] & 0x7f) << 7));
        return true;
      default:
        return false;
    }
  }
}

// ---- MIDI learn --------------------------------------------------------------------------

/** What a controller's message is: { kind: "cc" | "note", channel, number, value } (a note let go: value 0); null for anything else. */
export function controlOf(data) {
  const [status, number, value] = data;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  if (kind === 0xb0) return { kind: "cc", channel, number, value };
  if (kind === 0x90) return { kind: "note", channel, number, value };
  if (kind === 0x80) return { kind: "note", channel, number, value: 0 };
  return null;
}

/** The controls that move a value rather than press a button. */
export const CONTINUOUS = new Set(["tempo", "volume"]);

/** A control as words: "CC 7, channel 1" or "note C4, channel 10". */
export function controlName({ kind, channel, number }) {
  if (kind === "cc") return tr("CC {number}, channel {channel}", { number, channel: channel + 1 });
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return tr("note {note}, channel {channel}", { note: `${names[number % 12]}${Math.floor(number / 12) - 1}`, channel: channel + 1 });
}

const same = (a, b) => a.kind === b.kind && a.channel === b.channel && a.number === b.number;

/**
 * The controls learnt, kept in `storage` (localStorage) under `key`:
 * { target: { kind, channel, number } }, one control a target, one target
 * a control. `learn(target)` arms it: the next knob moved or key pressed is
 * its control. `message(data)` answers what a message does:
 * { learnt: target }, { target, value } (value 0…1; a button's press only),
 * or null when it is nothing learnt.
 */
export class Learnt {
  constructor(storage = null, key = "eui-score-midi-learn") {
    this.storage = storage;
    this.key = key;
    this.armed = null;
    this.last = new Map();
    this.map = {};
    try {
      this.map = JSON.parse(storage?.getItem(key) || "{}") ?? {};
    } catch (error) {
      this.map = {};
    }
  }

  save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.map));
    } catch (error) {}
  }

  get(target) {
    return this.map[target] ?? null;
  }

  list() {
    return Object.entries(this.map).map(([target, control]) => ({ target, control }));
  }

  learn(target) {
    this.armed = target;
  }

  assign(target, { kind, channel, number }) {
    for (const [other, control] of Object.entries(this.map)) if (same(control, { kind, channel, number })) delete this.map[other];
    this.map[target] = { kind, channel, number };
    this.save();
  }

  clear(target = null) {
    if (target) delete this.map[target];
    else this.map = {};
    this.save();
  }

  message(data) {
    const control = controlOf(data);
    if (!control) return null;
    if (this.armed) {
      // A key let go, or a knob back at zero, does not teach: the move does.
      if (control.kind === "note" && control.value === 0) return { swallowed: true };
      const target = this.armed;
      this.armed = null;
      this.assign(target, control);
      return { learnt: target, control };
    }
    const target = Object.keys(this.map).find((t) => same(this.map[t], control));
    if (!target) return null;
    const id = `${control.kind}${control.channel}:${control.number}`;
    const was = this.last.get(id) ?? 0;
    this.last.set(id, control.value);
    if (CONTINUOUS.has(target.split(":")[0])) return { target, value: control.value / 127 };
    // A button: a key pressed, or a CC going over half way; the release, nothing.
    const pressed = control.kind === "note" ? control.value > 0 : control.value >= 64 && was < 64;
    return pressed ? { target, value: 1 } : { swallowed: true };
  }
}

/** Pitch bend, channel and key pressure: the keyboard's expression, sounded live. */
export const isExpression = (data) => [0xe0, 0xd0, 0xa0].includes(data[0] & 0xf0);

/**
 * The time `heard` (seconds of the piece, as heard) less the time the key's
 * message waited before it was read (`ageMs`), at playback `rate`: when the
 * key was really struck.
 */
export const struckAt = (heard, rate, ageMs) => Math.max(0, heard - (Math.max(0, ageMs) / 1000) * (rate || 1));

// ---- In the studio ------------------------------------------------------------------------

const SETTINGS = "eui-score-midi-sync";

/** The settings kept in this browser: { clockOut, clockIn, delay }. */
export function readSettings(storage) {
  try {
    const kept = JSON.parse(storage?.getItem(SETTINGS) || "{}") ?? {};
    return { clockOut: Boolean(kept.clockOut), clockIn: Boolean(kept.clockIn), delay: Number(kept.delay) || 0 };
  } catch (error) {
    return { clockOut: false, clockIn: false, delay: 0 };
  }
}

function keep(storage, settings) {
  try {
    storage?.setItem(SETTINGS, JSON.stringify(settings));
  } catch (error) {}
}

/**
 * Wires the clock, MIDI learn and the latency setting into the studio.
 * `studio`: { root, st, M, P, act, say }. Answers { open(), stop() }.
 */
export function attach({ root, st, M, P, act, say }) {
  const storage = (() => {
    try {
      return localStorage;
    } catch (error) {
      return null;
    }
  })();
  const settings = readSettings(storage);
  const learnt = new Learnt(storage);
  const field = (name) => root.querySelector(`[data-sync="${name}"]`);
  const dialog = root.querySelector("[data-midi-learn]");

  P.setDeviceDelay?.(settings.delay);
  if (field("clock-out")) field("clock-out").checked = settings.clockOut;
  if (field("clock-in")) field("clock-in").checked = settings.clockIn;
  if (field("delay")) field("delay").value = String(settings.delay);
  root.addEventListener("change", (event) => {
    const name = event.target.dataset?.sync;
    if (!name) return;
    if (name === "clock-out") {
      settings.clockOut = event.target.checked;
      wake();
      if (!settings.clockOut) sender?.stop();
      if (!settings.clockOut) say(tr("No MIDI clock sent."));
      else if (P.outputPort?.()) say(tr("The MIDI clock goes with the music to the device chosen in Sound to."));
      else say(tr("The MIDI clock goes to a MIDI device: choose one in Sound to."));
    } else if (name === "clock-in") {
      settings.clockIn = event.target.checked;
      say(settings.clockIn ? tr("Following the MIDI clock of the keyboard chosen in Mode: its Start, Stop and tempo.") : tr("No longer following a MIDI clock."));
    } else if (name === "delay") {
      settings.delay = Math.max(-500, Math.min(500, Number(event.target.value) || 0));
      P.setDeviceDelay?.(settings.delay);
    }
    keep(storage, settings);
  });

  // The clock out: driven by the playback, polled — only while the music
  // plays with the clock on (`wake`), not every 25 ms for as long as the
  // page is open (#689).
  let sender = null;
  let line = null;
  let lineOf = null;
  let loop = 0;
  function poll() {
    if (!root.isConnected) return stop();
    const playing = st.playing;
    const port = settings.clockOut ? P.outputPort?.() : null;
    if (!port || !playing?.handle) {
      sender?.stop();
      if (!port) sender = null;
      clearInterval(loop);
      loop = 0;
      return;
    }
    if (!sender || sender.port !== port) {
      sender?.stop();
      sender = new ClockSender(port);
    }
    if (lineOf !== playing) {
      lineOf = playing;
      line = timeline(playing.passes, M.WHOLE);
      sender.stop();
    }
    sender.tick(playing.handle.playing ? playing.handle : null, line);
  }

  /** The music started (or the clock was turned on): the clock polled while it plays. */
  function wake() {
    if (loop || !settings.clockOut || !root.isConnected) return;
    loop = setInterval(poll, 25);
    poll();
  }

  // What comes in on the MIDI keyboard.
  const follower = new ClockFollower({
    start: () => {
      if (st.playing) act("stop");
      act("play");
    },
    continue: () => {
      if (!st.playing || st.playing.handle?.paused) act("play");
    },
    stop: () => {
      if (st.playing?.handle && !st.playing.handle.paused) act("play");
    },
    position: (sixteenths) => {
      const handle = st.playing?.handle;
      if (handle) handle.time = secAtQuarter(lineOf === st.playing && line ? line : timeline(st.playing.passes, M.WHOLE), sixteenths / 4);
    },
    tempo: (bpm) => {
      const handle = st.playing?.handle;
      const pass = handle && M.passAt(st.playing.passes, handle.time);
      if (!pass) return;
      // The score's own speed there, in quarters a minute: the playback rate is the clock's over it.
      const written = (pass.bpm * 4) / pass.base;
      handle.rate = Math.max(0.25, Math.min(4, bpm / written));
    },
  });

  const untap = P.tap?.((data, stamp) => {
    if (settings.clockIn && data[0] >= 0xf0 && follower.message(data, stamp)) return true;
    if (data[0] >= 0xf0) return false;
    const done = learnt.message(data);
    if (done?.learnt) {
      say(tr("{target}: {control}.", { target: labelOf(done.learnt), control: controlName(done.control) }));
      renderLearn();
      return true;
    }
    if (done?.target) {
      run(done.target, done.value);
      return true;
    }
    if (done?.swallowed) return true;
    if (isExpression(data)) {
      P.express?.(data);
      return true;
    }
    return false;
  });

  /** What a learnt control does. */
  function run(target, value) {
    const [what, lane] = target.split(":");
    switch (what) {
      case "play": case "stop": case "record": return act(what);
      case "mute": case "solo": return act(what, { lane });
      case "volume": return P.setVolume?.(value);
      case "tempo": {
        // The Playback section's Speed, its choices from slowest to fastest.
        const speed = root.querySelector('[data-play="rate"]');
        if (!speed) return;
        const index = Math.round(value * (speed.options.length - 1));
        if (speed.selectedIndex === index) return;
        speed.selectedIndex = index;
        speed.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  /** The controls that can be learnt: the transport, the speed, the volume, each staff's mute and solo. */
  function targets() {
    const list = [
      ["play", tr("Play or pause")],
      ["stop", tr("Stop")],
      ["record", tr("Record")],
      ["tempo", tr("Speed")],
      ["volume", "Volume"],
    ];
    for (const { lane, name } of st.score ? M.channels(st.score) : []) {
      list.push([`mute:${lane}`, tr("Mute {name}", { name })], [`solo:${lane}`, tr("Solo {name}", { name })]);
    }
    return list;
  }

  function labelOf(target) {
    return targets().find(([t]) => t === target)?.[1] ?? target;
  }

  function renderLearn() {
    const list = dialog?.querySelector("[data-learn-list]");
    if (!list) return;
    list.innerHTML = "";
    for (const [target, label] of targets()) {
      const control = learnt.get(target);
      const row = Object.assign(document.createElement("div"), { className: "midi-learn-row" });
      row.dataset.target = target;
      row.append(Object.assign(document.createElement("span"), { className: "midi-learn-name", textContent: label }));
      const armed = learnt.armed === target;
      row.append(Object.assign(document.createElement("span"), { className: "midi-learn-control", textContent: armed ? tr("move a control…") : control ? controlName(control) : "—" }));
      const learn = Object.assign(document.createElement("button"), { type: "button", className: `tool${armed ? " on" : ""}`, textContent: tr("Learn") });
      learn.dataset.learn = target;
      learn.setAttribute("aria-pressed", String(armed));
      learn.setAttribute("aria-label", tr("Learn {target}", { target: label }));
      const clear = Object.assign(document.createElement("button"), { type: "button", className: "tool", textContent: tr("Clear"), disabled: !control });
      clear.dataset.learnClear = target;
      clear.setAttribute("aria-label", tr("Clear {target}", { target: label }));
      row.append(learn, clear);
      list.append(row);
    }
  }

  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) return dialog.close();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.learnClose != null) return dialog.close();
    if (button.dataset.learnClearAll != null) {
      learnt.clear();
      say(tr("Every MIDI control forgotten."));
    } else if (button.dataset.learnClear) {
      learnt.clear(button.dataset.learnClear);
    } else if (button.dataset.learn) {
      const target = button.dataset.learn;
      learnt.learn(learnt.armed === target ? null : target);
      if (learnt.armed && !root.querySelector("[data-midi-in]")?.value) say(tr("Choose a MIDI keyboard first (Mode › MIDI keyboard): its knobs and keys are learnt."), true);
    }
    renderLearn();
  });
  dialog?.addEventListener("close", () => learnt.learn(null));

  function open() {
    if (!dialog) return;
    renderLearn();
    dialog.showModal();
  }

  function stop() {
    clearInterval(loop);
    loop = 0;
    sender?.stop();
    untap?.();
  }

  return { open, stop, wake, learnt, polling: () => loop !== 0 };
}
