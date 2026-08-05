// 極簡 service worker：頁面殼 cache-first、API network-first（有網路一律拿新資料）
// 改版時把 CACHE_VERSION 加一，install 後舊快取會在 activate 清掉。
const CACHE_VERSION = 'v4';
const SHELL_CACHE = 'shell-' + CACHE_VERSION;
const DATA_CACHE = 'data-' + CACHE_VERSION;
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './portfolio-math.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 寫入一律直接走網路，離線不排隊
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // network-first：有網路永遠拿最新，失敗才回上次成功的回應
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline'))))
    );
    return;
  }

  // 頁面殼 cache-first，背景更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
