// The service worker (public/sw.js), run in a sandbox with a fake cache
// storage: what it keeps, where, and what it lets go on activation and on
// sign-out.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const PLAYER = readFileSync(new URL("../../public/eui-score/player.js", import.meta.url), "utf8");
const SOUNDS_URL = "https://score.test/soundfonts/MuseScore_General.sf3?v=0.2";

/**
 * The worker loaded over `held` (the caches the browser holds: a list of
 * names, or name to the URLs kept in it): its handlers, the cache names
 * left, what each holds, and the requests that reached the network.
 */
function worker(held, network = async () => new Response("from the network")) {
  const store = new Map();
  const entries = Array.isArray(held) ? held.map((name) => [name, []]) : Object.entries(held);
  for (const [name, urls] of entries) store.set(name, new Map(urls.map((url) => [url, new Response(`kept ${url}`)])));
  const cacheOf = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const urls = store.get(name);
    const key = (request) => (typeof request === "string" ? request : request.url);
    return {
      keys: async () => [...urls.keys()].map((url) => ({ url })),
      match: async (request) => urls.get(key(request))?.clone(),
      put: async (request, response) => void urls.set(key(request), response),
      delete: async (request) => urls.delete(key(request)),
    };
  };
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    open: async (name) => cacheOf(name),
  };
  const handlers = {};
  const self = {
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    location: { origin: "https://score.test" },
  };
  const fetched = [];
  const fetch = async (request) => {
    fetched.push(typeof request === "string" ? request : request.url);
    return network(request);
  };
  vm.runInNewContext(SOURCE, { self, caches, URL, Response, fetch });
  /** Fires `type` with `data`; resolves once the work it waits on is done. */
  const fire = async (type, data) => {
    let work = Promise.resolve();
    handlers[type]({ data, waitUntil: (promise) => (work = promise) });
    await work;
  };
  /** A GET of `url` through the worker: its answer. */
  const get = async (url) => {
    let answer;
    handlers.fetch({ request: { url, method: "GET", mode: "no-cors" }, respondWith: (promise) => (answer = promise) });
    const response = await answer;
    // The cache is written after the answer: let that settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return response;
  };
  const urlsIn = (name) => [...(store.get(name)?.keys() ?? [])].sort();
  return { kept: new Set(store.keys()), names: () => [...store.keys()].sort(), fire, get, urlsIn, fetched };
}

const pagesCache = () => SOURCE.match(/const PAGES = "([^"]+)"/)[1];
const assetsCache = () => SOURCE.match(/const ASSETS = "([^"]+)"/)[1];
const soundsCache = () => SOURCE.match(/const SOUNDS = "([^"]+)"/)[1];

test("the pages' cache is past v1, so pages kept before sign-out cleared them go", () => {
  assert.notEqual(pagesCache(), "eui-score-pages-v1");
});

test("the assets' cache is past v1, which held every version and the sounds twice", () => {
  assert.notEqual(assetsCache(), "eui-score-assets-v1");
});

test("activation lets go of an older version's caches, and keeps the current ones and other sites'", async () => {
  const { names, fire } = worker([
    "eui-score-pages-v1",
    "eui-score-assets-v0",
    pagesCache(),
    assetsCache(),
    soundsCache(),
    "someone-else",
  ]);
  await fire("activate");
  assert.deepEqual(names(), [assetsCache(), pagesCache(), soundsCache(), "someone-else"].sort());
});

test("the sounds are kept in the player's own cache, under the player's address: a device holds them once", () => {
  assert.equal(soundsCache(), PLAYER.match(/const CACHE = "([^"]+)"/)[1]);
  assert.match(PLAYER, /"\.\.\/soundfonts\/MuseScore_General\.sf3\?v=0\.2"/);
});

test("activation moves an older version's sounds to the player's cache before letting it go", async () => {
  const { names, fire, urlsIn } = worker({
    "eui-score-assets-v1": [SOUNDS_URL, "https://score.test/eui-score/eui-score.js?v=old"],
  });
  await fire("activate");
  assert.ok(!names().includes("eui-score-assets-v1"));
  assert.deepEqual(urlsIn(soundsCache()), [SOUNDS_URL]);
  assert.deepEqual(urlsIn(assetsCache()), []);
});

test("activation does not copy the sounds again when the player already holds them", async () => {
  const { fire, urlsIn } = worker({ "eui-score-assets-v1": [SOUNDS_URL], [soundsCache()]: [SOUNDS_URL] });
  await fire("activate");
  assert.deepEqual(urlsIn(soundsCache()), [SOUNDS_URL]);
});

test("the sounds fetched through the worker land in the player's cache, not in the assets'", async () => {
  const { get, urlsIn, fetched } = worker([]);
  assert.equal(await (await get(SOUNDS_URL)).text(), "from the network");
  assert.deepEqual(urlsIn(soundsCache()), [SOUNDS_URL]);
  assert.deepEqual(urlsIn(assetsCache()), []);
  // The next time, from the cache: the network is not asked again.
  assert.equal(await (await get(SOUNDS_URL)).text(), "from the network");
  assert.equal(fetched.length, 1);
});

test("a new version of a file replaces the one kept before, and leaves the other files alone", async () => {
  const { get, urlsIn } = worker({
    [assetsCache()]: ["https://score.test/eui-score/eui_score_web_bg.wasm?v=aaa", "https://score.test/eui-score/studio.js?v=aaa"],
    [soundsCache()]: ["https://score.test/soundfonts/MuseScore_General.sf3?v=0.1"],
  });
  await get("https://score.test/eui-score/eui_score_web_bg.wasm?v=bbb");
  assert.deepEqual(urlsIn(assetsCache()), [
    "https://score.test/eui-score/eui_score_web_bg.wasm?v=bbb",
    "https://score.test/eui-score/studio.js?v=aaa",
  ]);
  await get(SOUNDS_URL);
  assert.deepEqual(urlsIn(soundsCache()), [SOUNDS_URL]);
});

test("another site's files that share a path are all kept: the fonts' stylesheets", async () => {
  const { get, urlsIn } = worker([]);
  await get("https://fonts.googleapis.com/css2?family=Fraunces");
  await get("https://fonts.googleapis.com/css2?family=Inter");
  assert.equal(urlsIn(assetsCache()).length, 2);
});

test("a failed download is not kept, and does not push out the version kept", async () => {
  const older = "https://score.test/soundfonts/MuseScore_General.sf3?v=0.1";
  const { get, urlsIn } = worker({ [soundsCache()]: [older] }, async () => new Response("gone", { status: 404 }));
  assert.equal((await get(SOUNDS_URL)).status, 404);
  assert.deepEqual(urlsIn(soundsCache()), [older]);
});

test("a sign-out message drops the kept pages and keeps the engraver's files and the sounds", async () => {
  const { names, fire } = worker([pagesCache(), assetsCache(), soundsCache()]);
  await fire("message", { type: "signed-out" });
  assert.deepEqual(names(), [assetsCache(), soundsCache()].sort());
});

test("any other message leaves the caches alone", async () => {
  const { names, fire } = worker([pagesCache(), assetsCache()]);
  await fire("message", { type: "something-else" });
  await fire("message", null);
  assert.equal(names().length, 2);
});
