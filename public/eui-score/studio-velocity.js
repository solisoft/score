// The studio's velocities (studio.js, velocity.js): the strip under the MIDI
// view's roll, and the automation lane under it (automation-ui.js).

/** The velocity strip and the automation lane put under the roll. */
export function install(ctx) {
  const { rollHost, rollScroll, st, R, Vel, automationLane } = ctx;
  const { edit, drawRoll, say, engraved, recordingNow } = ctx.call;

  // ---- Velocity, under the roll (velocity.js) -------------------------------------
  //
  // A bar per note, as tall as it is played: drawn across with the mouse,
  // or chosen (a click, Shift for more, Shift-drag for a stretch) and
  // dragged together. A note with none set plays as its dynamics, drawn pale.

  st.velSel = new Set();
  st.velDrag = null;
  st.velHeard = { text: null, map: {} };
  const velBar = (st.velBar = Object.assign(document.createElement("div"), { className: "studio-velocity-bar" }));
  velBar.setAttribute("role", "toolbar");
  velBar.setAttribute("aria-label", "Velocity");
  velBar.innerHTML = `<span class="studio-velocity-what" data-vel-what></span><span class="studio-velocity-fixed"><button type="button" class="studio-menu" data-vel-act="fixed">Fixed velocity</button><input type="number" min="1" max="127" value="96" data-vel-value aria-label="The fixed velocity, 1 to 127"></span><button type="button" class="studio-menu" data-vel-act="soften">Soften</button><button type="button" class="studio-menu" data-vel-act="accent">Accent the beats</button><button type="button" class="studio-menu" data-vel-act="clear">As the dynamics</button><span class="studio-roll-hint">Drag across the bars to draw; click one to choose it, Shift for more; drag a chosen one to move them all.</span>`;
  rollHost.append(velBar);

  // The automation lane (automation-ui.js), under the velocity strip.
  st.automation = automationLane({ rollHost, rollScroll, st, edit, say, redraw: () => drawRoll(), recordingNow, learnt: () => ctx.sync?.learnt?.list() ?? [] });

  /** The velocities the dynamics give, as the MIDI plays them: found once per text, then drawn. */
  function heardVelocities() {
    const score = st.score;
    const text = st.text;
    if (st.velHeard.text !== text) {
      st.velHeard.text = text;
      engraved(score)
        .then((bytes) => {
          if (st.text !== text) return;
          st.velHeard = { text, map: Vel.heardVelocities(score, bytes) };
          drawRoll();
        })
        .catch(() => {});
    }
    return st.velHeard.map;
  }

  /** The strip under the roll, as HTML; a drag's velocities shown before they are kept. */
  function velocityStrip() {
    // Not yet: the studio is still being set up.
    if (!st.velBar) return "";
    st.velGeo = R.rollLayout(st.score, { layout: st.rollLayout, zoom: st.zoom, only: st.rollLayout === "keys" ? st.rollOnly : null });
    const set = { ...Vel.velocitiesOf(st.score), ...(st.velDrag?.changes ?? {}) };
    const what = st.velBar.querySelector("[data-vel-what]");
    what.textContent = st.velSel.size ? `${st.velSel.size} chosen` : "All the notes";
    return `<div class="studio-velocity">${Vel.drawStrip(st.score, st.velGeo, { set, heard: heardVelocities(), selected: st.velSel })}</div>`;
  }

  /** The strip's bars as they are drawn. */
  function velBars() {
    return Vel.stripBars(st.score, st.velGeo, Vel.velocitiesOf(st.score), st.velHeard.map);
  }

  function velPoint(event) {
    const box = rollScroll.querySelector(".vel-strip").getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** Velocities changed: kept, one Undo away. */
  function velCommit(changes, words) {
    const n = Object.keys(changes).length;
    if (!n) return say("No note there.");
    if (edit((score) => Vel.setVelocities(score, changes))) say(`${words}: ${n === 1 ? "1 note" : `${n} notes`}. Ctrl+Z takes it back.`);
  }

  rollHost.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".vel-strip") || !st.score) return;
    rollHost.focus({ preventScroll: true });
    const p = velPoint(event);
    const bars = velBars();
    const hit = Vel.barAtX(bars, p.x);
    const more = event.shiftKey || event.metaKey || event.ctrlKey;
    if (hit && more) {
      if (st.velSel.has(hit.id)) st.velSel.delete(hit.id);
      else st.velSel.add(hit.id);
      return drawRoll();
    }
    // On a chosen bar: they all move together. Elsewhere: a drag draws, a click chooses (or lets go).
    if (hit && st.velSel.has(hit.id)) {
      const start = Object.fromEntries(bars.filter((b) => st.velSel.has(b.id)).map((b) => [b.id, b.v]));
      st.velDrag = { mode: "move", y: p.y, start, changes: {} };
    } else if (more) {
      st.velDrag = { mode: "band", x: p.x, changes: {} };
    } else st.velDrag = { mode: "draw", x: p.x, y: p.y, changes: {}, pick: hit?.id ?? null, moved: false };
    rollHost.setPointerCapture?.(event.pointerId);
    drawRoll();
  });

  /** Drawing: the bars between the pointer's last place and this one, at the heights along the line. */
  function velPaint(bars, p) {
    const d = st.velDrag;
    const [x0, x1] = [Math.min(d.x, p.x) - 5, Math.max(d.x, p.x) + 5];
    for (const b of bars) {
      if (b.x < x0 || b.x > x1) continue;
      const y = d.x === p.x ? p.y : d.y + ((b.x - d.x) / (p.x - d.x)) * (p.y - d.y);
      d.changes[b.id] = Vel.velocityOfY(y);
    }
    Object.assign(d, { x: p.x, y: p.y });
  }

  rollHost.addEventListener("pointermove", (event) => {
    const d = st.velDrag;
    if (!d) return;
    const p = velPoint(event);
    if (d.mode === "move") {
      const by = Vel.velocityOfY(Vel.yOfVelocity(64) + p.y - d.y) - 64;
      d.changes = Object.fromEntries(Object.entries(d.start).map(([id, v]) => [id, Math.max(1, Math.min(127, v + by))]));
    } else if (d.mode === "draw") {
      d.moved = true;
      velPaint(velBars(), p);
    }
    else {
      const [x0, x1] = [Math.min(d.x, p.x), Math.max(d.x, p.x)];
      st.velSel = new Set(velBars().filter((b) => b.x >= x0 && b.x <= x1).map((b) => b.id));
    }
    drawRoll();
  });

  const endVelDrag = () => {
    const d = st.velDrag;
    if (!d) return;
    st.velDrag = null;
    // A click, not a drag: the bar under it chosen, or none.
    if (d.mode === "draw" && !d.moved) {
      st.velSel = d.pick ? new Set([d.pick]) : new Set();
      return drawRoll();
    }
    const changed = Object.entries(d.changes).filter(([id, v]) => v !== d.start?.[id]);
    if (changed.length) velCommit(Object.fromEntries(changed), d.mode === "draw" ? "Velocity drawn" : "Velocity changed");
    else drawRoll();
  };
  rollHost.addEventListener("pointerup", endVelDrag);
  rollHost.addEventListener("pointercancel", endVelDrag);

  velBar.addEventListener("click", (event) => {
    const act = event.target.closest("[data-vel-act]")?.dataset.velAct;
    if (!act || !st.score) return;
    // The notes chosen, or every note the roll shows.
    const ids = st.velSel.size ? [...st.velSel] : st.velGeo.notes.map((n) => Vel.noteId(n.lane, n.t0, n.key));
    const set = Vel.velocitiesOf(st.score);
    const value = Number(velBar.querySelector("[data-vel-value]").value) || 96;
    if (act === "fixed") return velCommit(Vel.fixed(ids, value), `Velocity ${Math.max(1, Math.min(127, Math.round(value)))}`);
    if (act === "soften") return velCommit(Vel.soften(ids, set, st.velHeard.map), "Softer");
    if (act === "accent") return velCommit(Vel.accentBeats(st.score, ids, set, st.velHeard.map), "The beats accented");
    if (act === "clear") return velCommit(Object.fromEntries(ids.filter((id) => set[id] != null).map((id) => [id, null])), "As the dynamics again");
  });

  return { velocityStrip };
}
