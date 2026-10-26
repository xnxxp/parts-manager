const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const names = ['warehouses', 'parts', 'inventory', 'records', 'prices'];
const photo = 'data:image/jpeg;base64,YWJj';
const seed = { warehouses: [{ id: 1, name: '默认仓库' }],
    parts: [{ id: 1, name: '屏幕', category: '屏幕', qty: 3, location: '背包', image: 'old_image' }],
    inventory: [{ id: 1, part_id: 1, warehouse_id: 1, qty: 3 }],
    records: [{ id: 1, part_id: 1, type: 'in', qty: 3 }],
    prices: [{ id: 1, title: '价格表', image: 'old_image' }] };
const backup = () => ({ version: '2.0', data: JSON.parse(JSON.stringify({ ...seed, images: { old_image: photo } })) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
    const values = new Map(), images = new Map([['old_image', photo]]), toasts = [], calls = [], readers = [];
    let failKey, quota = Infinity, confirmed = 0;
    const storage = {
        getItem: key => values.get(key) ?? null,
        removeItem: key => values.delete(key),
        setItem(key, value) {
            if (key === failKey) { failKey = null; throw new Error('quota'); }
            value = String(value);
            let total = value.length;
            for (const [k, v] of values) if (k !== key) total += v.length;
            if (total > quota) throw new Error('quota');
            values.set(key, value);
        }
    };
    for (const name of names) storage.setItem('parts_manager_' + name, JSON.stringify(seed[name]));
    const database = {
        transaction(_, mode) {
            const tx = { aborted: false, abort() { this.aborted = true; } }, writes = [];
            tx.objectStore = () => ({
                put: (value, key) => writes.push([key, value]),
                delete: key => writes.push([key, undefined]),
                openCursor() {
                    const req = {};
                    const entries = [...images]; let index = 0;
                    const advance = () => queueMicrotask(() => {
                        if (options.readFailure) { req.onerror?.(); tx.onerror?.(); return; }
                        const row = entries[index++];
                        req.onsuccess?.({ target: { result: row ? { key: row[0], value: row[1], continue: advance } : null } });
                        if (!row) options.readAbort ? tx.onabort?.() : tx.oncomplete?.();
                    });
                    advance(); return req;
                },
                get(key) { const req = {}; queueMicrotask(() => { req.result = images.get(key); req.onsuccess?.(); }); return req; }
            });
            if (mode === 'readwrite') queueMicrotask(() => {
                if (options.importFailure || tx.aborted) { tx.onabort?.(); return; }
                for (const [key, value] of writes) value === undefined ? images.delete(key) : images.set(key, value);
                tx.oncomplete?.();
            });
            return tx;
        }
    };
    const elements = new Map();
    const context = vm.createContext({ console: { error() {}, warn() {}, log() {} }, Blob, setTimeout, clearTimeout,
        localStorage: storage, navigator: {}, window: { addEventListener() {} },
        indexedDB: { open() { const req = {}; queueMicrotask(() => options.unavailable ? req.onerror() : req.onsuccess({ target: { result: database } })); return req; } },
        confirm() { confirmed++; return true; },
        FileReader: class {
            readAsText(file) { readers.push(Promise.resolve(this.onload({ target: { result: file.text } }))); }
            readAsDataURL(blob) { readers.push(blob.arrayBuffer().then(buffer => {
                this.result = 'data:application/json;base64,' + Buffer.from(buffer).toString('base64');
                this.onload({ target: { result: this.result } });
            })); }
        },
        document: { addEventListener() {}, getElementById(id) {
            if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: { display: 'none' } });
            return elements.get(id);
        } }
    });
    for (const [file, api] of [['database', 'DB'], ['stock', 'Stock'], ['parts', 'partsManager'], ['price', 'priceManager'], ['export', 'exportManager'], ['app', 'app']]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/js/' + file + '.js'), 'utf8') + '\nglobalThis.' + api + '=' + api, context);
    }
    context.app.showToast = text => toasts.push(text);
    for (const method of ['_openModal', '_closeModal', 'updateStatsBar', 'refreshDashboard']) context.app[method] = () => {};
    context.partsManager.closeModal = context.partsManager.load = context.priceManager.load = () => {};
    context.partsManager.viewDetail = () => {};
    context.window.AndroidBridge = Object.fromEntries(['saveFile', 'saveFileReplace', 'saveImage'].map(method => [method,
        (...args) => calls.push({ method, args })]));
    return { ...context, storage, images, toasts, calls, readers, elements,
        snapshot: () => names.map(name => storage.getItem('parts_manager_' + name)),
        fail: name => { failKey = 'parts_manager_' + name; },
        quota: size => { quota = size; }, confirmed: () => confirmed,
        async importFile(value) {
            context.exportManager.importData({ target: { files: [{ text: JSON.stringify(value) }], value: 'x' } });
            await Promise.all(readers);
        }
    };
}

