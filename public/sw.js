// The app's service worker (registered by the app's layout, scope /; it
// answers only for the app's pages, /app and /s/, and the files they load):
// what it needs to open and write without a network.
//
// - The engraver, the editor, styles and fonts: kept the first time they
//   are fetched, served from here after. Their URLs carry their version: a
//   deploy brings new ones, and each replaces the version kept before it.
// - The sounds (38 MB): kept once, in the cache the player keeps them in
//   too (SOUNDS, public/eui-score/player.js), under the same address.
// - The app's pages: from the network when there is one, kept as they come;
//   without one, the copy kept, or a page that says so.
//
// What is typed offline is not this file's: the editor page keeps it in the
// browser and sends it when the network is back (app/views/app/scores/show).
// v2: v1 kept every version of every file, and the sounds a second time
// (#368); its sounds move to SOUNDS on activation, the rest goes.
const ASSETS = "eui-score-assets-v2";
// The player's own cache (public/eui-score/player.js): one copy of the sounds.
const SOUNDS = "eui-score-sounds";
// v2: the pages kept before sign-out cleared them (#356) go with v1.
const PAGES = "eui-score-pages-v2";

self.addEventListener("install", () => self.skipWaiting());
// Caches of an older version of this file are let go — the sounds they
// hold moved to SOUNDS first, so they are not downloaded again.
self.addEventListener("activate", (event) => event.waitUntil(forgetOldCaches().then(() => self.clients.claim())));

const CURRENT = [ASSETS, PAGES, SOUNDS];
const isSounds = (url) => url.origin === self.location.origin && url.pathname.startsWith("/soundfonts/");

async function forgetOldCaches() {
  const old = (await caches.keys()).filter((name) => name.startsWith("eui-score-") && !CURRENT.includes(name));
  for (const name of old) await moveSounds(name);
  await Promise.all(old.map((name) => caches.delete(name)));
}

async function moveSounds(name) {
  const from = await caches.open(name);
  const to = await caches.open(SOUNDS);
  for (const request of await from.keys()) {
    if (!isSounds(new URL(request.url)) || (await to.match(request))) continue;
    const response = await from.match(request);
    if (response) await keep(to, request, response);
  }
}

// `response` kept for `request`, in place of the other versions of the same
// file of this site (same path, another ?v=): a deploy's new engraver
// replaces the old. (Another site's addresses differ by more than a
// version: the fonts' stylesheets are one path for every family.)
async function keep(cache, request, response) {
  await cache.put(request, response);
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const older = (await cache.keys()).filter((kept) => {
    const other = new URL(kept.url);
    return other.origin === url.origin && other.pathname === url.pathname && other.search !== url.search;
  });
  await Promise.all(older.map((kept) => cache.delete(kept)));
}

// Signed out (the page after says so, app/views/layouts/app): the app's pages
// kept here are someone's scores, and the computer may be shared. The
// engraver's files and the sounds stay: they are no one's.
self.addEventListener("message", (event) => {
  if (event.data?.type === "signed-out") event.waitUntil(caches.delete(PAGES));
});

// Kept for good once fetched: what carries its version in its URL (?v=…),
// the sounds, the fonts. Other files of the site go to the network first.
const isLasting = (url) =>
  url.origin === self.location.origin
    ? url.pathname.startsWith("/soundfonts/") || (url.search.includes("v=") && /^\/(eui-score|css|js|images)\//.test(url.pathname))
    : url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
const isAsset = (url) => url.origin === self.location.origin && /^\/(eui-score|css|js|images)\//.test(url.pathname);
const isAppPage = (url) => url.origin === self.location.origin && /^\/(app|s)(\/|$)/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isLasting(url)) return event.respondWith(fromCacheFirst(request));
  if (isAsset(url)) return event.respondWith(fromNetworkFirst(request, ASSETS));
  if (request.mode === "navigate" && isAppPage(url)) return event.respondWith(fromNetworkFirst(request, PAGES));
});

async function fromCacheFirst(request) {
  const cache = await caches.open(isSounds(new URL(request.url)) ? SOUNDS : ASSETS);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  // An opaque answer (a font from another origin) is kept too: it is what the page would use.
  if (response.ok || response.type === "opaque") keep(cache, request, response.clone()).catch(() => {});
  return response;
}

async function fromNetworkFirst(request, name) {
  const cache = await caches.open(name);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const kept = await cache.match(request, { ignoreSearch: true });
    if (kept) return kept;
    if (name !== PAGES) throw error;
    return new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · EUI Score</title><body style="font:16px/1.6 system-ui,sans-serif;background:#fbf9f4;color:#1d1914;max-width:520px;margin:15vh auto;padding:0 20px">
<h1 style="font-family:Georgia,serif">You are offline</h1><p>This page was not opened on this device before, so it is not kept here.
The scores you opened before are: go back, or try again once the network is back.</p>
<p><a href="/app" style="color:#8b2b2c">Your scores</a></p></body></html>`;
