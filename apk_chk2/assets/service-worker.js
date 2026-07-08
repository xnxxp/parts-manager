// service-worker.js - 离线缓存
const CACHE_NAME = 'parts-manager-v2';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/app.js',
    './js/database.js',
    './js/dashboard.js',
    './js/parts.js',
    './js/warehouse.js',
    './js/inventory.js',
    './js/price.js',
    './js/export.js',
    './libs/xlsx.full.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(() => {});
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => {
            const fetchPromise = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
