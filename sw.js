/* Prompt Studio — offline shell.

   The app already makes no network calls of any kind once it has loaded: the
   vocabulary, the reasoning layer and everything else are just files. So there
   is nothing standing between it and working with no connection at all — which
   is when a prompt box is often most useful. On a plane, on a train, on a phone
   with one bar, in a country where the data roaming is ruinous.

   The caching strategy is picked to make one specific failure impossible: a
   returning visitor stuck on a stale version. Navigations go to the network
   first, so a fresh deploy is picked up the moment there is a connection, and
   fall back to cache only when the network genuinely fails. Everything else is
   cache-first, which is safe because those URLs carry a ?v= stamp — a new
   release requests new URLs, so a cached asset can never shadow a newer one.
   The cache name carries the same version so old caches are swept on activate. */

const VERSION = "21";
const CACHE = "prompt-studio-v" + VERSION;

/* Only what is needed to render something useful with no connection at all.
   The scripts are deliberately absent: they carry version-stamped URLs, so
   they are cached on first fetch instead of being listed here twice and left
   to drift out of step with index.html. */
const SHELL = [
  "./",
  "./index.html",
  "./goodhart.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", event => {
  /* A shell file that 404s must not sink the whole install — the app is still
     perfectly usable online, and a failed install would leave the user with no
     service worker at all rather than a partial one. */
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      // take over open tabs now, so a new version never waits for every tab to close
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // never touch another origin: this app talks to nobody, and a service worker
  // that proxies third-party requests is a privacy surface it has no use for
  if (url.origin !== self.location.origin) return;

  /* Navigations: network first. This is the rule that makes a stale app
     impossible — whenever there is a connection, the newest index.html wins. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req)
          .then(hit => hit || caches.match("./index.html"))
          .then(hit => hit || new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
            "<p style=\"font:16px system-ui;padding:2rem\">Prompt Studio isn't cached yet — " +
            "open it once with a connection and it will work offline from then on.",
            { headers: { "Content-Type": "text/html; charset=utf-8" } })))
    );
    return;
  }

  /* Everything else: cache first. Safe because these URLs are version-stamped,
     so a new release asks for a URL that is not in the cache yet. */
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
