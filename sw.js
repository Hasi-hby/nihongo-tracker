// Offline support: network first (so updates arrive immediately), falling back to the
// cached app shell when offline or when the network takes longer than 3 s.
// All app files are requested with ?v=<version> (see tools/bump_version.py), so the
// cache holds exactly one consistent set per version. GitHub API calls are never touched.

const VERSION = '2.2.2';
const CACHE = `tsuzuku-${VERSION}`;
const V = `?v=${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', `styles.css${V}`,
  ...['app', 'store', 'merge', 'sync', 'inbox', 'stats', 'charts', 'export', 'zip', 'util'].map((f) => `js/${f}.js${V}`),
  'fonts/sora.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // reload: bypass the HTTP cache so the precache never mixes in older files
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const nav = e.request.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // a navigation Request cannot be re-fetched with options, so fetch its URL instead
    const network = fetch(nav ? url.href : e.request, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res.ok && (nav || url.search)) cache.put(nav ? 'index.html' : e.request, res.clone());
      return res;
    });
    network.catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    const cached = nav ? await cache.match('index.html') : await cache.match(e.request);
    return cached || network.catch(() => Response.error());
  })());
});
