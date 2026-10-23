// The service worker (public/sw.js), run in a sandbox with a fake cache
// storage: what it lets go on activation and on sign-out.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

/** The worker loaded over `names` (the caches the browser holds): its handlers and the caches left. */
function worker(names) {
  const kept = new Set(names);
  const handlers = {};
  const caches = {
    keys: async () => [...kept],
    delete: async (name) => kept.delete(name),
    open: async () => ({ match: async () => undefined, put: async () => {} }),
  };
  const self = {
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    location: { origin: "https://score.test" },
  };
  vm.runInNewContext(SOURCE, { self, caches, URL, Response, fetch: async () => {} });
  /** Fires `type` with `data`; resolves once the work it waits on is done. */
  const fire = async (type, data) => {
    let work = Promise.resolve();
    handlers[type]({ data, waitUntil: (promise) => (work = promise) });
    await work;
  };
  return { kept, fire };
}

const pagesCache = () => SOURCE.match(/const PAGES = "([^"]+)"/)[1];
const assetsCache = () => SOURCE.match(/const ASSETS = "([^"]+)"/)[1];

test("the pages' cache is past v1, so pages kept before sign-out cleared them go", () => {
  assert.notEqual(pagesCache(), "eui-score-pages-v1");
});

test("activation lets go of an older version's caches, and keeps the current ones and other sites'", async () => {
  const { kept, fire } = worker(["eui-score-pages-v1", "eui-score-assets-v0", pagesCache(), assetsCache(), "someone-else"]);
  await fire("activate");
  assert.deepEqual([...kept].sort(), [assetsCache(), pagesCache(), "someone-else"].sort());
});

test("a sign-out message drops the kept pages and keeps the engraver's files", async () => {
  const { kept, fire } = worker([pagesCache(), assetsCache()]);
  await fire("message", { type: "signed-out" });
  assert.deepEqual([...kept], [assetsCache()]);
});

test("any other message leaves the caches alone", async () => {
  const { kept, fire } = worker([pagesCache(), assetsCache()]);
  await fire("message", { type: "something-else" });
  await fire("message", null);
  assert.equal(kept.size, 2);
});
