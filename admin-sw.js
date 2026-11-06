// NP Admin – Service Worker (ইনস্টল + পুশ নোটিফিকেশন)
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* নেটওয়ার্ক থেকেই লোড হবে, কোনো ক্যাশ নেই */ });

// FCM পুশ (অ্যাপ বন্ধ থাকলেও আসে)
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { try { p = { data: { body: e.data.text() } }; } catch (__) {} }
  var d = Object.assign({}, p.notification || {}, p.data || {});
  e.waitUntil((async function () {
    var cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cl.some(function (c) { return c.visibilityState === 'visible' && c.focused; })) return; // অ্যাপ সামনে খোলা: নিজেই টোস্ট+সাউন্ড দেয়
    await self.registration.showNotification(d.title || 'NP Admin', {
      body: d.body || '', icon: './admin-icon-192.png', badge: './admin-icon-192.png',
      tag: d.tag || 'np-admin', renotify: true, requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300], data: { view: d.view || 'view-wallet' }
    });
  })());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var view = (e.notification.data && e.notification.data.view) || 'view-wallet';
  e.waitUntil((async function () {
    var cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < cl.length; i++) {
      if ('focus' in cl[i]) { await cl[i].focus(); cl[i].postMessage({ view: view }); return; }
    }
    await self.clients.openWindow('./admin.html?view=' + view);
  })());
});
