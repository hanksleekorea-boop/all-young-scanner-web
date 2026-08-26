const CACHE_PREFIX = 'ays-service-';
const CACHE = 'ays-service-v0.15';
const RELEASE_VERSION = '2026-08-26-service-v0.15';
const CORE = [
  './', './index.html', './progress.html', './offline.html',
  './privacy.html', './terms.html', './support.html',
  './manifest.webmanifest', './icon.svg', './icon-192.svg', './icon-512.svg',
  './readiness.json', './catalog-governance.json', './evidence-v013.json',
  './assets/local-records.mjs', './evidence-v015.json',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.matchAll({ type:'window', includeUncontrolled:true })).then((clients) => clients.forEach((client) => client.postMessage({ type:'AYS_RELEASE_READY', version:RELEASE_VERSION }))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requested = new URL(event.request.url);
  const allowed = CORE.map((path) => new URL(path, self.registration.scope).href);
  // Do not cache API responses, query strings, credentials or other applications on this origin.
  if (!allowed.includes(requested.href)) return;
  const fallback = event.request.mode === 'navigate' ? './offline.html' : undefined;
  event.respondWith(fetch(event.request).then((response) => {
    if (!response || response.status !== 200 || response.type === 'opaque') return response;
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || (fallback ? caches.match(fallback) : Response.error()))));
});