test('invalid backup files cannot reach confirmation or overwrite existing data', async () => {
    const f = fixture(); await f.DB.init(); const before = f.snapshot();
    const bad = [{ data: {} }, { data: { ...backup().data, parts: [null] } }];
    for (const change of [
        d => { d.parts[0].qty = -1; }, d => { d.inventory[0].qty = '3'; },
        d => { d.inventory[0].part_id = 99; }, d => { d.records[0].warehouse_id = 99; },
        d => { d.parts.push({ ...d.parts[0] }); }, d => { d.parts[0].id = '1);alert(1)'; },
        d => { d.parts[0].location = {}; }, d => { d.parts[0].condition = 'broken'; },
        d => { d.parts[0].restock_plan = { qty: 2, location: '' }; }, d => { d.images = {}; }
    ]) { const b = backup(); change(b.data); bad.push(b); }
    for (const b of bad) { await f.importFile(b); assert.deepEqual(f.snapshot(), before); }
    assert.equal(f.confirmed(), 0);
});

test('valid empty backups and legacy inline photos can be restored', async () => {
    const f = fixture({ unavailable: true }); await f.DB.init();
    const b = backup(); b.data.parts[0].image = photo; b.data.prices = []; b.data.images = {}; b.data.inventory = [];
    await f.exportManager.restoreBackup(b);
    assert.equal((await f.DB.all('inventory'))[0].qty, 3);
    const empty = { data: Object.fromEntries(names.map(n => [n, []])) };
    await f.importFile(empty);
    assert.equal((await f.DB.all('parts')).length, 0);
    assert.equal(f.toasts.at(-1), '数据恢复成功');
});

for (const name of ['stock_journal', ...names]) test('restore rolls back all tables on failed write: ' + name, async () => {
    const f = fixture(); await f.DB.init(); const before = f.snapshot();
    f.fail(name);
    await assert.rejects(f.exportManager.restoreBackup(backup()));
    await tick();
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual([...f.images], [['old_image', photo]]);
    assert.equal(f.partsManager._stockBusy, false);
});

test('bounded storage quota cannot lose the original parts table during restore', async () => {
    const f = fixture(); await f.DB.init(); const before = f.snapshot();
    f.quota(1300);
    const b = backup(); b.data.inventory[0].note = 'x'.repeat(900);
    await assert.rejects(f.exportManager.restoreBackup(b));
    assert.deepEqual(f.snapshot(), before);
});

test('failed image staging preserves every table and every current image', async () => {
    const f = fixture({ importFailure: true }); await f.DB.init(); const before = f.snapshot();
    const b = backup(); b.data.images.old_image = 'data:image/jpeg;base64,ZGVm';
    await assert.rejects(f.exportManager.restoreBackup(b), /图片写入失败/);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.images.get('old_image'), photo);
});

test('restore stages fresh image keys and leaves the current images untouched', async () => {
    const f = fixture(); await f.DB.init(); const b = backup();
    b.data.images.old_image = 'data:image/jpeg;base64,ZGVm';
    await f.exportManager.restoreBackup(b);
    const imageKey = (await f.DB.get('parts', 1)).image;
    assert.notEqual(imageKey, 'old_image');
    assert.equal((await f.DB.get('prices', 1)).image, imageKey);
    assert.equal(f.images.get(imageKey), b.data.images.old_image);
    assert.equal(f.images.get('old_image'), photo);
    const exported = JSON.parse(await (await f.exportManager._buildBackupBlob()).text());
    assert.equal(exported.data.images[imageKey], b.data.images.old_image);
});

for (const name of ['parts', 'inventory', 'records']) test('failed part deletion preserves stock, history and photo: ' + name, async () => {
    const f = fixture(); await f.DB.init(); const before = f.snapshot(); f.fail(name);
    await f.partsManager.deleteItem(1);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.images.get('old_image'), photo);
    assert.ok(!f.toasts.includes('已删除'));
    await f.DB.init(); assert.deepEqual(f.snapshot(), before);
});

test('successful part deletion removes part, inventory and history together', async () => {
    const f = fixture(); await f.DB.init(); await f.partsManager.deleteItem(1);
    for (const n of ['parts', 'inventory', 'records']) assert.equal((await f.DB.all(n)).length, 0);
    assert.equal(f.toasts.at(-1), '已删除');
    // Restored parts and price sheets can legitimately share an image key.
    assert.equal(f.images.get('old_image'), photo);
});

test('restore journal survives interruption and restores all five tables at startup', async () => {
    const f = fixture(); const before = f.snapshot();
    const previous = Object.fromEntries(names.map((n, i) => ['parts_manager_' + n, before[i]]));
    f.storage.setItem('parts_manager_stock_journal', JSON.stringify(previous));
    f.storage.setItem('parts_manager_parts', '[]'); f.storage.setItem('parts_manager_prices', '[]');
    await f.DB.init(); assert.deepEqual(f.snapshot(), before);
    assert.equal(f.storage.getItem('parts_manager_stock_journal'), null);
});

