/* Rechnungserstellung – Offline-Betrieb und sichere Updates
 * Der Service Worker speichert nur den PROGRAMMCODE. Die Daten liegen in IndexedDB
 * und werden von hier aus nie angefasst. */
importScripts('version.js');
const CACHE = 'rechnung-app-' + self.APP_VERSION;
const ASSETS = ['./', 'index.html', 'styles.css', 'version.js', 'db.js', 'pdf.js', 'export.js', 'app.js',
  'manifest.webmanifest', 'jspdf.umd.min.js', 'xlsx.full.min.js',
  'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // Neue Version vollständig laden, bevor sie aktiv werden darf. Fehlt eine Datei, bleibt die alte Version aktiv.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('rechnung-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      if (req.mode === 'navigate') return (await c.match('index.html')) || fetch(req);
      return (await c.match(req, { ignoreSearch: true })) || fetch(req);
    })
  );
});
