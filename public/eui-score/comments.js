// Comments on a score (#385): threads anchored to a staff and some of its
// bars, with replies, resolved and reopened, each message edited or deleted
// by its author. The app's editor shows them in a panel beside the score
// (app/views/app/scores/show.html.slv), the read page under it
// (app/views/shared_scores/show.html.slv); both talk to the same JSON
// endpoints (AppCommentsController).
//
// A thread, as the server sends it: { id, lane, bars: [first, last] (from
// 0), label ("Bars 3–5, Piano", said when it was started), resolved,
// resolved_by, created_at, updated_at, messages: [{ id, author_id, author,
// body, created_at, edited_at }], detached }. Anchors follow their bars and
// their staff (#392): each save moves them on the server (ScoreThread.follow)
// and the moved threads come back as news; a thread whose bars or staff were
// all taken away is kept, `detached` ("bars" or "staff"), and says so.
//
// Typing @ in a comment box lists the score's people (#392: its owner and
// those it is shared with, from `options.people`), filtered as one types,
// chosen with the arrow keys and Enter or Tab, or the mouse.
//
// The pure part (sorting, which to show, the bubbles, merging the room's
// news) is exported for tests/js/comments.test.mjs; `startComments` draws
// the panel.

/** Open threads first, each group the latest first. */
export function sortThreads(threads) {
  return [...threads].sort((a, b) => Number(a.resolved) - Number(b.resolved) || (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

/** The threads the panel lists: the open ones, and the resolved ones too when asked. */
export function visibleThreads(threads, showResolved) {
  return sortThreads(threads.filter((thread) => showResolved || !thread.resolved));
}

/** The bubbles over the score: one per open thread still on its bars, at its first bar, with how many messages it has. */
export function markersOf(threads) {
  return threads.filter((thread) => !thread.resolved && !thread.detached).map((thread) => ({ id: thread.id, lane: thread.lane, bars: thread.bars, count: thread.messages.length, label: thread.label }));
}

/** `threads` with `news` (a thread as the room sends it, several moved by a save, or { gone: id }) taken in. */
export function takeNews(threads, news) {
  if (Array.isArray(news?.threads)) return news.threads.reduce((list, thread) => takeNews(list, { thread }), threads);
  if (news?.gone) return threads.filter((thread) => thread.id !== news.gone);
  if (!news?.thread?.id) return threads;
  const others = threads.filter((thread) => thread.id !== news.thread.id);
  return [...others, news.thread];
}

/** "Bars 3–5": a place's bars, counted from 1, when the editor cannot name them better. */
export function barsLabel(bars) {
  const [a, b] = bars;
  return a === b ? `Bar ${a + 1}` : `Bars ${a + 1}–${b + 1}`;
}

/** What a detached thread says of its place. */
export function detachedSaid(thread) {
  if (thread.detached === "staff") return "Its staff was removed";
  if (thread.detached === "bars") return "Its bars were removed";
  return "";
}

/**
 * The @ being typed at `caret` in `text`: `{ start, query }` (`start` where
 * the @ is), or null when the word before the caret is not one.
 */
export function mentionAt(text, caret) {
  const before = text.slice(0, caret);
  const found = before.match(/(^|\s)@([^\s@]*(?:@[^\s@]*)?)$/);
  if (!found) return null;
  return { start: before.length - found[2].length - 1, query: found[2] };
}

/** The people `query` may name (in their name or address, the starts first), at most `most`. */
export function peopleFor(people, query, most = 8) {
  const q = query.toLowerCase();
  const score = (person) => {
    const words = [person.name ?? "", person.email ?? ""].map((w) => w.toLowerCase());
    if (words.some((w) => w.startsWith(q))) return 0;
    if (words.some((w) => w.split(/[\s.@_-]+/).some((part) => part.startsWith(q)))) return 1;
    if (words.some((w) => w.includes(q))) return 2;
    return 3;
  };
  return people
    .map((person) => [score(person), person])
    .filter(([rank]) => rank < 3)
    .sort((a, b) => a[0] - b[0])
    .slice(0, most)
    .map(([, person]) => person);
}

/** `text` with the @ being typed (`mention`) replaced by `person`'s address: `{ text, caret }`. */
export function withMention(text, caret, mention, person) {
  const word = `@${person.email} `;
  const after = text.slice(caret).replace(/^\S*/, "");
  const out = text.slice(0, mention.start) + word + after.replace(/^ /, "");
  return { text: out, caret: mention.start + word.length };
}

/** When, said shortly: "just now", "5 min ago", "3 h ago", or the date. */
export function whenSaid(seconds, now = Date.now() / 1000) {
  const ago = Math.max(0, now - seconds);
  if (ago < 60) return "just now";
  if (ago < 3600) return `${Math.floor(ago / 60)} min ago`;
  if (ago < 86400) return `${Math.floor(ago / 3600)} h ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((child) => child != null));
  return node;
};

/**
 * The comments panel in `panel` (an element of its own, emptied).
 *
 * options:
 * - `url`: the score's comments endpoint (/app/scores/:id/comments).
 * - `me`: the signed-in person's key: their own messages get Edit and Delete.
 * - `origin`: this page's id, sent with each change so the room's echo of it is skipped.
 * - `manual`: true where there is no selection to take (the read page): a new
 *   thread is placed with a staff number and bar numbers typed in.
 * - `onSelect(thread)`: a thread's place clicked (the editor selects its bars).
 * - `onThreads(threads)`: the list changed (the editor redraws its bubbles).
 * - `people`: where the score's people are listed (/app/scores/:id/people),
 *   for the @ list; without it, no list.
 *
 * Answers { refresh(), compose(place, label), take(news), open(id), threads() }.
 */
export function startComments(panel, options = {}) {
  let threads = [];
  let showResolved = false;
  let composing = null;
  let editing = null;
  let error = "";
  // What is being typed, by box ("new", "reply:<thread>", "edit:<message>"):
  // kept across redraws, so news from the room does not wipe a reply half written.
  const drafts = {};
  const draftBox = (key, props) => {
    const box = el("textarea", { ...props, value: drafts[key] ?? props.value ?? "" });
    box.dataset.draft = key;
    box.addEventListener("input", () => (drafts[key] = box.value));
    if (options.people) mentions(box, () => (drafts[key] = box.value));
    return box;
  };

  // ---- @ names: the score's people, listed as one types ----
  let people = null;
  const loadPeople = () => {
    people ??= fetch(options.people, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : { people: [] }))
      .then((answer) => (answer.people ?? []).filter((person) => person.key !== options.me))
      .catch(() => {
        people = null;
        return [];
      });
    return people;
  };
  let listCount = 0;
  /** `box` given the @ list: shown under it while an @ is typed. */
  function mentions(box, changed) {
    const list = el("ul", { className: "comment-mentions", hidden: true });
    list.id = `comment-mentions-${++listCount}`;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "People of the score");
    box.setAttribute("aria-autocomplete", "list");
    box.setAttribute("aria-controls", list.id);
    box.setAttribute("aria-expanded", "false");
    let shown = [];
    let active = 0;
    let at = null;
    const close = () => {
      list.hidden = true;
      shown = [];
      at = null;
      box.setAttribute("aria-expanded", "false");
      box.removeAttribute("aria-activedescendant");
    };
    const pick = (person) => {
      const next = withMention(box.value, box.selectionStart, at, person);
      box.value = next.text;
      box.setSelectionRange(next.caret, next.caret);
      changed();
      close();
      box.focus();
    };
    const paint = () => {
      list.replaceChildren(...shown.map((person, k) => {
        const item = el("li", { id: `${list.id}-${k}`, className: k === active ? "active" : "" }, el("strong", { textContent: person.name || person.email }), person.name ? el("span", { textContent: person.email }) : null);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(k === active));
        item.dataset.mention = person.email;
        // Chosen on the press, before the box loses its focus.
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(person);
        });
        return item;
      }));
      list.hidden = !shown.length;
      box.setAttribute("aria-expanded", String(shown.length > 0));
      if (shown.length) box.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    };
    const look = async () => {
      const mention = mentionAt(box.value, box.selectionStart);
      if (!mention) return close();
      const everyone = await loadPeople();
      // Typed on since: the latest look decides.
      if (mentionAt(box.value, box.selectionStart)?.start !== mention.start) return;
      at = mention;
      shown = peopleFor(everyone, mention.query);
      active = Math.min(active, Math.max(0, shown.length - 1));
      paint();
    };
    box.addEventListener("input", () => {
      active = 0;
      look();
    });
    box.addEventListener("keydown", (event) => {
      if (list.hidden || !shown.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        paint();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(shown[active]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    box.addEventListener("blur", () => setTimeout(close, 150));
    // In the page once the box is: right after it.
    queueMicrotask(() => box.after(list));
  }

  const send = async (path, method, body) => {
    const response = await fetch(`${options.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify({ ...body, origin: options.origin }) : undefined,
    });
    const json = (response.headers.get("Content-Type") || "").includes("application/json");
    const answer = json ? await response.json() : {};
    if (!response.ok || !json) throw new Error(answer.error ?? (response.status === 403 ? "You may not do that on this score." : "Not sent: check your connection and try again."));
    return answer;
  };

  const changed = () => {
    options.onThreads?.(threads);
    draw();
  };

  const run = async (work) => {
    error = "";
    try {
      const answer = await work();
      if (answer?.thread) threads = takeNews(threads, { thread: answer.thread });
      if (answer?.gone) threads = takeNews(threads, { gone: answer.gone });
      changed();
      return true;
    } catch (problem) {
      error = problem.message;
      draw();
      return false;
    }
  };

  async function refresh() {
    try {
      const answer = await send("", "GET");
      threads = answer.threads ?? [];
      error = "";
    } catch (problem) {
      error = problem.message;
    }
    changed();
  }

  function compose(place, label) {
    if (!options.manual && !place) {
      error = "Select some bars or a note first: the comment goes on them.";
      composing = null;
      draw();
      return;
    }
    composing = { place, label: label || (place ? barsLabel(place.bars) : "") };
    error = "";
    draw();
    panel.querySelector("[data-comment-new] textarea")?.focus();
  }

  function take(news) {
    threads = takeNews(threads, news);
    changed();
  }

  function open(id) {
    const card = panel.querySelector(`[data-thread="${CSS.escape(id)}"]`);
    if (!card && threads.some((thread) => thread.id === id && thread.resolved)) {
      showResolved = true;
      draw();
      return open(id);
    }
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.classList.add("comment-flash");
    setTimeout(() => card.classList.remove("comment-flash"), 1500);
  }

  function newThreadForm() {
    const body = draftBox("new", { rows: 3, maxLength: 5000, placeholder: "Your comment. @name or @e-mail tells someone of the score." });
    body.setAttribute("aria-label", "Your comment");
    const fields = [];
    let manual = null;
    if (options.manual) {
      const number = (label, value) => el("label", { className: "comment-number" }, label, el("input", { type: "number", min: 1, max: 9999, value, required: true }));
      manual = { staff: number("Staff", 1), from: number("Bars", 1), to: number("to", 1) };
      fields.push(el("div", { className: "comment-place-fields" }, manual.staff, manual.from, manual.to));
    } else {
      fields.push(el("p", { className: "comment-place" }, "On ", el("strong", { textContent: composing.label })));
    }
    const form = el("form", { className: "comment-form" }, ...fields, body, el("div", { className: "comment-form-actions" }, el("button", { type: "submit", className: "btn btn-primary", textContent: "Comment" }), el("button", { type: "button", className: "btn btn-ghost", textContent: "Cancel", onclick: () => ((composing = null), draw()) })));
    form.dataset.commentNew = "";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      let place = composing.place;
      let label = composing.label;
      if (manual) {
        const value = (field) => Number(field.querySelector("input").value) - 1;
        const [a, b] = [value(manual.from), Math.max(value(manual.from), value(manual.to))];
        place = { lane: value(manual.staff), bars: [a, b] };
        label = `${barsLabel([a, b])}, staff ${place.lane + 1}`;
      }
      const sent = await run(() => send("", "POST", { lane: place.lane, bars: place.bars, label, body: body.value }));
      if (sent) {
        composing = null;
        delete drafts.new;
      }
      draw();
    });
    return form;
  }

  function messageView(thread, message) {
    const mine = message.author_id === options.me;
    const head = el("div", { className: "comment-head" }, el("strong", { textContent: message.author || "Someone" }), el("time", { textContent: whenSaid(message.created_at) + (message.edited_at ? " · edited" : "") }));
    if (editing === message.id) {
      const box = draftBox(`edit:${message.id}`, { rows: 3, maxLength: 5000, value: message.body });
      box.setAttribute("aria-label", "Your message");
      const form = el("form", { className: "comment-form" }, box, el("div", { className: "comment-form-actions" }, el("button", { type: "submit", className: "btn btn-primary", textContent: "Save" }), el("button", { type: "button", className: "btn btn-ghost", textContent: "Cancel", onclick: () => ((editing = null), delete drafts[`edit:${message.id}`], draw()) })));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (await run(() => send(`/${thread.id}/messages/${message.id}`, "PUT", { body: box.value }))) {
          editing = null;
          delete drafts[`edit:${message.id}`];
        }
        draw();
      });
      return el("div", { className: "comment-message" }, head, form);
    }
    const tools = mine
      ? el(
          "div",
          { className: "comment-tools" },
          el("button", { type: "button", textContent: "Edit", onclick: () => ((editing = message.id), draw()) }),
          el("button", {
            type: "button",
            textContent: "Delete",
            onclick: () => confirm("Delete this message?") && run(() => send(`/${thread.id}/messages/${message.id}`, "DELETE", {})),
          }),
        )
      : null;
    const node = el("div", { className: "comment-message" }, head, el("p", { className: "comment-body", textContent: message.body }), tools);
    node.dataset.message = message.id;
    return node;
  }

  function threadView(thread) {
    const place = el("button", { type: "button", className: `comment-anchor${thread.detached ? " comment-detached" : ""}`, textContent: thread.label || barsLabel(thread.bars), title: thread.detached ? detachedSaid(thread) : options.onSelect ? "Select these bars" : "" });
    if (thread.detached) place.disabled = true;
    else place.addEventListener("click", () => options.onSelect?.(thread));
    const state = thread.resolved
      ? el("button", { type: "button", className: "comment-state", textContent: "Reopen", onclick: () => run(() => send(`/${thread.id}/reopen`, "POST", {})) })
      : el("button", { type: "button", className: "comment-state", textContent: "Resolve", onclick: () => run(() => send(`/${thread.id}/resolve`, "POST", {})) });
    const reply = draftBox(`reply:${thread.id}`, { rows: 1, maxLength: 5000, placeholder: "Reply…" });
    reply.setAttribute("aria-label", "Reply");
    const form = el("form", { className: "comment-reply" }, reply, el("button", { type: "submit", className: "btn btn-ghost", textContent: "Reply" }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = reply.value;
      delete drafts[`reply:${thread.id}`];
      if (!(await run(() => send(`/${thread.id}/replies`, "POST", { body: text })))) {
        drafts[`reply:${thread.id}`] = text;
        draw();
      }
    });
    const card = el(
      "article",
      { className: `comment-thread${thread.resolved ? " comment-resolved" : ""}` },
      el("header", { className: "comment-thread-head" }, place, state),
      thread.detached ? el("p", { className: "comment-detached-note", textContent: `${detachedSaid(thread)} from the score: the comment stays here.` }) : null,
      thread.resolved ? el("p", { className: "comment-resolved-by", textContent: `Resolved${thread.resolved_by ? ` by ${thread.resolved_by}` : ""}` }) : null,
      ...thread.messages.map((message) => messageView(thread, message)),
      thread.resolved ? null : form,
    );
    card.dataset.thread = thread.id;
    card.id = `thread-${thread.id}`;
    return card;
  }

  function draw() {
    // The box being typed in keeps the focus, and its caret, through the redraw.
    const typing = panel.contains(document.activeElement) ? document.activeElement.dataset?.draft : null;
    const caret = typing ? document.activeElement.selectionStart : 0;
    redraw();
    const box = typing ? panel.querySelector(`[data-draft="${CSS.escape(typing)}"]`) : null;
    if (box) {
      box.focus();
      box.setSelectionRange(caret, caret);
    }
  }

  function redraw() {
    const resolved = threads.filter((thread) => thread.resolved).length;
    const shown = visibleThreads(threads, showResolved);
    const toggle = el("label", { className: "comment-toggle" }, el("input", { type: "checkbox", checked: showResolved, onchange: (event) => ((showResolved = event.target.checked), draw()) }), ` Show resolved (${resolved})`);
    const list = el("div", { className: "comment-list" }, ...shown.map(threadView));
    const empty = shown.length ? null : el("p", { className: "muted comment-empty", textContent: options.manual ? "No comments yet." : "No comments yet. Select some bars, then Edit › Comment on the selection." });
    const startButton = options.manual && !composing ? el("button", { type: "button", className: "btn btn-ghost comment-start", textContent: "New comment", onclick: () => compose(null) }) : null;
    const parts = [
      el("div", { className: "comment-panel-head" }, toggle, startButton),
      error ? el("p", { className: "form-error comment-error", role: "alert", textContent: error }) : null,
      composing ? newThreadForm() : null,
      list,
      empty,
    ];
    panel.replaceChildren(...parts.filter((part) => part != null));
  }

  draw();
  return { refresh, compose, take, open, threads: () => threads };
}
