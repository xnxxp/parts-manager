const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sharedFiles = ['www/index.html', 'www/js/app.js', 'www/js/parts.js', 'www/js/export.js'];
const before = sharedFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
execFileSync(process.execPath, [path.join(root, 'scripts/prepare-ios.js')], { cwd: root });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const storage = new Map();
    for (const name of ['parts', 'inventory', 'records', 'warehouses', 'prices']) storage.set('parts_manager_' + name, '[]');
    const callbacks = new Map(), elements = new Map(), calls = [], toasts = [], intervals = [];
    const context = vm.createContext({ Blob, setTimeout, clearTimeout, setInterval: callback => { intervals.push(callback); },
        console: { error() {}, warn() {}, log() {} }, navigator: {},
        localStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, String(value)), removeItem: name => storage.delete(name) },
        indexedDB: { open() { const req = {}; queueMicrotask(() => req.onerror()); return req; } },
        FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(buffer => {
            this.result = 'data:application/json;base64,' + Buffer.from(buffer).toString('base64');
            this.onload({ target: { result: this.result } });
        }); } },
        addEventListener() {},
        document: { hidden: false, addEventListener(name, callback) { callbacks.set(name, callback); },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', value: '', style: {} });
                return elements.get(id);
            } },
        cordova: { exec(resolve, reject, service, method, args) { calls.push({ resolve, reject, service, method, args }); } }
    });
    context.window = context;
    for (const [file, api] of [['database', 'DB'], ['app', 'app'], ['stock', 'Stock'], ['parts', 'partsManager'], ['export', 'exportManager']]) {
        vm.runInContext(fs.readFileSync(path.join(root, `build/ios-project/www/js/${file}.js`), 'utf8') + `\nglobalThis.${api} = ${api};`, context);
    }
    context.app.showToast = text => toasts.push(text);
    context.app._openModal = context.app._closeModal = () => {};
    vm.runInContext(fs.readFileSync(path.join(root, 'ios/web/ios-platform.js'), 'utf8'), context);
    return { context, calls, toasts, intervals, elements, storage, ready: () => callbacks.get('deviceready')() };
}

test('iOS target preparation preserves every shared Android source file', () => {
    assert.deepEqual(sharedFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
    const config = fs.readFileSync(path.join(root, 'build/ios-project/config.xml'), 'utf8');
    assert.ok(config.includes(require('../ios/build-settings.json').bundleId));
    const html = fs.readFileSync(path.join(root, 'build/ios-project/www/index.html'), 'utf8');
    assert.ok(html.indexOf('src="cordova.js"') < html.indexOf('src="js/app.js"'));
    assert.ok(html.indexOf('src="js/ios-platform.js"') > html.indexOf('src="js/export.js"'));
    assert.ok(!html.includes('Download/PartsManager'));
    assert.ok(html.includes('卸载应用会删除'));
});

test('iOS saves wait for Cordova readiness and keep each callback attached to its own request', async () => {
    const f = fixture();
    const first = f.context.app.saveNative('saveFile', 'YQ==', 'one.json', 'application/json');
    const second = f.context.app.saveNative('saveImage', 'data:image/jpeg;base64,Yg==', 'two.jpg');
    await tick(); assert.equal(f.calls.length, 0);
    f.ready(); await tick(); assert.equal(f.calls.length, 2);
    f.calls[1].resolve('second'); f.calls[0].resolve('first');
    assert.equal(await first, 'first'); assert.equal(await second, 'second');
    assert.equal(f.calls[0].service, 'PartsIOS');
    assert.equal(f.calls[0].args[1], 'one.json');
});

test('cancelled iOS export is not reported as a saved file', async () => {
    const f = fixture(); f.ready();
    f.context.exportManager._pendingExport = { blob: new Blob(['backup']), fileName: 'backup.json' };
    const pending = f.context.exportManager.confirmDownload(); await tick();
    assert.equal(f.calls[0].method, 'saveFile');
    f.calls[0].reject('保存已取消'); await pending;
    assert.deepEqual(f.toasts, ['保存已取消']);
});

test('iOS auto backup clears the dirty flag only after native success for the same revision', async () => {
    const f = fixture(); f.ready(); f.context.app._initialized = true;
    f.context.DB.markBackupDirty();
    const failed = f.context.app.doAutoBackup(); await tick();
    assert.equal(f.calls[0].method, 'saveFileReplace');
    assert.equal(f.context.DB.isBackupDirty(), true);
    f.calls[0].reject('disk full'); await failed;
    assert.equal(f.context.DB.isBackupDirty(), true);
    const changed = f.context.app.doAutoBackup(); await tick();
    f.context.DB.markBackupDirty(); f.calls[1].resolve('saved'); await changed;
    assert.equal(f.context.DB.isBackupDirty(), true);
    const complete = f.context.app.doAutoBackup(); await tick();
    f.calls[2].resolve('saved'); await complete;
    assert.equal(f.context.DB.isBackupDirty(), false);
});

test('iOS photo selection reaches the existing image callback and releases its registry entry', async () => {
    const f = fixture(); f.ready(); let photo;
    f.context.app.takePicture(value => { photo = value; }, 'gallery'); await tick();
    assert.equal(f.calls[0].method, 'takePicture');
    assert.equal(f.calls[0].args[0], 'gallery');
    f.calls[0].resolve('data:image/jpeg;base64,YWJj'); await tick();
    assert.equal(photo, 'data:image/jpeg;base64,YWJj');
    assert.equal(Object.keys(f.context.app._cameraCallbacks).length, 0);
});

test('cancelled iOS camera releases its callback and does not select an old photo', async () => {
    const f = fixture(); f.ready(); let called = false;
    f.context.app.takePicture(() => { called = true; }, 'camera'); await tick();
    f.calls[0].reject('已取消照片选择'); await tick();
    assert.equal(called, false);
    assert.equal(Object.keys(f.context.app._cameraCallbacks).length, 0);
});

test('iOS image saving calls the native file exporter and reports failures', async () => {
    const f = fixture(); f.ready();
    f.context.partsManager._saveImageSrc = 'data:image/jpeg;base64,YWJj';
    const pending = f.context.partsManager.saveCurrentImage(); await tick();
    assert.equal(f.calls[0].method, 'saveImage');
    f.calls[0].reject('保存已取消'); await pending;
    assert.deepEqual(f.toasts, ['正在保存...', '保存已取消']);
});

test('iOS foreground backup check runs without waiting for the app to exit', () => {
    const f = fixture(); f.ready();
    f.storage.set('pm_backup_tip_seen', '1');
    let backups = 0; f.context.app.doAutoBackup = () => { backups++; };
    f.context.app._initAutoBackup();
    assert.equal(backups, 1);
    f.intervals[0](); assert.equal(backups, 2);
    f.context.document.hidden = true;
    f.intervals[0](); assert.equal(backups, 2);
});
