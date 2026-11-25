/* ============================================================
   코리아 에코크린 PWA — service worker
   - Pre-caches the app shell so the app opens offline.
   - Navigations: network first, cached index.html as fallback.
   - Static assets: cache first, refreshed in the background.
   Bump CACHE_VERSION whenever shell files change.
   ============================================================ */

const CACHE_VERSION = 'v2.0.1';
const CACHE_NAME = `kec-shell-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/auth.js',
  './js/seed.js',
  './js/photos.js',
  './js/views/home.js',
  './js/views/customer.js',
  './js/views/leader.js',
  './js/views/admin.js',
  './assets/logo.png',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/samples/photo-1-office.jpg',
  './assets/samples/photo-2-meeting.jpg',
  './assets/samples/photo-3-clinic.jpg',
  './assets/samples/photo-4-clinic-lounge.jpg',
  './assets/samples/photo-5-gym.jpg',
  './assets/samples/photo-6-lounge.jpg',
  './assets/samples/photo-7-lounge.jpg',
  './assets/samples/photo-lock.jpg',
  './assets/samples/photo-issue.jpg',
  './assets/samples/thumbs/photo-1-office.jpg',
  './assets/samples/thumbs/photo-2-meeting.jpg',
  './assets/samples/thumbs/photo-3-clinic.jpg',
  './assets/samples/thumbs/photo-4-clinic-lounge.jpg',
  './assets/samples/thumbs/photo-5-gym.jpg',
  './assets/samples/thumbs/photo-6-lounge.jpg',
  './assets/samples/thumbs/photo-7-lounge.jpg',
  './assets/samples/thumbs/photo-lock.jpg',
  './assets/samples/thumbs/photo-issue.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll() fails as a whole on one bad URL — add one by one instead.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((error) => {
            console.warn('[sw] precache miss', url, error);
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('kec-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch (error) {
          /* ignore */
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('./index.html', response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) || (await cache.match('./index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">오프라인 상태입니다. 연결 후 다시 시도해 주세요.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    // Refresh quietly; the next load picks it up.
    fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok && request.url.startsWith(self.location.origin)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
