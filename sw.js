const CACHE_NAME = 'fbs-shell-v31';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './local-llm.js',
  './manifest.webmanifest', './assets/favicon.svg', './data/notices.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith('fbs-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (!cached) throw error;
      const headers = new Headers(cached.headers);
      headers.set('X-FBS-Offline', 'true');
      return new Response(await cached.blob(), {
        status: cached.status, statusText: cached.statusText, headers,
      });
    }
  })());
});
