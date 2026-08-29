const CACHE_PREFIX = 'ays-service-';
const CACHE = 'ays-service-v0.28';
const RELEASE_VERSION = '2026-08-29-service-v0.28';
const CORE = [
  './', './index.html', './progress.html', './offline.html',
  './privacy.html', './terms.html', './support.html', './.well-known/security.txt',
  './manifest.webmanifest', './icon.svg', './icon-192.svg', './icon-512.svg',
  './readiness.json', './free-advanced-readiness.json', './stage2-readiness.json', './catalog-governance.json',
  './guides/index.html', './content/usage-guides.json',
  './assets/free-advanced-app.mjs', './assets/free-advanced-bootstrap.mjs', './evidence-v028.json',
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
  const scope = new URL(self.registration.scope);
  const guideRoot = new URL('./guides/', self.registration.scope).pathname;
  const isGuidePage = requested.origin === scope.origin && requested.pathname.startsWith(guideRoot) && requested.pathname.endsWith('/') && !requested.search;
  // Do not cache API responses, query strings, credentials or other applications on this origin.
  if (!allowed.includes(requested.href) && !isGuidePage) return;
  const fallback = event.request.mode === 'navigate' ? './offline.html' : undefined;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response?.status === 200 && response.type !== 'opaque') {
        try { const cache = await caches.open(CACHE); await cache.put(event.request,response.clone()); }
        catch { /* Storage quota or blocked cache must not hide a valid network response. */ }
      }
      return response;
    } catch {
      try {
        const cache = await caches.open(CACHE);
        return await cache.match(event.request) || (fallback ? await cache.match(new URL(fallback,self.registration.scope).href) : undefined) || Response.error();
      } catch { return Response.error(); }
    }
  })());
});
