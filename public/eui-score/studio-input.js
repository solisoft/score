// The studio's note input (studio.js): notes written at the cursor, their
// duration, the cursor and the selection moved along, and the voices.

/** Answers note input: writing at the cursor, durations, moving along, voices. */
export function install(ctx) {
  const { st, M } = ctx;
  const { edit, staffOf, range, select, target, need, keepOn, draw, say } = ctx.call;

  // ---- Note input ---------------------------------------------------------------

  function inputTicks() {
    return M.notated(st.input.base, st.input.dots);
  }

  function setInput(on) {
    if (on && st.score) {
      const r = range();
      st.input.staff = r ? r.s : 0;
      st.input.t = r ? M.starts(r.staff)[r.a] : 0;
      st.input.last = null;
    }
    st.input.on = Boolean(on && st.score);
    draw();
  }

  /** Writes at the cursor: `step` a letter (0–6), a drum's name, a MIDI key played ({ key }), or null for a rest. */
  function inputWrite(step, add) {
    const drum = typeof step === "string";
    const played = step !== null && typeof step === "object";
    return edit((score) => {
      const s = st.input.staff;
      if (step !== null && drum !== M.isDrums(score, s)) {
        throw new Error(drum ? "Drums go on a drum staff: add one with + Staff, Drum kit" : "A drum staff has drums, not pitches: the drum buttons write them");
      }
      const pitch = () => M.pitchOfKey(step.key, M.keyOf(score, s, st.input.t));
      const strike = (lane, i, extra) => {
        if (drum) return M.drumHit(score, lane, i, step, extra);
        if (played) return M.setPitch(score, lane, i, pitch(), extra);
        return M.letter(score, lane, i, step, extra);
      };
      if (add) {
        // The note just written; else the note at the cursor, or the one before it.
        const staff = score.staves[s];
        const at = M.starts(staff);
        const last = st.input.last && M.eventAt(score.staves[st.input.last.staff], st.input.last.t);
        let lane = s;
        let i = -1;
        if (st.input.last && last >= 0) [lane, i] = [st.input.last.staff, last];
        else {
          const here = at.findLastIndex((t) => t <= st.input.t);
          const before = at.findLastIndex((t) => t < st.input.t);
          i = staff.events[here] && !staff.events[here].rest && at[here] === st.input.t ? here : before;
        }
        if (i < 0 || score.staves[lane].events[i].rest) throw new Error("Shift+letter adds to a note's chord: write a note, or put the cursor on one");
        strike(lane, i, true);
        st.input.last = { staff: lane, t: M.starts(score.staves[lane])[i] };
        return;
      }
      const staff = score.staves[s];
      M.ensureLength(score, st.input.t + 1);
      let i = M.eventAt(staff, st.input.t);
      const ev = staff.events[i];
      if (ev?.tuplet) {
        // Into a tuplet's slot: the slot keeps its value.
        if (step === null) M.remove(score, s, i);
        else {
          if (!ev.rest) M.remove(score, s, i);
          i = M.eventAt(staff, st.input.t);
          strike(s, i, false);
        }
        const len = M.ticksOf(staff.events[M.eventAt(staff, st.input.t)]);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += len;
      } else {
        const near = M.previousPitch(score, s, i < 0 ? staff.events.length : i);
        const content = step === null ? { rest: true } : { rest: false, pitches: [drum ? M.drumPitch(step) : played ? pitch() : M.nearestPitch(step, near, M.keyOf(score, s))] };
        M.write(score, s, st.input.t, inputTicks(), content);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += inputTicks();
      }
      // Always room to write into.
      M.ensureLength(score, st.input.t + 1);
    });
  }

  function inputBack() {
    edit((score) => {
      const staff = score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t < st.input.t);
      if (i < 0) return;
      M.remove(score, st.input.staff, i);
      st.input.t = at[i];
      st.input.last = null;
    });
  }

  function inputTuplet(n) {
    edit((score) => {
      const s = st.input.staff;
      const staff = score.staves[s];
      const i = M.eventAt(staff, st.input.t);
      if (i >= 0 && staff.events[i].tuplet) throw new Error("already in a tuplet");
      M.tupletAt(score, s, st.input.t, inputTicks(), n);
    });
  }

  function duration(base, dots) {
    st.input.base = base;
    st.input.dots = dots;
    if (st.input.on || !range()) return draw();
    edit((score) => {
      const t = need();
      const start = M.starts(score.staves[t.s])[t.i];
      M.setDuration(score, t.s, t.i, base, dots);
      keepOn(t.s, start);
    });
  }

  function toggleDot() {
    if (st.input.on || !range()) {
      st.input.dots = st.input.dots ? 0 : 1;
      return draw();
    }
    const t = target();
    const ev = st.score.staves[t.s].events[t.i];
    duration(ev.base, ev.dots ? 0 : 1);
  }

  function step(by, extend) {
    if (!st.score) return;
    if (st.input.on) {
      const staff = st.score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t <= st.input.t);
      const next = Math.max(0, Math.min(at.length - 1, i + by));
      st.input.t = at[next];
      st.input.last = null;
      // The selection comes along: what acts on the selected notes (a mark,
      // a slur) acts on the one at the cursor, not one left from before (#429).
      st.sel = { staff: st.input.staff, t0: at[next], t1: at[next], head: -1 };
      return draw();
    }
    const r = range();
    if (!r) return select(0, 0);
    const edge = extend ? M.starts(r.staff).indexOf(st.sel.t1) : by > 0 ? r.b : r.a;
    const next = Math.max(0, Math.min(r.staff.events.length - 1, edge + by));
    select(r.s, next, -1, extend);
  }

  function chordHead(by) {
    const t = target();
    if (!t) return;
    const ev = st.score.staves[t.s].events[t.i];
    if (ev.pitches.length < 2) return;
    const head = st.sel?.head ?? -1;
    const next = head < 0 ? (by > 0 ? ev.pitches.length - 1 : 0) : Math.max(0, Math.min(ev.pitches.length - 1, head + by));
    st.sel = { ...st.sel, head: next };
    draw();
  }

  /** The cursor or the selection moved to voice `voice` (1 to 4) of its staff, at the same time; the voice made when needed. */
  function toVoice(voice) {
    if (!st.score) return;
    const s = staffOf();
    const upper = M.upperOf(st.score, s);
    let lane = M.laneOfVoice(st.score, upper, voice);
    if (lane < 0) {
      // Voices of rests (voice 3 brings voice 2): nothing in the text changes, so no step to undo.
      const had = M.voiceLanes(st.score, upper).length;
      try {
        lane = M.addVoice(st.score, upper, voice);
      } catch (error) {
        return say(error.message ?? String(error), true);
      }
      const added = M.voiceLanes(st.score, upper).length - had;
      if (st.input.on && st.input.staff >= upper + had) st.input.staff += added;
    }
    if (st.input.on) {
      st.input.staff = lane;
      st.input.last = null;
    } else if (st.sel) {
      const at = M.starts(st.score.staves[lane]);
      const t = Math.min(st.sel.t0, st.sel.t1);
      const start = Math.max(...at.filter((x) => x <= t));
      st.sel = { staff: lane, t0: start, t1: start, head: -1 };
    } else {
      st.sel = { staff: lane, t0: 0, t1: 0, head: -1 };
    }
    // A \\partCombine staff's voices are its parts.
    if (M.isCombined(st.score, lane)) say(voice === 1 ? "Part I: its notes are drawn with part II's, stems up where they part" : "Part II: its notes are drawn with part I's, stems down where they part");
    else say(VOICE_SAID[voice] ?? "Voice 1");
    draw();
  }

  const VOICE_SAID = {
    2: "Voice 2: notes written now go under voice 1, stems down",
    3: "Voice 3: notes written now go beside voice 1, stems up",
    4: "Voice 4: notes written now go beside voice 2, stems down",
  };

  return { inputTicks, setInput, inputWrite, inputBack, inputTuplet, duration, toggleDot, step, chordHead, toVoice };
}
