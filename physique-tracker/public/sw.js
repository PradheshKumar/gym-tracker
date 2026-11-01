// Offline-first service worker: precache the shell, cache-first for same-origin GETs.
const CACHE = 'physique-v3';
// Resolve paths against the worker's scope so the app works under a sub-path (e.g. GitHub Pages).
const SHELL = new URL('index.html', self.registration.scope).href;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first for navigations so new builds show up, fall back to cached shell offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Reminder notifications: open (or focus) the app on the reminder's screen.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`./#/${e.notification.data?.route ?? 'today'}`, self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) return win.navigate(url).then((c) => c && c.focus());
      return self.clients.openWindow(url);
    }),
  );
});

// Background reminders pushed by the Supabase send-reminders function.
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data && e.data.text() };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Gym Tracker', {
      body: d.body,
      tag: d.tag,
      icon: new URL('icon.svg', self.registration.scope).href,
      data: { route: d.route || 'today' },
    }),
  );
});
