// Loaded only by the generated iOS target, after the shared application scripts.
(() => {
    const ready = new Promise(resolve => document.addEventListener('deviceready', resolve, { once: true }));
    const call = async (method, args) => {
        await ready;
        return new Promise((resolve, reject) => cordova.exec(resolve,
            error => reject(new Error(typeof error === 'string' ? error : 'iOS 操作失败')), 'PartsIOS', method, args));
    };
    const cameraResults = new Map();
    const takePicture = async (id, mode) => {
        try {
            cameraResults.set(id, await call('takePicture', [mode]));
            app._processCameraResult(id);
        } catch (error) {
            delete app._cameraCallbacks[id];
            app.showToast(error.message);
        }
    };
    // The generated target renames Android-only references to this adapter.
    window.IOSBridge = {
        saveFile: (...args) => call('saveFile', args),
        saveFileReplace: (...args) => call('saveFileReplace', args),
        saveImage: (...args) => call('saveImage', args),
        takeCameraPhoto: id => takePicture(id, 'camera'),
        pickGalleryImage: id => takePicture(id, 'gallery'),
        retrieveResult(id) { const data = cameraResults.get(id) || ''; cameraResults.delete(id); return data; }
    };
    // Cordova correlates callbacks per request; the Android untagged queue is not used.
    app.saveNative = (method, data, name, mimeType) => {
        if (!['saveFile', 'saveFileReplace', 'saveImage'].includes(method)) return Promise.reject(new Error('不支持的保存操作'));
        return call(method, [data, name, mimeType || 'application/octet-stream']);
    };
    const originalInit = app._initAutoBackup;
    app._initAutoBackup = function () {
        originalInit.call(this);
        // Save while active, since iOS may suspend JS immediately on backgrounding.
        setInterval(() => { if (!document.hidden) this.doAutoBackup(); }, 5000);
        this.doAutoBackup();
    };
})();
