// app.js
const app = {
    currentPage: 'dashboard',
    currentImageData: null,
    currentExcelData: null,

    async init() {
        try {
            await DB.init();
            if ('serviceWorker' in navigator) {
                try { await navigator.serviceWorker.register('./service-worker.js'); } catch(e) {}
            }
            setTimeout(() => this.onReady(), 800);
        } catch (e) {
            console.error('DB init failed:', e);
            this.showToast('初始化失败，请刷新重试');
        }
    },

    onReady() {
        document.getElementById('splash').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        this.refreshDashboard();

        // Android back button handling
        document.addEventListener('backbutton', (e) => {
            e.preventDefault();
            this.handleBackButton();
        }, false);
    },

    handleBackButton() {
        const viewer = document.getElementById('modal-image-viewer');
        if (viewer.style.display === 'flex') {
            this.closeImageViewer();
            return;
        }
        const exitModal = document.getElementById('modal-exit');
        if (exitModal.style.display === 'flex') {
            this.closeExitModal();
            return;
        }
        // Show exit confirmation
        document.getElementById('modal-exit').style.display = 'flex';
    },

    confirmExit() {
        if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
        } else {
            this.showToast('请使用系统返回键退出');
        }
        this.closeExitModal();
    },

    closeExitModal() {
        document.getElementById('modal-exit').style.display = 'none';
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
        document.getElementById('modal-image-viewer').style.display = 'none';
        img.src = '';
    },

    navigate(page) {
        this.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const pageEl = document.getElementById('page-' + page);
        if (pageEl) pageEl.classList.add('active');
        const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
        if (navBtn) navBtn.classList.add('active');
        if (page === 'dashboard') this.refreshDashboard();
        if (page === 'inventory') inventoryManager.load();
        if (page === 'warehouse') warehouseManager.load();
        if (page === 'price') priceManager.load();
    },

    refreshDashboard() {
        this.renderWarehouseStock();
        this.updateStatsBar();
    },

    async updateStatsBar() {
        const warehouses = await DB.all('warehouses');
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const records = await DB.all('records');

        document.getElementById('stat-warehouse').textContent = warehouses.length;
        document.getElementById('stat-parts').textContent = parts.length;
        document.getElementById('stat-stock').textContent = inventory.reduce((s, r) => s + (r.qty || 0), 0);

        if (records.length) {
            records.sort((a, b) => b.created_at - a.created_at);
            const last = records[0];
            const wh = (await DB.get('warehouses', last.warehouse_id))?.name || '';
            const part = (await DB.get('parts', last.part_id))?.name || '';
            const typeLabel = last.type === 'in' ? '入库' : last.type === 'out' ? '出库' : '调拨';
            document.getElementById('stat-last-time').textContent = this.formatTime(last.created_at);
        } else {
            document.getElementById('stat-last-time').textContent = '无记录';
        }
    },

    async renderWarehouseStock() {
        const warehouses = await DB.all('warehouses');
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');

        const partMap = {}; parts.forEach(p => partMap[p.id] = p);

        // Group inventory by warehouse
        const whInventory = {};
        warehouses.forEach(w => { whInventory[w.id] = []; });
        inventory.forEach(i => {
            if (whInventory[i.warehouse_id]) {
                whInventory[i.warehouse_id].push({
                    ...i,
                    part_name: partMap[i.part_id]?.name || '未知',
                    part_brand: partMap[i.part_id]?.brand || ''
                });
            }
        });

        const el = document.getElementById('warehouse-stock-list');
        if (!warehouses.length) {
            el.innerHTML = '<div class="card"><p class="empty-text">&#127970; 暂无仓库，请先添加仓库</p></div>';
            return;
        }

        let html = '';
        for (const wh of warehouses) {
            const items = whInventory[wh.id] || [];
            const totalItems = items.reduce((s, i) => s + (i.qty || 0), 0);
            const hasStock = items.length > 0;

            html += `
            <div class="wh-accordion">
                <div class="wh-header" onclick="app.toggleWarehouse(${wh.id})">
                    <div class="wh-header-left">
                        <span class="wh-arrow" id="wh-arrow-${wh.id}">&#9654;</span>
                        <div>
                            <div class="wh-name">&#127970; ${wh.name}</div>
                            <div class="wh-meta">${wh.location || ''} ${wh.note ? '· ' + wh.note : ''}</div>
                        </div>
                    </div>
                    <div class="wh-header-right">
                        <span class="wh-total">${totalItems}件 / ${items.length}种</span>
                    </div>
                </div>
                <div class="wh-body" id="wh-body-${wh.id}" style="display:none;">`;

            if (!hasStock) {
                html += '<p class="empty-text" style="padding:16px;">暂无库存，点击 + 添加配件</p>';
            } else {
                items.forEach(item => {
                    const priceInfo = item.unit_price ? `<span class="stock-price">¥${item.unit_price}</span>` : '';
                    const brandInfo = item.part_brand ? `<span class="stock-brand-tag">[${item.part_brand}]</span>` : '';
                    const conditionTag = item.condition === 'old' ? '<span class="stock-condition condition-old-tag">旧</span>' : '<span class="stock-condition condition-new-tag">新</span>';
                    html += `
                    <div class="stock-row" onclick="if(!event.target.closest('button'))app.editStock(${wh.id},${item.part_id})">
                        <div class="stock-info">
                            <div class="stock-name">${item.part_name}</div>
                            <div class="stock-sub-info">${brandInfo}${conditionTag}${priceInfo}</div>
                        </div>
                        <div class="stock-controls">
                            <button class="stock-btn stock-minus" onclick="event.stopPropagation();app.quickStock(${wh.id},'out',${item.part_id})">−</button>
                            <span class="stock-qty" id="stock-qty-${item.part_id}-${wh.id}">${item.qty || 0}</span>
                            <button class="stock-btn stock-plus" onclick="event.stopPropagation();app.quickStock(${wh.id},'in',${item.part_id})">+</button>
                            <button class="btn-edit-sm" onclick="event.stopPropagation();app.editStock(${wh.id},${item.part_id})">&#9998;</button>
                        </div>
                    </div>`;
                });
            }

            html += '</div></div>';
        }

        el.innerHTML = html;
    },

    toggleWarehouse(whId) {
        const body = document.getElementById('wh-body-' + whId);
        const arrow = document.getElementById('wh-arrow-' + whId);
        if (body.style.display === 'none') {
            body.style.display = 'block';
            arrow.style.transform = 'rotate(90deg)';
        } else {
            body.style.display = 'none';
            arrow.style.transform = 'rotate(0deg)';
        }
    },

    async editStock(warehouseId, partId) {
        const part = await DB.get('parts', partId);
        if (!part) return;
        const inventory = await DB.all('inventory');
        const inv = inventory.find(i => i.part_id === partId && i.warehouse_id === warehouseId);
        if (!inv) return;

        document.getElementById('edit-stock-wh-id').value = warehouseId;
        document.getElementById('edit-stock-part-id').value = partId;
        document.getElementById('edit-stock-title').textContent = '编辑配件';
        document.getElementById('edit-stock-name').value = part.name;
        document.getElementById('edit-stock-brand').value = part.brand || '';
        document.getElementById('edit-stock-qty').value = inv.qty || 0;
        document.getElementById('edit-stock-price').value = inv.unit_price || '';
        document.getElementById('edit-stock-delete-btn').style.display = 'block';
        document.getElementById('modal-edit-stock').style.display = 'flex';
    },

    async saveEditStock(e) {
        e.preventDefault();
        const warehouseId = parseInt(document.getElementById('edit-stock-wh-id').value);
        const partId = parseInt(document.getElementById('edit-stock-part-id').value);
        const name = document.getElementById('edit-stock-name').value.trim();
        const brand = document.getElementById('edit-stock-brand').value.trim();
        const qty = parseInt(document.getElementById('edit-stock-qty').value);
        const unitPrice = parseFloat(document.getElementById('edit-stock-price').value) || null;

        if (!name) { this.showToast('请输入配件名称'); return; }
        if (isNaN(qty) || qty < 0) { this.showToast('请输入有效数量'); return; }

        // Update part info
        await DB.run('parts', { id: partId, name, brand });

        // Update inventory
        const inventory = await DB.all('inventory');
        const inv = inventory.find(i => i.part_id === partId && i.warehouse_id === warehouseId);
        if (inv) {
            inv.qty = qty;
            if (unit_price !== null) inv.unit_price = unitPrice;
            await DB.run('inventory', inv);
        }

        this.closeEditStock();
        this.renderWarehouseStock();
        this.showToast('已保存');
    },

    async deleteStockItem() {
        const warehouseId = parseInt(document.getElementById('edit-stock-wh-id').value);
        const partId = parseInt(document.getElementById('edit-stock-part-id').value);
        if (!confirm('确定删除此配件的库存记录？')) return;

        const inventory = await DB.all('inventory');
        const inv = inventory.find(i => i.part_id === partId && i.warehouse_id === warehouseId);
        if (inv) {
            await DB.deleteItem('inventory', inv.id);
        }
        this.closeEditStock();
        this.renderWarehouseStock();
        this.showToast('已删除');
    },

    closeEditStock() {
        document.getElementById('modal-edit-stock').style.display = 'none';
    },


    async quickStock(warehouseId, type, partId) {
        // 立即更新UI（乐观更新），再同步数据库
        const qtyEl = document.getElementById('stock-qty-' + partId + '-' + warehouseId);
        if (type === 'in') {
            if (!partId) return;
            const inventory = await DB.all('inventory');
            const inv = inventory.find(i => i.part_id === partId && i.warehouse_id === warehouseId);
            const currentQty = inv ? (inv.qty || 0) : 0;
            const newQty = currentQty + 1;
            // 先更新UI
            if (qtyEl) qtyEl.textContent = newQty;
            const part = await DB.get('parts', partId);
            // 再写数据库
            if (inv) { inv.qty = newQty; await DB.run('inventory', inv); }
            else { await DB.run('inventory', { part_id: partId, warehouse_id: warehouseId, qty: 1 }); }
            await DB.run('records', { type: 'in', part_id, warehouse_id: warehouseId, qty: 1 });
            this.showToast('入库 +1：' + (part?.name || '?') + ' (共' + newQty + ')');
        } else {
            if (!partId) return;
            const inventory = await DB.all('inventory');
            const inv = inventory.find(i => i.part_id === partId && i.warehouse_id === warehouseId);
            const currentQty = inv ? (inv.qty || 0) : 0;
            if (currentQty <= 0) { this.showToast('库存不足'); return; }
            const newQty = currentQty - 1;
            // 先更新UI
            if (qtyEl) qtyEl.textContent = newQty;
            const part = await DB.get('parts', partId);
            // 再写数据库
            inv.qty = newQty;
            await DB.run('inventory', inv);
            await DB.run('records', { type: 'out', part_id: partId, warehouse_id: warehouseId, qty: 1 });
            this.showToast('出库 -1：' + (part?.name || '?') + ' (剩余' + newQty + ')');
        }
        this.updateStatsBar();
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

    takePicture(callback) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => callback(ev.target.result);
            reader.readAsDataURL(file);
        };
        input.click();
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
