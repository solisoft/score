// Comments on a score (#385): which threads the panel lists and in what
// order, the bubbles over the score, the room's news taken in, and how
// bars and times are said.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortThreads, visibleThreads, markersOf, takeNews, barsLabel, whenSaid, detachedSaid, mentionAt, peopleFor, withMention } from "../../public/eui-score/comments.js";

const thread = (id, { resolved = false, updated = 0, lane = 0, bars = [0, 0], messages = 1 } = {}) => ({
  id,
  lane,
  bars,
  label: barsLabel(bars),
  resolved,
  updated_at: updated,
  messages: Array.from({ length: messages }, (_, k) => ({ id: `${id}-${k}`, body: "…" })),
});

test("comments: open threads first, the latest first; resolved ones only when asked", () => {
  const threads = [thread("old", { updated: 10 }), thread("done", { resolved: true, updated: 99 }), thread("new", { updated: 50 })];
  assert.deepEqual(sortThreads(threads).map((t) => t.id), ["new", "old", "done"]);
  assert.deepEqual(visibleThreads(threads, false).map((t) => t.id), ["new", "old"]);
  assert.deepEqual(visibleThreads(threads, true).map((t) => t.id), ["new", "old", "done"]);
  assert.deepEqual(threads.map((t) => t.id), ["old", "done", "new"], "the list given is left as it was");
});

test("comments: a bubble for each open thread, at its place, with how many messages", () => {
  const markers = markersOf([thread("a", { lane: 2, bars: [3, 5], messages: 3 }), thread("b", { resolved: true })]);
  assert.deepEqual(markers, [{ id: "a", lane: 2, bars: [3, 5], count: 3, label: "Bars 4–6" }]);
  assert.deepEqual(markersOf([]), []);
});

test("comments: the room's news replaces a thread, adds one, or takes one away", () => {
  const threads = [thread("a"), thread("b")];
  const changed = takeNews(threads, { thread: { ...thread("a"), resolved: true } });
  assert.equal(changed.length, 2);
  assert.equal(changed.find((t) => t.id === "a").resolved, true);
  assert.equal(takeNews(threads, { thread: thread("c") }).length, 3);
  assert.deepEqual(takeNews(threads, { gone: "a" }).map((t) => t.id), ["b"]);
  assert.equal(takeNews(threads, { event: "comments" }), threads, "news of nothing changes nothing");
  assert.equal(takeNews(threads, null), threads);
});

test("comments: bars counted from 1, and times said shortly", () => {
  assert.equal(barsLabel([0, 0]), "Bar 1");
  assert.equal(barsLabel([2, 4]), "Bars 3–5");
  const now = 1_800_000_000;
  assert.equal(whenSaid(now - 5, now), "just now");
  assert.equal(whenSaid(now - 300, now), "5 min ago");
  assert.equal(whenSaid(now - 7200, now), "2 h ago");
  assert.match(whenSaid(now - 86400 * 3, now), /\d/);
  assert.equal(whenSaid(now + 30, now), "just now", "a clock a little ahead is not the future");
});

test("comments (#392): threads moved by a save are taken in together; a detached one has no bubble and says why", () => {
  const threads = [thread("a", { bars: [1, 1] }), thread("b", { bars: [4, 5] })];
  const moved = takeNews(threads, { event: "comments", threads: [{ ...thread("a"), bars: [2, 2] }, { ...thread("b"), detached: "bars" }] });
  assert.deepEqual(moved.find((t) => t.id === "a").bars, [2, 2]);
  assert.equal(moved.length, 2);
  assert.deepEqual(markersOf(moved).map((m) => m.id), ["a"]);
  assert.equal(detachedSaid({ detached: "bars" }), "Its bars were removed");
  assert.equal(detachedSaid({ detached: "staff" }), "Its staff was removed");
  assert.equal(detachedSaid({}), "");
});

const PEOPLE = [
  { key: "1", name: "Ana Lopez", email: "ana@example.com" },
  { key: "2", name: "", email: "bob@band.org" },
  { key: "3", name: "Carla Ana", email: "carla@example.com" },
];

test("@ names (#392): the @ being typed is found before the caret, not inside an address", () => {
  assert.deepEqual(mentionAt("Hi @an", 6), { start: 3, query: "an" });
  assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionAt("Hi @ana@exa", 11), { start: 3, query: "ana@exa" });
  assert.equal(mentionAt("mail me@home", 12), null, "an @ inside a word is an address being typed");
  assert.equal(mentionAt("Hi @ana and", 11), null, "a space after it ends it");
  assert.equal(mentionAt("Hi there", 8), null);
});

test("@ names (#392): filtered by name or address, the starts first; none for what matches nobody", () => {
  assert.deepEqual(peopleFor(PEOPLE, "").map((p) => p.key), ["1", "2", "3"]);
  assert.deepEqual(peopleFor(PEOPLE, "ana").map((p) => p.key), ["1", "3"]);
  assert.deepEqual(peopleFor(PEOPLE, "BAND").map((p) => p.key), ["2"]);
  assert.deepEqual(peopleFor(PEOPLE, "ex").map((p) => p.key), ["1", "3"]);
  assert.deepEqual(peopleFor(PEOPLE, "zed"), []);
  assert.equal(peopleFor(PEOPLE, "", 2).length, 2);
});

test("@ names (#392): the chosen person's address replaces what was typed, the caret after it", () => {
  assert.deepEqual(withMention("Hi @an", 6, { start: 3, query: "an" }, PEOPLE[0]), { text: "Hi @ana@example.com ", caret: 20 });
  assert.deepEqual(withMention("Hi @an please", 6, { start: 3, query: "an" }, PEOPLE[1]), { text: "Hi @bob@band.org please", caret: 17 });
});