test('restore blocks concurrent price saves and stock changes until it finishes', async () => {
    const f = fixture(); await f.DB.init(); const pending = f.exportManager.restoreBackup(backup());
    assert.equal(f.partsManager._stockBusy, true);
    f.priceManager.save({ preventDefault() {} });
    const deletion = f.partsManager.deleteItem(1);
    const duplicate = f.exportManager.restoreBackup(backup());
    await assert.rejects(duplicate, /正在处理/);
    await deletion;
    await pending; assert.equal((await f.DB.all('prices')).length, 1); assert.equal((await f.DB.all('parts')).length, 1);
});

test('failed photo and price-table deletions do not delete their image blobs', async () => {
    const f = fixture(); await f.DB.init();
    f.partsManager._pendingDeleteId = 1; f.fail('parts'); await f.partsManager.confirmDeletePhoto();
    assert.equal((await f.DB.get('parts', 1)).image, 'old_image');
    f.fail('prices'); await f.priceManager.deleteItem(1);
    assert.equal((await f.DB.get('prices', 1)).image, 'old_image');
    assert.equal(f.images.get('old_image'), photo);
});

for (const options of [{ readFailure: true }, { readAbort: true }, { unavailable: true }]) test('incomplete image export cannot produce a successful backup: ' + JSON.stringify(options), async () => {
    const f = fixture(options); await f.DB.init();
    await assert.rejects(f.exportManager._buildBackupBlob(), /图片/);
    assert.equal(f.images.get('old_image'), photo);
});

test('manual export and auto backup receive only their own serialized save results', async () => {
    const f = fixture(); await f.DB.init();
    f.app._initialized = true; f.app.autoBackupEnabled = true; f.DB.markBackupDirty();
    f.exportManager._pendingExport = { blob: new Blob(['manual']), fileName: 'manual.json' };
    const manual = f.exportManager.confirmDownload(); await tick();
    const automatic = f.app.doAutoBackup(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'saveFile');
    f.window._onSaveFileResult('success:manual.json'); await manual; await tick();
    assert.equal(f.DB.isBackupDirty(), true); assert.equal(f.calls[1].method, 'saveFileReplace');
    f.window._onSaveFileResult('success:manual.json'); assert.equal(f.DB.isBackupDirty(), true);
    f.window._onSaveFileResult('success:配件库存自动备份.json'); await automatic;
    assert.equal(f.DB.isBackupDirty(), false);
});

test('failed auto backup and edits during a successful save retain the dirty flag', async () => {
    const f = fixture(); await f.DB.init(); f.app._initialized = true; f.app.autoBackupEnabled = true; f.DB.markBackupDirty();
    let pending = f.app.doAutoBackup(); await tick();
    f.window._onSaveFileResult('error:full'); await pending; assert.equal(f.DB.isBackupDirty(), true);
    pending = f.app.doAutoBackup(); await tick(); f.DB.markBackupDirty();
    f.window._onSaveFileResult('success:配件库存自动备份.json'); await pending;
    assert.equal(f.DB.isBackupDirty(), true);
});

test('late save callbacks after timeout cannot complete the next file save', async () => {
    const f = fixture(); f.app._nativeSaveTimeoutMs = 5;
    const old = f.app.saveNative('saveFile', 'x', 'old.json');
    const queued = f.app.saveNative('saveFile', 'x', 'queued.json');
    await Promise.all([assert.rejects(old, /未返回/), assert.rejects(queued, /尚未结束/)]);
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.app.saveNative('saveFile', 'x', 'new.json'), /尚未结束/);
    f.window._onSaveFileResult('success:old.json');
    const fresh = f.app.saveNative('saveFile', 'x', 'new.json');
    f.window._onSaveFileResult('success:old.json'); assert.equal(f.app._nativeSaveActive.fileName, 'new.json');
    f.window._onSaveFileResult('success:new.json'); await fresh;
});

test('save queue handles synchronous native callbacks, thrown calls and photo success', async () => {
    const f = fixture();
    f.window.AndroidBridge.saveFile = () => { throw new Error('bridge failed'); };
    await assert.rejects(f.app.saveNative('saveFile', 'x', 'file.json'), /bridge failed/);
    f.window.AndroidBridge.saveImage = (...args) => {
        assert.equal(args.length, 2);
        f.window._onSaveFileResult('success:图片已保存到 Downloads/PartsManager');
    };
    await f.app.saveNative('saveImage', photo, 'photo.jpg');
    assert.equal(f.app._nativeSaveActive, null);
});

test('manual save completion cannot clear a newer pending export', async () => {
    const f = fixture(); f.exportManager._pendingExport = { blob: new Blob(['x']), fileName: 'old.json' };
    const pending = f.exportManager.confirmDownload(); await tick();
    f.exportManager._pendingExport = { blob: new Blob(['new']), fileName: 'new.json' };
    f.window._onSaveFileResult('success:old.json'); await pending;
    assert.equal(f.exportManager._pendingExport.fileName, 'new.json');
});
