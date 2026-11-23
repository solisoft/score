// The studio's Review (studio.js, #1022): the score read over by review.js
// after each change, a moment after it — its remarks counted on a button of
// the status bar, listed in a panel by rule. A remark clicked selects its
// note (or its bar); "Ignore" sets it aside on the score's settings line,
// one Undo away, kept with the score and for whoever it is shared with;
// "Show ignored" lists those too, to bring one back.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
const R = await import(`./review.js${V}`);
const C = await import(`./cues.js${V}`);

/** How long after a change the score is read over: typing goes on undisturbed. */
const AFTER = 400;

/** Answers the Review: opening it, reading the score over again. */
export function install(ctx) {
  const { root, st, M, overlay, palette } = ctx;
  const { edit, draw, say, instrumentName, barNo } = ctx.call;

  const panel = root.querySelector("[data-review]");
  const list = panel?.querySelector("[data-review-list]");
  const none = panel?.querySelector("[data-review-none]");
  const showIgnored = panel?.querySelector("[data-review-ignored]");
  const counter = root.querySelector("[data-review-count]");
  let remarks = [];
  let readFor = null;
  let timer = 0;

  /** A staff's name as the page says it: its own, its instrument's in the page's language, or its number. */
  function nameOf(lane) {
    const staff = st.score.staves[lane];
    const known = M.INSTRUMENTS[M.instrumentOf(st.score, lane)]?.name;
    return staff.name || (known ? instrumentName(known) : "") || tr("Staff {n}", { n: M.staffLanes(st.score).indexOf(lane) + 1 });
  }

  /** The score read over now, unless nothing it reads has changed since. */
  function reread() {
    clearTimeout(timer);
    if (!root.isConnected) return;
    const key = st.score ? `${st.text}\u0000${JSON.stringify(st.uneven ?? [])}` : null;
    if (key === readFor) return;
    readFor = key;
    remarks = st.score ? R.review(st.score, { uneven: st.uneven, name: nameOf }) : [];
    show();
  }

  /** Read over a moment after the last change. */
  function reviewSoon() {
    clearTimeout(timer);
    timer = setTimeout(reread, AFTER);
  }
  ctx.ends.push(() => clearTimeout(timer));

  /** The count on the status bar's button, and the panel's list when it is open. */
  function show() {
    const open = remarks.filter((remark) => !remark.ignored);
    if (counter) {
      counter.hidden = !open.length;
      counter.querySelector("[data-review-n]").textContent = String(open.length);
      counter.classList.toggle("studio-review-errors", open.some((remark) => remark.level === "error"));
      counter.title = tr("Review: {n} remarks", { n: open.length });
    }
    if (!panel || panel.hidden) return;
    const shown = showIgnored.checked ? remarks : open;
    none.hidden = shown.length > 0;
    none.textContent = st.score ? (remarks.length ? tr("Every remark is set aside: Show ignored lists them.") : tr("Nothing to say: the score reads well.")) : tr("The Review needs the score tools: this piece is edited in its text.");
    list.replaceChildren(...R.RULES.filter((rule) => shown.some((remark) => remark.rule === rule)).map((rule) => {
      const mine = shown.filter((remark) => remark.rule === rule);
      const section = document.createElement("section");
      section.className = "studio-review-rule";
      section.dataset.rule = rule;
      const heading = Object.assign(document.createElement("h3"), { textContent: `${R.ruleTitle(rule)} (${mine.length})` });
      const items = document.createElement("ul");
      items.append(...mine.map((remark) => {
        const item = document.createElement("li");
        item.className = `studio-review-${remark.level}${remark.ignored ? " studio-review-aside" : ""}`;
        const go = Object.assign(document.createElement("button"), { type: "button", className: "studio-review-go" });
        go.dataset.reviewGo = String(remarks.indexOf(remark));
        go.append(Object.assign(document.createElement("strong"), { textContent: tr("Bar {n}", { n: barNo(remark.bar) }) }), " ", remark.text);
        const aside = Object.assign(document.createElement("button"), { type: "button", className: "tool studio-review-ignore", textContent: remark.ignored ? tr("Show again") : tr("Ignore") });
        aside.dataset.reviewIgnore = String(remarks.indexOf(remark));
        item.append(go);
        // A cue proposed (#1023): Add writes it; one there: Remove cue.
        if (remark.cue && !remark.ignored) {
          const cue = Object.assign(document.createElement("button"), { type: "button", className: "tool studio-review-cue", textContent: remark.cue.cued ? tr("Remove cue") : tr("Add") });
          cue.dataset.reviewCue = String(remarks.indexOf(remark));
          item.append(cue);
        }
        item.append(aside);
        return item;
      }));
      section.append(heading, items);
      return section;
    }));
  }

  /** The panel opened (or closed): read over at once. */
  function toggleReview(open = panel?.hidden) {
    if (!panel) return;
    panel.hidden = !open;
    root.querySelector('[data-act="review"][aria-expanded]')?.setAttribute("aria-expanded", String(open));
    if (!open) return;
    readFor = null;
    reread();
    panel.scrollIntoView({ block: "nearest" });
  }

  /** A remark's note (or, for a bar, the bar) selected and brought into sight. */
  function goTo(remark) {
    if (!st.score?.staves[remark.lane]) return;
    st.input.on = false;
    const i = M.eventAt(st.score.staves[remark.lane], remark.t);
    if (remark.rule === "bars" || i < 0) {
      const bar = Math.min(M.barAt(st.score, remark.t), M.barsOf(st.score) - 1);
      ctx.call.selectPlace({ lane: remark.lane, bars: [bar, bar] });
      return;
    }
    st.sel = { staff: remark.lane, t0: remark.t, t1: remark.t, head: -1 };
    say(remark.text);
    draw().then(() => {
      const shown = palette.hidden ? overlay.querySelector(".studio-bar-selected") : palette;
      shown?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  /** A remark set aside, or shown again: an edit of the score, kept on its settings line. */
  function setAside(remark) {
    // What the text read wrote short or long stays said: setting a remark aside rewrites no bar.
    const uneven = st.uneven;
    const done = edit((score) => M.setReviewIgnored(score, remark.lane, remark.id, !remark.ignored));
    if (done) {
      st.uneven = uneven;
      say(remark.ignored ? tr("The remark is shown again.") : tr("The remark is set aside: Show ignored lists it."));
      reread();
    }
  }

  /** A cue proposed written, or one there taken away: one edit, one Undo (#1023). */
  function cueEdit(remark) {
    const { cue } = remark;
    const done = edit((score) => (cue.cued ? C.removeCue(score, cue.lane, cue.from, cue.to) : C.addCue(score, cue)));
    if (done === true) {
      say(cue.cued ? tr("The cue is taken away: one Undo brings it back.") : tr("The cue is written over the rests: one Undo takes it away."));
      reread();
    }
  }

  list?.addEventListener("click", (event) => {
    const go = event.target.closest("[data-review-go]");
    if (go) return goTo(remarks[Number(go.dataset.reviewGo)]);
    const cue = event.target.closest("[data-review-cue]");
    if (cue) return cueEdit(remarks[Number(cue.dataset.reviewCue)]);
    const aside = event.target.closest("[data-review-ignore]");
    if (aside) setAside(remarks[Number(aside.dataset.reviewIgnore)]);
  });
  showIgnored?.addEventListener("change", show);
  panel?.querySelector("[data-review-close]")?.addEventListener("click", () => toggleReview(false));

  // For a console or a test: the remarks as last read.
  st.review = () => remarks;

  return { reviewSoon, toggleReview };
}
