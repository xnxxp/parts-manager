// database.js - Browser-based storage using localStorage + IndexedDB
const DB = (() => {
    const DB_NAME = 'parts_manager';
    let idb = null;
    let idbReady = false;

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
        // Returns a Promise that resolves true ONLY after the IDB transaction
        // commits. Callers must check the result and fall back to inline base64
        // storage when it resolves false (IDB unavailable / write failed /
        // aborted); otherwise the stored id reference would dangle and the image
        // would never load. Previously this was fire-and-forget (returned
        // undefined), so callers couldn't detect a failed write and stored a
        // bogus id -> images silently lost.
        return new Promise(resolve => {
            if (!idbReady || !key) { resolve(false); return; }
            try {
                const tx = idb.transaction('images', 'readwrite');
                tx.objectStore('images').put(data, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch(e) {
                console.warn('IDB save error:', e);
                resolve(false);
            }
        });
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

    function deleteImage(key) {
        return new Promise(resolve => {
            if (!idbReady || !key) { resolve(false); return; }
            try {
                const tx = idb.transaction('images', 'readwrite');
                tx.objectStore('images').delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
            } catch(e) { resolve(false); }
        });
    }

    function deleteUnusedImage(key) {
        if ([...getStore('parts'), ...getStore('prices')].some(row => row.image === key)) return Promise.resolve(false);
        return deleteImage(key);
    }

    // Resolve a part.image value to a usable base64 data URL.
    // Newer records store an IndexedDB key (id); legacy records store the raw
    // base64 inline. Inline values are returned as-is for backward compat.
    async function resolveImage(value) {
        if (!value) return null;
        if (typeof value === 'string' && value.indexOf('data:image') === 0) {
            return value; // legacy inline base64
        }
        return loadImage(value); // id reference -> IndexedDB
    }

    // localStorage for structured data
    function getStore(name) {
        try { return JSON.parse(localStorage.getItem(DB_NAME + '_' + name)) || []; }
        catch(e) { return []; }
    }

    function setStore(name, data) {
        try {
            localStorage.setItem(DB_NAME + '_' + name, JSON.stringify(data));
            return true;
        } catch(e) {
            app.showToast('存储空间不足，请导出备份后清理');
            return false;
        }
    }

    function nextId(store) {
        const data = getStore(store);
        // Guard against non-numeric / missing ids (corrupted or legacy data):
        // ignore them instead of letting Math.max collapse to NaN and poison
        // every subsequent id. Iterate instead of spread to avoid call-stack
        // limits on very large stores.
        let max = 0;
        for (let i = 0; i < data.length; i++) {
            const id = Number(data[i] && data[i].id);
            if (Number.isFinite(id) && id > max) max = id;
        }
        return max + 1;
    }

    // Persist stock, its total and its history together. A rollback journal
    // also recovers an interrupted write before the next app launch.
    function recoverCommit() {
        const key = DB_NAME + '_stock_journal';
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const previous = JSON.parse(raw);
        Object.keys(previous).forEach(k => localStorage.removeItem(k));
        for (const [k, value] of Object.entries(previous)) {
            if (value !== null) localStorage.setItem(k, value);
        }
        localStorage.removeItem(key);
        markBackupDirty();
    }

    function commitStores(updates) {
        recoverCommit();
        const previous = {};
        const payload = {};
        for (const [name, rows] of Object.entries(updates)) {
            const key = DB_NAME + '_' + name;
            previous[key] = localStorage.getItem(key);
            payload[key] = JSON.stringify(rows);
        }
        const journalKey = DB_NAME + '_stock_journal';
        try {
            localStorage.setItem(journalKey, JSON.stringify(previous));
        } catch (e) { return false; }
        try {
            for (const [key, value] of Object.entries(payload)) localStorage.setItem(key, value);
            localStorage.removeItem(journalKey);
        } catch (e) {
            try { recoverCommit(); }
            catch (err) { throw new Error('存储恢复未完成，请清理手机空间后重新打开应用'); }
            return false;
        }
        markBackupDirty();
        return true;
    }

    function now() { return Math.floor(Date.now() / 1000); }

    async function init() {
        recoverCommit();
        await initIDB();
        // Initialize empty stores if not exist
        ['warehouses', 'parts', 'inventory', 'records', 'prices'].forEach(s => {
            if (!localStorage.getItem(DB_NAME + '_' + s)) {
                localStorage.setItem(DB_NAME + '_' + s, '[]');
            }
        });
        // The warehouse management UI was removed, but stock still tracks
        // per-warehouse internally. Ensure a default warehouse exists and fix
        // any orphaned / missing inventory rows so +/- works out of the box.
        migrateWarehouseModel();
    }

    // Keep stock accounting consistent now that the warehouse UI is gone:
    //  1) keep at least one (default) warehouse;
    //  2) reassign inventory rows whose warehouse no longer exists;
    //  3) seed an inventory row for any part that has a recorded qty but no rows.
    // Idempotent — safe to run every launch.
    function migrateWarehouseModel() {
        let warehouses = getStore('warehouses');
        let defaultWhId;
        if (warehouses.length) {
            defaultWhId = warehouses[0].id;
        } else {
            defaultWhId = 1;
            warehouses = [{ id: 1, name: '默认仓库', location: '', note: '系统默认', created_at: now(), updated_at: now() }];
            setStore('warehouses', warehouses);
        }
        const validIds = new Set(warehouses.map(w => w.id));

        let inventory = getStore('inventory');
        let changed = false;
        inventory.forEach(i => {
            if (!validIds.has(i.warehouse_id)) { i.warehouse_id = defaultWhId; changed = true; }
        });
        if (changed) setStore('inventory', inventory);

        // Two cases that must NOT be conflated. They previously shared one
        // condition (`!(invByPart[p.id] > 0)`), which is true both for "part has
        // no inventory row at all" and for "part's stock was legitimately drawn
        // down to zero". So a part emptied by an outbound operation could have
        // its stock silently restored on the next launch whenever part.qty had
        // failed to persist (e.g. storage pressure) and still held the old value.
        //   a) no inventory row at all -> legacy record: seed one from part.qty
        //   b) inventory rows exist   -> inventory IS the source of truth:
        //      reconcile part.qty to their sum (also heals a part.qty write that
        //      failed after the inventory write already succeeded)
        const parts = getStore('parts');
        const invByPart = {};
        const hasInvRow = {};
        inventory.forEach(i => {
            invByPart[i.part_id] = (invByPart[i.part_id] || 0) + (i.qty || 0);
            hasInvRow[i.part_id] = true;
        });
        const newRows = [];
        let partsChanged = false;
        parts.forEach(p => {
            if (!hasInvRow[p.id]) {
                if ((p.qty || 0) > 0) {
                    newRows.push({ part_id: p.id, warehouse_id: defaultWhId, qty: p.qty, condition: p.condition || 'new', unit_price: p.unit_price || null });
                }
            } else {
                const realTotal = invByPart[p.id] || 0;
                if ((p.qty || 0) !== realTotal) {
                    p.qty = realTotal;
                    partsChanged = true;
                }
            }
        });
        if (partsChanged) setStore('parts', parts);
        if (newRows.length) {
            let maxId = inventory.reduce((m, i) => Math.max(m, i.id || 0), 0);
            newRows.forEach(r => { r.id = ++maxId; r.created_at = now(); r.updated_at = now(); inventory.push(r); });
            setStore('inventory', inventory);
        }
    }

    function all(name) {
        return Promise.resolve(getStore(name));
    }

    function get(name, idOrName) {
        const data = getStore(name);
        return Promise.resolve(data.find(i => i.id === idOrName || i.name === idOrName) || null);
    }

    function run(name, item) {
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
        const ok = setStore(name, data);
        if (ok) markBackupDirty();
        return Promise.resolve({ rowsAffected: ok ? 1 : 0, insertId: item.id, error: ok ? null : 'quota' });
    }

    function deleteItem(name, id) {
        let data = getStore(name);
        data = data.filter(i => i.id !== id);
        const ok = setStore(name, data);
        if (ok) markBackupDirty();
        return Promise.resolve({ rowsAffected: ok ? 1 : 0, error: ok ? null : 'quota' });
    }

    async function exportAllImages() {
        if (!idbReady) return {};
        return new Promise((resolve, reject) => {
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
                    }
                };
                tx.oncomplete = () => resolve(results);
                tx.onerror = tx.onabort = req.onerror = () => reject(new Error('图片读取失败，请重试备份'));
            } catch(err) { reject(new Error('图片读取失败，请重试备份')); }
        });
    }

    // Returns a Promise resolving to true only after the IDB transaction has
    // actually COMMITTED. The previous version returned as soon as the puts were
    // queued, so callers' `await` resolved before the images were durable and a
    // failed/aborted transaction was swallowed — the restore then reported
    // success with images missing. Transaction errors are now propagated.
    async function importImages(data) {
        if (!idbReady || !data) return false;
        return new Promise(resolve => {
            let tx;
            try {
                tx = idb.transaction('images', 'readwrite');
                const store = tx.objectStore('images');
                Object.entries(data).forEach(([key, value]) => {
                    // No per-item try/catch: swallowing a failed put would leave
                    // the transaction to abort without any signal to the caller.
                    store.put(value, key);
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch(e) {
                try { if (tx) tx.abort(); } catch (err) {}
                console.warn('Import images error:', e);
                resolve(false);
            }
        });
    }

    function isReady() { return true; }

    // Dirty flag for auto-backup: set whenever any store is mutated so the
    // background auto-backup knows whether a fresh backup is needed.
    // A monotonically increasing revision counter is maintained alongside it:
    // the auto-backup snapshots data BEFORE handing it to the native writer, so
    // changes made during that window must not be marked as backed up. Callers
    // compare the revision at snapshot time against the current one.
    function markBackupDirty() {
        try {
            localStorage.setItem(DB_NAME + '_backup_dirty', '1');
            localStorage.setItem(DB_NAME + '_rev', String(getBackupRev() + 1));
        } catch (e) {}
    }
    function isBackupDirty() {
        try { return localStorage.getItem(DB_NAME + '_backup_dirty') === '1'; } catch (e) { return false; }
    }
    function clearBackupDirty() {
        try { localStorage.removeItem(DB_NAME + '_backup_dirty'); } catch (e) {}
    }
    function getBackupRev() {
        try { return parseInt(localStorage.getItem(DB_NAME + '_rev'), 10) || 0; } catch (e) { return 0; }
    }

    return { DB_NAME, init, all, get, run, deleteItem, commitStores, saveImage, exportAllImages, importImages, resolveImage, deleteImage, deleteUnusedImage, isReady, markBackupDirty, isBackupDirty, clearBackupDirty, getBackupRev };
})();
