// service-worker.js - 离线缓存
const CACHE_NAME = 'parts-manager-v2.2.6';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './css/warm.css',
    './js/database.js',
    './js/app.js',
    './js/stock.js',
    './js/restock.js',
    './js/parts.js',
    './js/catalog.js',
    './js/price.js',
    './js/export.js',
    './libs/xlsx.full.min.js',
    './libs/jszip.min.js'
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
