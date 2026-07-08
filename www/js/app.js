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

const app = {
    currentPage: 'home',
    currentImageData: null,
    currentExcelData: null,
    _backStack: [],
    _modalStack: [],

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
        try {
            await DB.init();
            if ('serviceWorker' in navigator) {
                try { await navigator.serviceWorker.register('./service-worker.js'); } catch(e) {}
            }
        } catch (e) {
            console.error('DB init failed:', e);
        }
        document.getElementById('splash').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        const fab = document.getElementById('fab-add');
        if (fab) fab.style.display = '';
        this.refreshDashboard();

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
                    partsManager.showSaveImageModal(longPressTarget.src);
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
        if (page === 'price') priceManager.load();
    },

    refreshDashboard() {
        this.updateStatsBar();
        if (this.currentPage === 'home') {
            partsManager.load();
        }
    },

    async updateStatsBar() {
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const records = await DB.all('records');

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
        document.getElementById('stat-stock').textContent = inventory.reduce((s, r) => s + (r.qty || 0), 0);

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

    // Called by native AndroidBridge when camera/gallery result is ready
    _onCameraResult(id, data) {
        var cb = this._cameraCallbacks[id];
        if (cb) {
            delete this._cameraCallbacks[id];
            if (data.indexOf('__ERROR__:') === 0) {
                console.warn('Camera error:', data);
            } else {
                cb(data);
            }
        }
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
    }
};

// ===== REGISTER BACK BUTTON IMMEDIATELY (sync, top-level) =====
// This runs as soon as the script is parsed - BEFORE any async code
document.addEventListener('backbutton', app._backHandler, false);

// Also wait for deviceready to ensure Cordova is fully loaded
document.addEventListener('deviceready', () => {
    // Re-register to be absolutely sure
    document.addEventListener('backbutton', app._backHandler, false);
}, false);

document.addEventListener('DOMContentLoaded', () => app.init());
