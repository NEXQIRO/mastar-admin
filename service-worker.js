/**
 * NP TOURNAMENT BD - Service Worker for PWA Installation & Offline Shell
 * v4: প্যানেলের পেজ (index.html) ডিভাইসে সেভ থাকে; খুললে সাথে সাথে সেভ করা পেজ দেখায়,
 *     আর ব্যাকগ্রাউন্ডে নতুন ভার্সন এনে সেভ করে রাখে (পরের বার নতুনটা দেখায়)।
 *     Firebase SDK ও ফন্ট ফাইলও ডিভাইসে সেভ থাকে, তাই বারবার ডাউনলোড হয় না।
 */

const CACHE_NAME = 'np-tournament-pwa-v5';
const SCOPE = new URL('./', self.registration.scope).href;
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
const SHELL_URLS = [SCOPE, SCOPE + 'index.html', SCOPE + 'manifest.json', SCOPE + 'icon-192.png', SCOPE + 'icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Individually cache each static asset so a 404 on any file never fails the installation
      for (const asset of ASSETS_TO_CACHE) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[PWA SW] Pre-cache skipped for ' + asset, err);
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Firebase SDK (versioned file) ও ফন্ট ফাইল: একবার সেভ হলে আর ডাউনলোড হয় না
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

// প্যানেলের পেজ: সেভ করা কপি সাথে সাথে দেখায়, ব্যাকগ্রাউন্ডে নতুন কপি এনে সেভ করে
async function staleWhileRevalidate(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const key = url.origin + url.pathname;
  let cached = await cache.match(key);
  if (!cached && request.mode === 'navigate') cached = await cache.match(SCOPE + 'index.html');

  const update = fetch(request).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      cache.put(key, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  const net = await update;
  return net || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Bypass cache for real-time Firebase databases, authentication, websockets, and external APIs
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.protocol.startsWith('ws')
  ) {
    return;
  }

  // Firebase SDK scripts + font files: cache first
  if ((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Panel shell (index.html, manifest, icons): show saved copy instantly, refresh in background
  if (url.origin === self.location.origin && SHELL_URLS.includes(url.origin + url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, url));
    return;
  }

  // Everything else (e.g. games in sub-folders): network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') {
          return (await caches.match('./index.html')) || (await caches.match('./')) || new Response('Offline', { status: 503 });
        }
        return new Response('', { status: 504 });
      })
  );
});
