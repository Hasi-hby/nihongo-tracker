// Offline support: network first (so updates arrive immediately), falling back to the
// cached app shell when offline or when the network takes longer than 3 s.
// GitHub API calls are never touched.

const CACHE = 'nihongo-hunter-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/merge.js', 'js/sync.js', 'js/stats.js', 'js/hunter.js', 'js/charts.js', 'js/util.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    network.catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    const cached = await cache.match(e.request, { ignoreSearch: true })
      || (e.request.mode === 'navigate' ? await cache.match('index.html') : null);
    return cached || network.catch(() => Response.error());
  })());
});
