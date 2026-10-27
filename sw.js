// 聽道 service worker: network-first for app shell (always fresh when online), cache fallback for offline; Bible JSON cache-first.
const V = 'tingdao-v3';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/refs.js', 'js/corrections.js', 'js/themes.js', 'js/zhconv.js', 'js/pinyin.js', 'js/pipeline.js', 'js/verses.js', 'js/doctrine.js', 'js/summary.js', 'js/archive.js', 'js/llm.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL.concat(['data/cuv.json'])).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.url.endsWith('data/cuv.json')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); return r; })));
    return;
  }
  e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
});
