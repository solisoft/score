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
//   without one, the copy kept, or a page that says so. Not the account's
//   page (its tokens, its plan): never kept, it needs the network.
// - The sign-in page, opened from the network: the session it asks for is
//   gone (signed out on another device, run out, or someone else about to
//   sign in), so the app's pages kept here go — someone's scores (#688).
//
// What is typed offline is not this file's: the editor page keeps it in the
// browser and sends it when the network is back (app/views/app/scores/show).
// v2: v1 kept every version of every file, and the sounds a second time
// (#368); its sounds move to SOUNDS on activation, the rest goes.
const ASSETS = "eui-score-assets-v2";
// The player's own cache (public/eui-score/player.js): one copy of the sounds.
const SOUNDS = "eui-score-sounds";
// v2: the pages kept before sign-out cleared them (#356) go with v1.
// v3: the account's page, kept by v2, goes (#688).
const PAGES = "eui-score-pages-v3";

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

// Push notifications (#400, app/services/web_push.sl): each shown with its
// sentence; a click opens its page (which marks it read), in a window of
// the app already open when there is one.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch (error) {
    message = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(message.title || "Score", {
    body: message.body || "",
    tag: message.tag,
    icon: "/images/app/icon-192.png",
    badge: "/images/app/icon-192.png",
    data: { url: message.url || "/app/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate(target).catch(() => self.clients.openWindow(target));
    }
    return self.clients.openWindow(target);
  })());
});

// Kept for good once fetched: what carries its version in its URL (?v=…),
// the sounds, the fonts. Other files of the site go to the network first.
const isLasting = (url) =>
  url.origin === self.location.origin
    ? url.pathname.startsWith("/soundfonts/") || (url.search.includes("v=") && /^\/(eui-score|css|js|images)\//.test(url.pathname))
    : url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
const isAsset = (url) => url.origin === self.location.origin && /^\/(eui-score|css|js|images)\//.test(url.pathname);
const isAppPage = (url) => url.origin === self.location.origin && /^\/(app|s)(\/|$)/.test(url.pathname);
// Asked for from the network only: what the account's page shows is not kept on the device.
const isUnkept = (url) => /^\/app\/account(\/|$)/.test(url.pathname);
const isSignIn = (url) => url.origin === self.location.origin && /^(\/fr)?\/login\/?$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isLasting(url)) return event.respondWith(fromCacheFirst(request));
  if (isAsset(url)) return event.respondWith(fromNetworkFirst(request, ASSETS));
  if (request.mode !== "navigate") return;
  if (isSignIn(url)) return event.respondWith(signingIn(request));
  if (isAppPage(url)) return event.respondWith(isUnkept(url) ? fromNetworkOnly(request) : fromNetworkFirst(request, PAGES));
});

// The sign-in page, as the network answers it, once the app's pages kept
// here are gone. Offline, nothing is let go: no one could sign in anyway.
async function signingIn(request) {
  const response = await fetch(request);
  await caches.delete(PAGES);
  return response;
}

async function fromNetworkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return offline(NOT_KEPT);
  }
}

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
    return offline(NOT_OPENED);
  }
}

const NOT_OPENED = "This page was not opened on this device before, so it is not kept here.";
const NOT_KEPT = "Your account's page is never kept on this device: it needs the network.";

/** The page that says the network is gone, and `why` this page is not here. */
function offline(why) {
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · Score</title><body style="font:16px/1.6 system-ui,sans-serif;background:#fbf9f4;color:#1d1914;max-width:520px;margin:15vh auto;padding:0 20px">
<h1 style="font-family:Georgia,serif">You are offline</h1><p>${why}
The scores you opened before are: go back, or try again once the network is back.</p>
<p><a href="/app" style="color:#8b2b2c">Your scores</a></p></body></html>`;
  return new Response(page, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
