// The service worker's push notifications (#400, public/sw.js): a push
// shown with its title, sentence, tag and page; a click opening that page
// in a window of the app already open, or a new one.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function worker(windows = []) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const self = {
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: () => {},
    location: { origin: "https://score.test" },
    registration: { showNotification: async (title, options) => void shown.push({ title, ...options }) },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => void opened.push(url),
    },
  };
  vm.runInNewContext(SOURCE, { self, caches: {}, URL, Response, fetch: async () => new Response("") });
  const fire = async (type, event) => {
    let work = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (promise) => (work = promise) });
    await work;
  };
  return { fire, shown, opened };
}

const message = (body) => ({ json: () => JSON.parse(body), text: () => body });

test("a push is shown with its title, sentence, tag and the page it opens", async () => {
  const sw = worker();
  await sw.fire("push", { data: message(JSON.stringify({ title: "EUI Score", body: "Ana replied", tag: "notification-1", url: "/app/notifications/1/open" })) });
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, "EUI Score");
  assert.equal(sw.shown[0].body, "Ana replied");
  assert.equal(sw.shown[0].tag, "notification-1");
  assert.equal(sw.shown[0].data.url, "/app/notifications/1/open");
});

test("a push that is not JSON is shown as text, under the app's name", async () => {
  const sw = worker();
  await sw.fire("push", { data: { json: () => { throw new Error("not JSON"); }, text: () => "plain words" } });
  assert.equal(sw.shown[0].title, "EUI Score");
  assert.equal(sw.shown[0].body, "plain words");
  assert.equal(sw.shown[0].data.url, "/app/notifications");
  const empty = worker();
  await empty.fire("push", { data: null });
  assert.equal(empty.shown[0].body, "");
});

test("a click opens the page in the app's window when one is open", async () => {
  const visits = [];
  let focused = false;
  const open = {
    url: "https://score.test/app/scores",
    focus: async () => void (focused = true),
    navigate: async (url) => void visits.push(url),
  };
  const sw = worker([{ url: "https://elsewhere.test/", focus: async () => {}, navigate: async () => {} }, open]);
  let closed = false;
  await sw.fire("notificationclick", { notification: { close: () => (closed = true), data: { url: "/app/notifications/7/open" } } });
  assert.ok(closed);
  assert.ok(focused);
  assert.deepEqual(visits, ["https://score.test/app/notifications/7/open"]);
  assert.deepEqual(sw.opened, []);
});

test("a click opens a new window when no window of the app is open", async () => {
  const sw = worker([]);
  await sw.fire("notificationclick", { notification: { close: () => {}, data: {} } });
  assert.deepEqual(sw.opened, ["https://score.test/app/notifications"]);
});
