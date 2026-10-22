// The app's service worker (registered by the app's layout, scope /; it
// answers only for the app's pages, /app and /s/, and the files they load):
// what it needs to open and write without a network.
//
// - The engraver, the editor, the sounds, styles and fonts: kept the first
//   time they are fetched, served from here after (their URLs carry their
//   version, so a deploy brings new ones, and old ones are let go below).
// - The app's pages: from the network when there is one, kept as they come;
//   without one, the copy kept, or a page that says so.
//
// What is typed offline is not this file's: the editor page keeps it in the
// browser and sends it when the network is back (app/views/app/scores/show).
const ASSETS = "eui-score-assets-v1";
const PAGES = "eui-score-pages-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
  const cache = await caches.open(ASSETS);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  // An opaque answer (a font from another origin) is kept too: it is what the page would use.
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
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
