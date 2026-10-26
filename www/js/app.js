// app.js - Parts Inventory Manager
// Global error handler - shows error on screen for user to screenshot
window.onerror = function(msg, url, line) {
    console.error('APP ERROR:', msg, 'at', url + ':' + line);
    showErrorOverlay(msg + '\nat ' + url + ':' + line);
    return false;
};
window.addEventListener('unhandledrejection', function(e) {
    console.error('UNHANDLED REJECTION:', e.reason);
    var msg = e.reason;
    if (msg instanceof Error) msg = msg.message + '\n' + msg.stack;
    showErrorOverlay('Promise Error:\n' + msg);
});

function showErrorOverlay(text) {
    var el = document.getElementById('error-overlay');
    var txt = document.getElementById('error-text');
    if (el && txt) {
        txt.textContent = text;
        el.style.display = 'block';
    }
}

// Escape user-controlled strings before inserting into HTML (text or attribute).
// Defends against XSS via part name/note/category/price-table title etc.
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const app = {
    currentPage: 'home',
    currentImageData: null,   // base64 shown in edit preview (in-memory)
    currentImageId: null,     // reference id stored in part.image (IndexedDB key)
    currentExcelData: null,
    _backStack: [],
    _modalStack: [],
    _nativeSaveQueue: [],
    _nativeSaveActive: null,
    _nativeSaveTimeoutMs: 30000,

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reader.onabort = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(blob);
        });
    },

    // The existing Android shell reports one untagged callback. Serialize all
    // three save APIs so each result belongs to exactly one pending operation.
    saveNative(method, data, fileName, mimeType) {
        const bridge = window.AndroidBridge;
        if (!bridge || typeof bridge[method] !== 'function') return Promise.reject(new Error('文件保存不可用'));
        if (this._nativeSaveActive?.timedOut) return Promise.reject(new Error('上一次保存尚未结束，请稍后再试'));
        return new Promise((resolve, reject) => {
            this._nativeSaveQueue.push({ method, data, fileName, mimeType, resolve, reject });
            this._pumpNativeSave();
        });
    },

    _pumpNativeSave() {
        if (this._nativeSaveActive || !this._nativeSaveQueue.length) return;
        const job = this._nativeSaveActive = this._nativeSaveQueue.shift();
        const finish = (error, result) => {
            if (this._nativeSaveActive !== job) return;
            clearTimeout(job.timer);
            this._nativeSaveActive = null;
            if (!job.timedOut) error ? job.reject(error) : job.resolve(result);
            this._pumpNativeSave();
        };
        window._onSaveFileResult = result => {
            if (typeof result !== 'string') return;
            if (result.startsWith('error:')) finish(new Error('保存失败：' + result.slice(6)));
            else if (result.startsWith('success:')) {
                const expected = job.method === 'saveImage' ? '图片已保存到 Downloads/PartsManager' : job.fileName;
                if (result.slice(8) === expected) finish(null, result);
            }
        };
        job.timer = setTimeout(() => {
            if (this._nativeSaveActive !== job) return;
            job.timedOut = true;
            job.reject(new Error('保存未返回结果，请检查下载目录后重试'));
            for (const queued of this._nativeSaveQueue.splice(0)) queued.reject(new Error('上一次保存尚未结束，请稍后再试'));
            // Keep this slot until the late callback arrives; advancing now
            // would allow that late result to complete the next request.
        }, this._nativeSaveTimeoutMs);
        try {
            if (job.method === 'saveImage') window.AndroidBridge.saveImage(job.data, job.fileName);
            else window.AndroidBridge[job.method](job.data, job.fileName, job.mimeType);
        }
        catch (e) { finish(new Error('保存失败：' + e.message)); }
    },

    // Register back button at SCRIPT LOAD TIME - before anything else runs
    _backHandler: function(e) {
        e.preventDefault();
        e.stopPropagation();

        // Use modal stack - close from top to bottom
        const stack = app._modalStack;
        if (stack.length > 0) {
            const topId = stack[stack.length - 1];
            const m = document.getElementById(topId);
            if (m && m.style.display !== 'none') {
                app._closeModal(topId);
                return false;
            }
            stack.pop();
        }

        const viewer = document.getElementById('modal-image-viewer');
        if (viewer && viewer.style.display === 'flex') {
            app.closeImageViewer();
            return false;
        }

        // Nothing open - show exit confirmation (only if not already showing)
        const exitModal = document.getElementById('modal-exit');
        if (exitModal && exitModal.style.display !== 'flex') {
            exitModal.style.display = 'flex';
            app._openModal('modal-exit');
        }
        return false;
    },

    _openModal(id) {
        const m = document.getElementById(id);
        if (!m) return;
        // If this modal is currently closing, cancel the close animation immediately
        m.classList.remove('modal-closing');
        const pendingTimeouts = m._pendingCloseTimeouts;
        if (pendingTimeouts) {
            pendingTimeouts.forEach(t => clearTimeout(t));
            m._pendingCloseTimeouts = null;
        }
        m.style.display = '';
        app._modalStack.push(id);
    },

    _closeModal(id) {
        const m = document.getElementById(id);
        if (!m || m.style.display === 'none') return;
        if (id === 'modal-import' && !exportManager.beforeCloseImport()) return;
        // Remove from stack
        const idx = app._modalStack.lastIndexOf(id);
        if (idx >= 0) app._modalStack.splice(idx, 1);
        // Trigger exit animation
        m.classList.add('modal-closing');
        const timeouts = [];
        m._pendingCloseTimeouts = timeouts;
        const onEnd = function() {
            m.classList.remove('modal-closing');
            m.style.display = 'none';
            m.removeEventListener('animationend', onEnd);
            const tidx = timeouts.indexOf(t);
            if (tidx >= 0) timeouts.splice(tidx, 1);
        };
        m.addEventListener('animationend', onEnd);
        const t = setTimeout(function() {
            m.classList.remove('modal-closing');
            m.style.display = 'none';
            m.removeEventListener('animationend', onEnd);
            const tidx = timeouts.indexOf(t);
            if (tidx >= 0) timeouts.splice(tidx, 1);
        }, 300);
        timeouts.push(t);
    },

    async init() {
        if (this._initialized) return;
        this._initialized = true;
        try {
            await DB.init();
            if ('serviceWorker' in navigator) {
                try { await navigator.serviceWorker.register('./service-worker.js'); } catch(e) {}
            }
        } catch (e) {
            console.error('DB init failed:', e);
            showErrorOverlay('数据初始化失败：' + e.message);
            return;
        }
        document.getElementById('splash').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        const fab = document.getElementById('fab-add');
        if (fab) fab.style.display = '';
        this.refreshDashboard();
        this._initAutoBackup();

        // Click outside modal content = close modal
        document.addEventListener('click', function(e) {
            const modal = e.target.closest('.modal');
            if (!modal || modal.style.display === 'none') return;
            if (e.target === modal) {
                app._closeModal(modal.id);
            }
        });

        // Prevent image long-press context menu (causes WebView freeze)
        document.addEventListener('contextmenu', function(e) {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
            }
        });

        // Long-press on images to show save dialog
        let longPressTimer = null;
        let longPressTarget = null;
        document.addEventListener('touchstart', function(e) {
            if (e.target.tagName !== 'IMG') return;
            longPressTarget = e.target;
            longPressTimer = setTimeout(function() {
                if (longPressTarget && typeof partsManager !== 'undefined' && partsManager.showSaveImageModal) {
                    const pid = longPressTarget.dataset ? longPressTarget.dataset.partId : null;
                    partsManager.showSaveImageModal(longPressTarget.src, pid);
                }
                longPressTimer = null;
                longPressTarget = null;
            }, 600);
        }, { passive: true });

        document.addEventListener('touchend', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            longPressTarget = null;
        });

        document.addEventListener('touchmove', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            longPressTarget = null;
        });
    },

    navigate(page) {
        this.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const pageEl = document.getElementById('page-' + page);
        if (pageEl) pageEl.classList.add('active');
        const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
        if (navBtn) navBtn.classList.add('active');
        const fab = document.getElementById('fab-add');
        if (fab) fab.style.display = page === 'home' ? '' : 'none';
        if (page === 'home') this.refreshDashboard();
        if (page === 'restock') restockManager.load();
        if (page === 'price') priceManager.load();
        if (page === 'export') {
            const t = document.getElementById('auto-backup-toggle');
            if (t) t.checked = this.autoBackupEnabled;
        }
    },

    refreshDashboard() {
        this.updateStatsBar();
        if (this.currentPage === 'home') {
            partsManager.load();
        }
        if (this.currentPage === 'restock') restockManager.load();
    },

    async updateStatsBar() {
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const records = await DB.all('records');
        const warehouses = await DB.all('warehouses');
        document.getElementById('restock-count').textContent = Stock.replenishment(parts, inventory, warehouses).length;

        // Total value = sum of (unit_price * qty) for all parts with inventory
        const invMap = {};
        inventory.forEach(i => { invMap[i.part_id] = (invMap[i.part_id] || 0) + (i.qty || 0); });
        let totalValue = 0;
        parts.forEach(p => {
            const qty = invMap[p.id] || 0;
            if (qty > 0 && p.unit_price) {
                totalValue += p.unit_price * qty;
            }
        });

        document.getElementById('stat-total-value').textContent = '¥' + totalValue.toLocaleString();
        document.getElementById('stat-parts').textContent = parts.length;
        // Status chips and the header share the search/category/location scope;
        // selecting a status only changes the list, never this partition total.
        partsManager.updateStockTotal(Stock.scope(Stock.rows(parts, inventory, warehouses), partsManager.scopeFilters()));

        if (records.length) {
            records.sort((a, b) => b.created_at - a.created_at);
            const last = records[0];
            document.getElementById('stat-last-time').textContent = this.formatTime(last.created_at);
        } else {
            document.getElementById('stat-last-time').textContent = '无记录';
        }
    },

    formatTime(ts) {
        const d = new Date(ts * 1000);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return d.getMonth() + 1 + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },

    showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.style.display = 'block';
        t.style.animation = 'none';
        t.offsetHeight;
        t.style.animation = 'toastIn 0.3s ease';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => t.style.display = 'none', 2000);
    },

    showImageViewer(src) {
        const img = document.getElementById('viewer-image');
        img.src = src;
        const viewer = document.getElementById('modal-image-viewer');
        viewer._zoomScale = 1;
        viewer._zoomTX = 0;
        viewer._zoomTY = 0;
        img.style.transition = 'transform 0.15s';
        img.style.transform = 'scale(1) translate(0px, 0px)';
        document.getElementById('modal-image-viewer').style.display = 'flex';
        if (!this._zoomInitialized) {
            this._initImageViewerZoom();
            this._zoomInitialized = true;
        }
    },

    _initImageViewerZoom() {
        const viewer = document.getElementById('modal-image-viewer');
        const img = document.getElementById('viewer-image');
        let lastDist = 0, lastX = 0, lastY = 0;

        const getDistance = (touches) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const applyTransform = () => {
            const s = viewer._zoomScale;
            const tx = viewer._zoomTX;
            const ty = viewer._zoomTY;
            img.style.transition = s <= 1 ? 'transform 0.2s' : 'none';
            img.style.transform = 'scale(' + s + ') translate(' + tx + 'px,' + ty + 'px)';
        };

        const resetZoom = () => {
            viewer._zoomScale = 1;
            viewer._zoomTX = 0;
            viewer._zoomTY = 0;
            applyTransform();
        };

        viewer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                lastDist = getDistance(e.touches);
                lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            } else if (e.touches.length === 1 && viewer._zoomScale > 1) {
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
            }
        }, { passive: false });

        viewer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dist = getDistance(e.touches);
                const ratio = dist / Math.max(lastDist, 1);
                viewer._zoomScale = Math.min(Math.max(viewer._zoomScale * ratio, 1), 5);
                lastDist = dist;
                applyTransform();
            } else if (e.touches.length === 1 && viewer._zoomScale > 1) {
                e.preventDefault();
                const dx = e.touches[0].clientX - lastX;
                const dy = e.touches[0].clientY - lastY;
                viewer._zoomTX += dx / viewer._zoomScale;
                viewer._zoomTY += dy / viewer._zoomScale;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
                applyTransform();
            }
        }, { passive: false });

        viewer.addEventListener('touchend', (e) => {
            if (e.touches.length === 0 && viewer._zoomScale < 1.15) {
                resetZoom();
            }
        });

        viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.92 : 1.08;
            viewer._zoomScale = Math.min(Math.max(viewer._zoomScale * delta, 1), 5);
            if (viewer._zoomScale < 1.1) resetZoom();
            else applyTransform();
        }, { passive: false });
    },

    closeImageViewer() {
        const viewer = document.getElementById('modal-image-viewer');
        viewer._zoomScale = 1;
        viewer._zoomTX = 0;
        viewer._zoomTY = 0;
        const img = document.getElementById('viewer-image');
        img.style.transition = 'transform 0.2s';
        img.style.transform = 'scale(1) translate(0px, 0px)';
        viewer.classList.add('modal-closing');
        const onEnd = function() {
            viewer.classList.remove('modal-closing');
            viewer.style.display = 'none';
            viewer.removeEventListener('animationend', onEnd);
        };
        viewer.addEventListener('animationend', onEnd);
        setTimeout(function() {
            viewer.classList.remove('modal-closing');
            viewer.style.display = 'none';
            img.src = '';
        }, 250);
    },

    // Compress a base64 image data URL: scale down to maxDim (longest side)
    // and re-encode as JPEG. Greatly reduces storage size for part photos.
    async compressImage(dataURL, maxDim = 1280, quality = 0.72) {
        return new Promise((resolve, reject) => {
            try {
                const src = dataURL.indexOf('data:') === 0 ? dataURL : 'data:image/jpeg;base64,' + dataURL;
                const img = new Image();
                img.onload = () => {
                    let w = img.naturalWidth || img.width;
                    let h = img.naturalHeight || img.height;
                    if (!w || !h) { resolve(src); return; }
                    // Already within the max dimension -> skip re-encoding. This
                    // avoids a second lossy JPEG pass, notably for photos already
                    // compressed by the native camera bridge (~1024px), which
                    // would otherwise be needlessly re-encoded at lower quality.
                    if (w <= maxDim && h <= maxDim) { resolve(src); return; }
                    if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
                    else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    try { resolve(canvas.toDataURL('image/jpeg', quality)); }
                    catch (e) { resolve(src); } // fallback to original on failure
                };
                img.onerror = () => reject(new Error('image decode failed'));
                img.src = src;
            } catch (e) { reject(e); }
        });
    },

    closeEditStock() {
        document.getElementById('modal-edit-stock').style.display = 'none';
    },

    // Camera callback registry (keyed by unique ID)
    _cameraCallbacks: {},
    _cameraCounter: 0,

    // Called by native AndroidBridge when camera/gallery result is ready
    _processCameraResult(id) {
        // Retrieve the actual data from native via AndroidBridge
        if (window.AndroidBridge && AndroidBridge.retrieveResult) {
            try {
                var data = AndroidBridge.retrieveResult(id);
            } catch (e) {
                data = '';
            }
        } else {
            var data = '';
        }
        var cb = this._cameraCallbacks[id];
        if (cb) {
            delete this._cameraCallbacks[id];
            if (data.indexOf('__ERROR__:') === 0 || data.indexOf('__ERROR__') === 0) {
                console.warn('Camera error:', data);
            } else if (data) {
                cb(data);
            }
        }
    },

    takePicture(callback, mode) {
        // Use native AndroidBridge (bypasses cordova.js plugin system)
        if (window.AndroidBridge) {
            var method = mode === 'camera' ? 'takeCameraPhoto' : 'pickGalleryImage';
            var cbId = 'cam_' + Date.now() + '_' + (++this._cameraCounter);
            this._cameraCallbacks[cbId] = callback;
            AndroidBridge[method](cbId);
            return;
        }

        // Fallback: HTML file input (browser testing only)
        const useCamera = mode !== 'gallery';
        let input = document.getElementById('camera-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
            document.body.appendChild(input);
            input.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function(ev) {
                    input._callbacks.forEach(function(cb) { cb(ev.target.result); });
                    input._callbacks = [];
                };
                reader.readAsDataURL(file);
                setTimeout(function() { input.value = ''; }, 100);
            });
        }
        if (useCamera) {
            input.setAttribute('capture', 'environment');
        } else {
            input.removeAttribute('capture');
        }
        input.style.display = ''; input.style.position = 'absolute';
        input.style.left = '-9999px'; input.style.top = '-9999px';
        input.style.width = '1px'; input.style.height = '1px'; input.style.opacity = '0';
        if (!input._callbacks) input._callbacks = [];
        input._callbacks.push(callback);
        input.click();
    },

    confirmExit() {
        // Try native bridge first (most reliable), fallback to Cordova exitApp
        if (window.AndroidBridge && AndroidBridge.finishApp) {
            AndroidBridge.finishApp();
        } else if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
        }
        this.closeExitModal();
    },

    closeExitModal() {
        app._closeModal('modal-exit');
    },

    // ===== Auto backup (data-loss safeguard) =====
    // Backups are written to the shared Download/PartsManager MediaStore collection,
    // which survives "clear app data". When the app goes to the background, if any
    // data changed since the last backup, a single rolling file is re-written silently.
    autoBackupEnabled: true,

    _initAutoBackup() {
        try { this.autoBackupEnabled = localStorage.getItem('pm_auto_backup') !== '0'; } catch (e) {}
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.doAutoBackup();
        });
        window.addEventListener('pagehide', () => this.doAutoBackup());
        this._maybeShowBackupTip();
    },

    setAutoBackup(enabled) {
        this.autoBackupEnabled = !!enabled;
        try { localStorage.setItem('pm_auto_backup', enabled ? '1' : '0'); } catch (e) {}
        app.showToast(enabled ? '已开启自动备份' : '已关闭自动备份');
    },

    async doAutoBackup() {
        if (!this._initialized || !this.autoBackupEnabled) return;
        if (this._autoBackupBusy || partsManager._stockBusy) return;
        if (!DB.isBackupDirty()) return; // nothing changed -> skip
        this._autoBackupBusy = true;
        try {
            const revBefore = DB.getBackupRev ? DB.getBackupRev() : 0;
            const blob = await exportManager._buildBackupBlob();
            const revAfter = DB.getBackupRev ? DB.getBackupRev() : 0;
            // The snapshot is built inside _buildBackupBlob (which awaits image
            // export), so a mutation can land mid-snapshot. Take the LOWER of
            // the two revisions: it may or may not be reflected in the data we
            // captured, and under-reporting only costs one redundant backup.
            const snapshotRev = Math.min(revBefore, revAfter);
            if (window.AndroidBridge && window.AndroidBridge.saveFileReplace) {
                const base64 = await this.blobToBase64(blob);
                await this.saveNative('saveFileReplace', base64, '配件库存自动备份.json', 'application/json');
                if (DB.getBackupRev() === snapshotRev) DB.clearBackupDirty();
            }
        } catch (e) {
            console.warn('auto backup failed', e);
        } finally { this._autoBackupBusy = false; }
    },

    // One-time safety-net tip for users who already have data (nothing to lose yet for new users)
    _maybeShowBackupTip() {
        try { if (localStorage.getItem('pm_backup_tip_seen') === '1') return; } catch (e) {}
        DB.all('parts').then(parts => {
            DB.all('inventory').then(inv => {
                const hasData = (parts && parts.length) || (inv && inv.length);
                if (!hasData) return;
                const m = document.getElementById('modal-backup-tip');
                if (m) app._openModal('modal-backup-tip');
            });
        });
    },

    backupTipNow() {
        app._closeModal('modal-backup-tip');
        try { localStorage.setItem('pm_backup_tip_seen', '1'); } catch (e) {}
        exportManager.backupData();
    },

    backupTipLater() {
        app._closeModal('modal-backup-tip');
        try { localStorage.setItem('pm_backup_tip_seen', '1'); } catch (e) {}
    }
};

// ===== REGISTER BACK BUTTON IMMEDIATELY (sync, top-level) =====
// This runs as soon as the script is parsed - BEFORE any async code
document.addEventListener('backbutton', app._backHandler, false);

// Also wait for deviceready to ensure Cordova is fully loaded
document.addEventListener('deviceready', () => {
    // Re-register to be absolutely sure
    document.addEventListener('backbutton', app._backHandler, false);
    // 兜底：原生 splash 可能未及时隐藏时，确保开屏消失
    try { if (navigator.splashscreen) navigator.splashscreen.hide(); } catch (e) {}
}, false);

document.addEventListener('DOMContentLoaded', () => app.init());
