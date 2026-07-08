// database.js - Browser-based storage using localStorage + IndexedDB
const DB = (() => {
    const DB_NAME = 'parts_manager';
    let idb = null;
    let idbReady = false;
    const _locks = {};

    // Serialize writes per store to prevent concurrent overwrites
    function serialize(store, fn) {
        if (!_locks[store]) _locks[store] = Promise.resolve();
        const chain = _locks[store];
        _locks[store] = chain.then(() => fn()).catch(() => {});
        return _locks[store];
    }

    // IndexedDB for large data (images)
    function initIDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME + '_images', 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images');
                }
            };
            req.onsuccess = e => { idb = e.target.result; idbReady = true; resolve(); };
            req.onerror = () => resolve(); // IDB optional
        });
    }

    function saveImage(key, data) {
        if (!idbReady) return;
        try {
            const tx = idb.transaction('images', 'readwrite');
            tx.objectStore('images').put(data, key);
        } catch(e) { console.warn('IDB save error:', e); }
    }

    function loadImage(key) {
        return new Promise(resolve => {
            if (!idbReady) { resolve(null); return; }
            try {
                const tx = idb.transaction('images', 'readonly');
                const req = tx.objectStore('images').get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch(e) { resolve(null); }
        });
    }

    // localStorage for structured data
    function getStore(name) {
        try { return JSON.parse(localStorage.getItem(DB_NAME + '_' + name)) || []; }
        catch(e) { return []; }
    }

    function setStore(name, data) {
        try { localStorage.setItem(DB_NAME + '_' + name, JSON.stringify(data)); }
        catch(e) { app.showToast('存储空间不足，请清理旧数据'); }
    }

    function nextId(store) {
        const data = getStore(store);
        return data.length ? Math.max(...data.map(i => i.id)) + 1 : 1;
    }

    function now() { return Math.floor(Date.now() / 1000); }

    async function init() {
        await initIDB();
        // Initialize empty stores if not exist
        ['warehouses', 'parts', 'inventory', 'records', 'prices'].forEach(s => {
            if (!localStorage.getItem(DB_NAME + '_' + s)) {
                localStorage.setItem(DB_NAME + '_' + s, '[]');
            }
        });
    }

    function all(name) {
        return Promise.resolve(getStore(name));
    }

    function get(name, idOrName) {
        const data = getStore(name);
        return Promise.resolve(data.find(i => i.id === idOrName || i.name === idOrName) || null);
    }

    function run(name, item) {
        return serialize(name, () => {
            const data = getStore(name);
            if (item.id && data.find(i => i.id === item.id)) {
                const idx = data.findIndex(i => i.id === item.id);
                data[idx] = { ...data[idx], ...item };
            } else {
                item.id = item.id || nextId(name);
                if (!item.created_at) item.created_at = now();
                item.updated_at = now();
                data.push(item);
            }
            setStore(name, data);
            return Promise.resolve({ rowsAffected: 1, insertId: item.id });
        });
    }

    function deleteItem(name, id) {
        return serialize(name, () => {
            let data = getStore(name);
            data = data.filter(i => i.id !== id);
            setStore(name, data);
            return Promise.resolve({ rowsAffected: 1 });
        });
    }

    async function saveImageData(key, base64) {
        if (!base64) return;
        saveImage(key, base64);
    }

    async function deleteImageData(key) {
        if (!idbReady) return;
        try {
            const tx = idb.transaction('images', 'readwrite');
            tx.objectStore('images').delete(key);
        } catch(e) { console.warn('IDB delete error:', e); }
    }

    async function getImageData(key) {
        if (!key) return null;
        return loadImage(key);
    }

    async function exportAllImages() {
        if (!idbReady) return {};
        return new Promise(resolve => {
            try {
                const tx = idb.transaction('images', 'readonly');
                const store = tx.objectStore('images');
                const req = store.openCursor();
                const results = {};
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        results[cursor.key] = cursor.value;
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };
                req.onerror = () => resolve({});
            } catch(err) { resolve({}); }
        });
    }

    async function importImages(data) {
        if (!idbReady || !data) return;
        try {
            const tx = idb.transaction('images', 'readwrite');
            const store = tx.objectStore('images');
            Object.entries(data).forEach(([key, value]) => {
                try { store.put(value, key); } catch(e) {}
            });
        } catch(e) { console.warn('Import images error:', e); }
    }

    function isReady() { return true; }

    return { init, all, get, run, deleteItem, saveImageData, deleteImageData, getImageData, exportAllImages, importImages, isReady };
})();
