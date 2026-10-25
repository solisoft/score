// The studio's pen and ghost note (studio.js, #398): in note input, the
// pointer over the staves is a pen, and a pale note shows what a click
// would write there — the staff's line or space under it, the column it is
// over — which the click then writes, as typing its letter would.
//
// The ghost has its own layer over the drawing: moving the pointer places
// it again, once per frame at most, and never draws the score again.

const V = new URL(import.meta.url).search;
const Gh = await import(`./ghost.js${V}`);

/** Answers the ghost: where a click in note input writes (`ghostAt`), writing there (`writeAtGhost`), and placing it (`placeGhost`). */
export function install(ctx) {
  const { sheet, st, M } = ctx;
  const { geometry, inputWrite } = ctx.call;

  const ghost = Object.assign(document.createElement("div"), { className: "studio-ghost", hidden: true });
  ghost.setAttribute("aria-hidden", "true");
  sheet.appendChild(ghost);

  // The pointer's last place over the sheet, or null once it has left.
  let pointer = null;
  let frame = 0;

  /** Whether the ghost and the pen are offered now. */
  const offered = () => Boolean(st.input.on && st.score && st.view && st.mode !== "midi" && !st.written);

  /** The drawn items by lane and index, for the view drawn now. */
  let drawn = { view: null, at: new Map() };
  function itemOf(lane, index) {
    if (drawn.view !== st.view) {
      const at = new Map();
      for (const it of st.view.items) {
        const where = st.items[it.item];
        if (where) at.set(`${where.staff}:${where.index}`, it);
      }
      drawn = { view: st.view, at };
    }
    return drawn.at.get(`${lane}:${index}`);
  }

  /** The bar under a point of the drawing, with its staves' area padded by a few spaces. */
  function barUnder(p, space) {
    for (const b of st.view.bars ?? []) {
      const [x0, , x1] = b.box;
      if (p.x < x0 - 2 || p.x > x1 + 4 || !b.staves?.length) continue;
      const top = Math.min(...b.staves) - 4.5 * space;
      const bottom = Math.max(...b.staves) + 8.5 * space;
      if (p.y >= top && p.y <= bottom) return b;
    }
    return null;
  }

  /**
   * What a click at client point (x, y) writes: { lane, t, pitch, drum,
   * step, top, space, x, name } in the drawing's units, or null over no
   * staff or a place that takes no note. `over`: the pointer is over the
   * staves at all (the pen shows), even where no note goes.
   */
  function spotAt(clientX, clientY) {
    const g = geometry();
    if (!g || !offered()) return { over: false, spot: null };
    const p = { x: (clientX - g.rect.left) / g.scale, y: (clientY - g.rect.top) / g.scale + (st.view.y0 ?? 0) };
    const space = 8 * st.zoom;
    const bar = barUnder(p, space);
    if (!bar) return { over: false, spot: null };
    // The staff nearest the pointer: its five lines, or the ledger lines around them.
    const lanes = M.staffLanes(st.score);
    let k = 0;
    const away = (top) => Math.max(top - p.y, 0, p.y - (top + 4 * space));
    bar.staves.forEach((top, i) => {
      if (away(top) < away(bar.staves[k])) k = i;
    });
    const upper = lanes[Math.min(k, lanes.length - 1)];
    const top = bar.staves[k];
    const staff = st.score.staves[upper];
    // A tablature's lines are strings, not pitches: the pen does not write there.
    if (upper == null || !staff || M.isChords(st.score, upper) || M.isFigures(st.score, upper) || M.isTab(st.score, upper)) return { over: true, spot: null };
    const step = Gh.stepAt(p.y, top, space);
    if (step < -8 || step > 16) return { over: true, spot: null };
    // The voice the cursor writes in, on its own staff; else the staff's first.
    const lane = M.upperOf(st.score, st.input.staff) === upper ? st.input.staff : upper;
    const t = timeAt(lane, bar, p.x, space);
    if (t == null) return { over: true, spot: null };
    const b = M.barAt(st.score, t);
    const drums = M.isDrums(st.score, upper);
    const clef = drums ? "percussion" : M.clefAt(st.score, upper, b, t - M.barStart(st.score, b));
    const pitch = Gh.pitchAt(clef, step, drums ? 0 : M.keyOf(st.score, upper, t));
    const drum = drums ? Gh.drumAt(pitch.d, M.DRUMS) : null;
    if (drums ? !drum : !Gh.reachable(pitch)) return { over: true, spot: null };
    return { over: true, spot: { lane, t, pitch, drum, step, top, space, x: xOf(lane, bar, t, space), name: drum ?? Gh.nameOf(pitch) } };
  }

  /** The lane's events in a bar, each where it is drawn (spread over the bar by time when it is not drawn). */
  function spansOf(lane, bar) {
    const staff = st.score.staves[lane];
    const origin = M.barStart(st.score, bar.bar);
    const end = M.barStart(st.score, bar.bar + 1);
    const [x0, , x1] = bar.box;
    const byTime = (t) => x0 + space0() + ((t - origin) / (end - origin)) * (x1 - x0 - space0());
    const at = M.starts(staff);
    const spans = [];
    staff.events.forEach((ev, i) => {
      if (at[i] < origin || at[i] >= end) return;
      const ticks = M.ticksOf(ev);
      const item = itemOf(lane, i);
      // A bar's rest is drawn in its middle: it starts at the bar's start all the same.
      const x = !item || (ev.rest && ticks >= end - origin) ? byTime(at[i]) : item.box[0];
      spans.push({ t: at[i], ticks, x, rest: ev.rest, tuplet: Boolean(ev.tuplet) });
    });
    // Whatever is left of the first event is the first event's.
    if (spans.length) spans[0] = { ...spans[0], x: Math.min(spans[0].x, x0) };
    return { spans, origin, end, right: x1 };
  }
  const space0 = () => 8 * st.zoom;

  function timeAt(lane, bar, x, space) {
    const { spans, origin, right } = spansOf(lane, bar);
    // A pointer just left of a head is over that head.
    return Gh.snapTime(spans, x, right, origin, M.notated(st.input.base, st.input.dots), 0.6 * space);
  }

  /** Where the ghost's head is drawn for time `t`: the event's own head, else as far along its event as `t` is. */
  function xOf(lane, bar, t, space) {
    const staff = st.score.staves[lane];
    const at = M.starts(staff);
    const i = at.indexOf(t);
    const item = i >= 0 ? itemOf(lane, i) : null;
    const ev = i >= 0 ? staff.events[i] : null;
    const whole = ev && ev.rest && M.ticksOf(ev) >= M.barStart(st.score, bar.bar + 1) - M.barStart(st.score, bar.bar);
    const head = item?.heads?.[0]?.box ?? item?.box;
    if (head && !whole) return head[0] + 0.65 * space;
    const { spans, right } = spansOf(lane, bar);
    const k = spans.findLastIndex((span) => span.t <= t);
    const span = spans[k];
    const next = k + 1 < spans.length ? spans[k + 1].x : right;
    const from = k === 0 ? Math.max(span.x, bar.box[0] + space) : span.x;
    return from + ((t - span.t) / span.ticks) * Math.max(0, next - from) + 0.65 * space;
  }

  function hide() {
    ghost.hidden = true;
    ghost.innerHTML = "";
    for (const key of ["pitch", "lane", "t", "drum"]) delete ghost.dataset[key];
  }

  /** The pen and the ghost placed for the pointer where it last was. */
  function placeGhost() {
    frame = 0;
    const { over, spot } = pointer && !pointer.shift ? spotAt(pointer.x, pointer.y) : { over: Boolean(pointer) && offered(), spot: null };
    sheet.classList.toggle("studio-pen", Boolean(offered() && over));
    if (!spot) return hide();
    const g = geometry();
    const centre = g.at(spot.x, Gh.yOfStep(spot.step, spot.top, spot.space));
    const sp = spot.space * g.scale;
    const alter = spot.drum ? 0 : spot.pitch.alter;
    const key = [spot.step, st.input.base, st.input.dots, alter, Math.round(sp * 100)].join(":");
    if (ghost.dataset.key !== key) {
      ghost.innerHTML = Gh.ghostSvg({ step: spot.step, base: st.input.base, dots: st.input.dots, alter, sp });
      ghost.dataset.key = key;
    }
    ghost.style.left = `${centre.x}px`;
    ghost.style.top = `${centre.y}px`;
    Object.assign(ghost.dataset, { pitch: spot.name, lane: String(spot.lane), t: String(spot.t) });
    if (spot.drum) ghost.dataset.drum = spot.drum;
    else delete ghost.dataset.drum;
    ghost.hidden = false;
  }

  /** Placed again at the next frame, once however often the pointer moves. */
  function schedule() {
    if (!frame) frame = requestAnimationFrame(placeGhost);
  }

  sheet.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    if (offered() || !ghost.hidden || sheet.classList.contains("studio-pen")) schedule();
  });
  sheet.addEventListener("pointerleave", () => {
    pointer = null;
    schedule();
  });
  // The sheet scrolled under a still pointer: the ghost follows the drawing.
  sheet.addEventListener("scroll", () => pointer && schedule(), { passive: true });

  /** What a click at this pointer event writes, or null. */
  function ghostAt(event) {
    return spotAt(event.clientX, event.clientY).spot;
  }

  /** The note written where the ghost is: the cursor put there, then written as its letter would be — one step to undo. */
  function writeAtGhost(spot) {
    st.input.staff = spot.lane;
    st.input.t = spot.t;
    st.input.last = null;
    return inputWrite(spot.drum ?? { key: Gh.midiOf(spot.pitch) });
  }

  return { ghostAt, writeAtGhost, placeGhost };
}
