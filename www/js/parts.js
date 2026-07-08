// parts.js - Parts management (home page with list, search, categories, FAB form)
const partsManager = {
    editingId: null,
    customCategories: [],
    currentFilter: '',

    getCategoryColor(cat) {
        const map = {
            '屏幕': '#4F6EF7', '电池': '#f59e0b', '排线': '#10b981',
            '摄像头': '#8b5cf6', '壳/后盖': '#ec4899', '按键': '#06b6d4',
            '充电口': '#f97316', '扬声器': '#6366f1', '其他': '#94a3b8'
        };
        return map[cat] || '#667eea';
    },

    getCategoryClass(cat) {
        const map = {
            '屏幕': '屏幕', '电池': '电池', '排线': '排线',
            '摄像头': '摄像头', '壳/后盖': '壳/后盖', '按键': '按键',
            '充电口': '充电口', '扬声器': '扬声器', '其他': '其他'
        };
        const c = map[cat] || 'custom';
        return 'cat-' + c.replace('/', '-');
    },

    getDotClass(cat) {
        const map = {
            '屏幕': '屏幕', '电池': '电池', '排线': '排线',
            '摄像头': '摄像头', '壳/后盖': '壳/后盖', '按键': '按键',
            '充电口': '充电口', '扬声器': '扬声器', '其他': '其他'
        };
        const c = map[cat] || 'custom';
        return 'dot-' + c.replace('/', '-');
    },

    async load() {
        await this.buildCategoryChips();
        const search = (document.getElementById('parts-search')?.value || '').trim().toLowerCase();
        let rows = await DB.all('parts');

        if (this.currentFilter) {
            rows = rows.filter(r => r.category === this.currentFilter);
        }
        if (search) {
            rows = rows.filter(r =>
                r.name.toLowerCase().includes(search) ||
                (r.model || '').toLowerCase().includes(search) ||
                (r.brand || '').toLowerCase().includes(search)
            );
        }
        rows.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        this.render(rows);
    },

    filterCategory(cat) {
        this.currentFilter = cat;
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        const chip = document.querySelector(`.cat-chip[data-cat="${cat}"]`);
        if (chip) chip.classList.add('active');
        this.load();
    },

    async buildCategoryChips() {
        const parts = await DB.all('parts');
        const cats = new Set();
        parts.forEach(p => { if (p.category) cats.add(p.category); });
        this.customCategories.forEach(c => cats.add(c));
        // Always include defaults
        ['屏幕', '电池', '排线', '摄像头', '壳/后盖', '按键', '充电口', '扬声器', '其他'].forEach(c => cats.add(c));

        const scroll = document.getElementById('category-scroll');
        // Keep the "全部" button, rebuild the rest
        const allCats = Array.from(cats).sort((a, b) => {
            const order = ['屏幕', '电池', '排线', '摄像头', '壳/后盖', '按键', '充电口', '扬声器', '其他'];
            const ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return a.localeCompare(b, 'zh');
        });

        scroll.innerHTML = '<button class="cat-chip ' + (!this.currentFilter ? 'active' : '') + '" data-cat="" onclick="partsManager.filterCategory(\'\')">全部</button>' +
            allCats.map(c => {
                const color = this.getCategoryColor(c);
                return `<button class="cat-chip ${this.currentFilter === c ? 'active' : ''}" data-cat="${c}" onclick="partsManager.filterCategory('${c}')" style="${this.currentFilter === c ? '' : 'border-left:3px solid ' + color + ';border-radius:12px;'}">${c}</button>`;
            }).join('');
    },

    search() {
        this.load();
    },

    render(rows) {
        const el = document.getElementById('parts-list');
        if (!rows.length) {
            el.innerHTML = '<div class="card" style="text-align:center;padding:32px;"><p class="empty-text">&#128230; 暂无配件，点击右下角 + 添加</p></div>';
            return;
        }

        el.innerHTML = rows.map((r, i) => {
            const color = this.getCategoryColor(r.category);
            const catClass = this.getCategoryClass(r.category);
            const dotClass = this.getDotClass(r.category);
            const qty = r.qty || 0;
            const isLow = r.min_stock && qty <= r.min_stock;
            const lowClass = isLow ? ' low-stock' : '';
            const qtyColor = isLow ? 'color:#e74c3c;' : '';

            return `<div class="part-item ${catClass}${lowClass}" data-part-id="${r.id}" style="animation-delay:${i * 0.03}s;" onclick="if(!event.target.closest('button'))partsManager.viewDetail(${r.id})">
                <div class="part-color-dot ${dotClass}"></div>
                <div class="part-info">
                    <div class="part-name-row">
                        <span class="part-name">${r.name}</span>
                    </div>
                    <div class="part-meta-row">
                        <span style="color:${color};font-weight:600;">${r.category}</span>
                        <span class="meta-sep">|</span>
                        <span>${r.condition === 'old' ? '旧件' : '新件'}</span>
                        ${r.brand ? '<span class="meta-sep">|</span><span>' + r.brand + '</span>' : ''}
                        ${r.location ? '<span class="meta-sep">|</span><span class="part-location">&#128205; ' + r.location + '</span>' : ''}
                    </div>
                </div>
                <div class="part-stock-section">
                    <span class="part-stock-number" style="${qtyColor}" id="qty-${r.id}">${qty}</span>
                </div>
                <div class="part-controls" onclick="event.stopPropagation();">
                    <button class="stock-btn-circle stock-minus-btn" onclick="partsManager.quickStock(${r.id}, 'out')">&#8722;</button>
                    <button class="stock-btn-circle stock-plus-btn" onclick="partsManager.quickStock(${r.id}, 'in')">&#43;</button>
                    <button class="btn-edit-round" onclick="partsManager.edit(${r.id})">&#9998;</button>
                </div>
            </div>`;
        }).join('');
    },

    // ----- Add/Edit Modal -----
    openAddModal() {
        this.editingId = null;
        document.getElementById('modal-part-title').textContent = '添加配件';
        document.getElementById('part-form').reset();
        document.getElementById('part-category').innerHTML = '<option value="">选择分类</option>' +
            this.getAllCategories().map(c => `<option value="${c}">${c}</option>`).join('');
        document.getElementById('part-image-preview').style.display = 'none';
        app.currentImageData = null;
        document.getElementById('new-cat-row').style.display = 'none';
        document.getElementById('part-delete-btn').style.display = 'none';
        app._openModal('modal-part');
    },

    getAllCategories() {
        const defaults = ['屏幕', '电池', '排线', '摄像头', '壳/后盖', '按键', '充电口', '扬声器', '其他'];
        return Array.from(new Set([...defaults, ...this.customCategories]));
    },

    onCategoryChange() {
        document.getElementById('new-cat-row').style.display = 'none';
    },

    showNewCatInput() {
        document.getElementById('new-cat-row').style.display = 'block';
        document.getElementById('new-category-name').focus();
    },

    addCustomCategory() {
        const input = document.getElementById('new-category-name');
        const name = input.value.trim();
        if (!name) { app.showToast('请输入分类名称'); return; }
        if (this.getAllCategories().includes(name)) { app.showToast('分类已存在'); return; }
        this.customCategories.push(name);
        input.value = '';
        document.getElementById('new-cat-row').style.display = 'none';
        // Update the select
        document.getElementById('part-category').innerHTML = '<option value="">选择分类</option>' +
            this.getAllCategories().map(c => `<option value="${c}">${c}</option>`).join('');
        document.getElementById('part-category').value = name;
        app.showToast('分类已添加');
    },

    edit(id) {
        DB.get('parts', id).then(r => {
            if (!r) return;
            this.editingId = id;
            document.getElementById('modal-part-title').textContent = '编辑配件';
            document.getElementById('part-name').value = r.name;
            document.getElementById('part-category').innerHTML = '<option value="">选择分类</option>' +
                this.getAllCategories().map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c}</option>`).join('');
            document.querySelector('input[name="part-condition"][value="' + (r.condition || 'new') + '"]').checked = true;
            document.getElementById('part-qty').value = r.qty || 0;
            document.getElementById('part-price').value = r.unit_price || '';
            document.getElementById('part-brand').value = r.brand || '';
            document.getElementById('part-location').value = r.location || '';
            document.getElementById('part-model').value = r.model || '';
            document.getElementById('part-min-stock').value = r.min_stock || 1;
            document.getElementById('part-note').value = r.note || '';
            document.getElementById('new-cat-row').style.display = 'none';
            if (r.image) {
                app.currentImageData = r.image;
                const img = document.getElementById('part-image-preview');
                img.src = r.image; img.style.display = 'block';
            } else {
                app.currentImageData = null;
                document.getElementById('part-image-preview').style.display = 'none';
            }
            document.getElementById('part-delete-btn').style.display = 'block';
        });
        app._openModal('modal-part');
    },

    async save(e) {
        e.preventDefault();
        const name = document.getElementById('part-name').value.trim();
        const category = document.getElementById('part-category').value;
        const condition = document.querySelector('input[name="part-condition"]:checked')?.value || 'new';
        const qty = parseInt(document.getElementById('part-qty').value) || 0;
        const unitPrice = parseFloat(document.getElementById('part-price').value) || null;
        const brand = document.getElementById('part-brand').value.trim();
        const location = document.getElementById('part-location').value.trim();
        const model = document.getElementById('part-model').value.trim();
        const minStockVal = parseInt(document.getElementById('part-min-stock').value) || 1;
        const note = document.getElementById('part-note').value.trim();

        if (!name) { app.showToast('请输入配件名称'); return; }
        if (!category) { app.showToast('请选择配件分类'); return; }
        if (!location) { app.showToast('请选择存放位置'); return; }

        const data = { name, category, condition, qty, unit_price: unitPrice, brand, location, model, min_stock: minStockVal, image: app.currentImageData || '' };
        if (note) data.note = note;
        data.updated_at = Math.floor(Date.now() / 1000);

        if (this.editingId) {
            data.id = this.editingId;
            await DB.run('parts', data);
            app.showToast('配件已更新');
        } else {
            data.created_at = Math.floor(Date.now() / 1000);
            const result = await DB.run('parts', data);
            data.id = result.insertId;
            app.showToast('配件已添加');
        }

        // Record the stock change
        const partId = data.id;
        if (qty > 0) {
            const inventory = await DB.all('inventory');
            const inv = inventory.find(i => i.part_id === partId && !i.warehouse_id);
            if (inv) {
                inv.qty = (inv.qty || 0) + qty;
                if (unitPrice) inv.unit_price = unitPrice;
                inv.condition = condition;
                await DB.run('inventory', inv);
            } else {
                await DB.run('inventory', { part_id: partId, qty, condition, unit_price: unitPrice });
            }
            await DB.run('records', { type: 'in', part_id: partId, qty, unit_price: unitPrice, note: '新增配件入库' });
        }

        this.closeModal();
        app.refreshDashboard();
    },

    async quickStock(partId, type) {
        const part = await DB.get('parts', partId);
        if (!part) return;

        const inventory = await DB.all('inventory');
        const inv = inventory.find(i => i.part_id === partId && !i.warehouse_id);
        const currentQty = inv ? (inv.qty || 0) : 0;

        if (type === 'in') {
            const newQty = currentQty + 1;
            if (inv) { inv.qty = newQty; await DB.run('inventory', inv); }
            else { await DB.run('inventory', { part_id: partId, qty: 1, condition: part.condition || 'new' }); }
            await DB.run('records', { type: 'in', part_id: partId, qty: 1 });
            part.qty = newQty;
            await DB.run('parts', { id: partId, qty: newQty, updated_at: Math.floor(Date.now() / 1000) });
            this._updateQtyDOM(partId, newQty, part.min_stock);
            app.showToast('入库 +1');
        } else {
            if (currentQty <= 0) { app.showToast('库存不足'); return; }
            const newQty = currentQty - 1;
            if (inv) { inv.qty = newQty; await DB.run('inventory', inv); }
            else { await DB.run('inventory', { part_id: partId, qty: 0 }); }
            await DB.run('records', { type: 'out', part_id: partId, qty: 1 });
            part.qty = newQty;
            await DB.run('parts', { id: partId, qty: newQty, updated_at: Math.floor(Date.now() / 1000) });
            this._updateQtyDOM(partId, newQty, part.min_stock);
            app.showToast('出库 -1 (剩余' + newQty + ')');
        }
        app.updateStatsBar();
    },

    _updateQtyDOM(partId, qty, minStock) {
        const qtyEl = document.getElementById('qty-' + partId);
        if (!qtyEl) return;
        qtyEl.textContent = qty;
        const row = qtyEl.closest('.part-item');
        if (row) {
            if (minStock && qty <= minStock) {
                row.classList.add('low-stock');
                qtyEl.style.color = '#e74c3c';
            } else {
                row.classList.remove('low-stock');
                qtyEl.style.color = '';
            }
        }
    },

    async viewDetail(id) {
        const part = await DB.get('parts', id);
        if (!part) return;

        const allWarehouses = await DB.all('warehouses');
        const allInventory = await DB.all('inventory');

        const partWh = allInventory.filter(i => i.part_id === id);
        const invMap = {};
        partWh.forEach(i => { invMap[i.warehouse_id] = (invMap[i.warehouse_id] || 0) + (i.qty || 0); });

        let stockHtml = allWarehouses.map(w => {
            const qty = invMap[w.id] || 0;
            return `<div class="stock-wh-item"><span>${w.name} ${w.location ? '('+w.location+')' : ''}</span><span><strong>${qty}</strong> 件</span></div>`;
        }).join('');

        const condLabel = part.condition === 'old' ? '旧件' : '新件';
        const condColor = part.condition === 'old' ? '#e67e22' : '#27ae60';

        document.getElementById('part-detail-content').innerHTML = `
            <div class="detail-section">
                <h4>基本信息</h4>
                <div class="detail-row"><span class="detail-label">名称</span><span class="detail-value">${part.name}</span></div>
                <div class="detail-row"><span class="detail-label">分类</span><span class="detail-value" style="color:${this.getCategoryColor(part.category)};font-weight:700;">${part.category}</span></div>
                <div class="detail-row"><span class="detail-label">新旧件</span><span class="detail-value" style="color:${condColor};font-weight:600;">${condLabel}</span></div>
                ${part.brand ? '<div class="detail-row"><span class="detail-label">供应商</span><span class="detail-value">' + part.brand + '</span></div>' : ''}
                ${part.location ? '<div class="detail-row"><span class="detail-label">存放位置</span><span class="detail-value">&#128205; ' + part.location + '</span></div>' : ''}
                ${part.model ? '<div class="detail-row"><span class="detail-label">适配机型</span><span class="detail-value">' + part.model + '</span></div>' : ''}
                <div class="detail-row"><span class="detail-label">低库存预警</span><span class="detail-value">${part.min_stock || 1} 件</span></div>
                ${part.note ? '<div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">' + part.note + '</span></div>' : ''}
                ${part.unit_price ? '<div class="detail-row"><span class="detail-label">单价</span><span class="detail-value" style="color:#e67e22;">¥' + part.unit_price + '</span></div>' : ''}
                ${part.image ? '<div style="margin-top:8px;"><img src="' + part.image + '" style="max-width:100%;border-radius:8px;" onclick="app.showImageViewer(this.src)"></div>' : ''}
            </div>
            <div class="detail-section">
                <h4>库存分布</h4>
                <div class="stock-by-warehouse">${stockHtml || '<p style="color:#aaa;font-size:13px;">暂无库存分布</p>'}</div>
            </div>
            <div class="form-actions">
                <button class="btn-primary" onclick="partsManager.quickStockFromDetail(${part.id});partsManager.closeDetail();">&#43; 入库</button>
                <button class="btn-secondary" onclick="partsManager.closeDetail();partsManager.edit(${part.id});">编辑</button>
            </div>
        `;
        app._openModal('modal-part-detail');
    },

    async quickStockFromDetail(partId) {
        await this.quickStock(partId, 'in');
    },

    closeDetail() {
        app._closeModal('modal-part-detail');
    },

    closeModal() {
        app._closeModal('modal-part');
        this.editingId = null;
        document.getElementById('new-cat-row').style.display = 'none';
    },

    showPhotoModal() {
        app._openModal('modal-photo-picker');
    },

    closePhotoModal() {
        app._closeModal('modal-photo-picker');
    },

    showSaveImageModal(imgSrc) {
        this._saveImageSrc = imgSrc;
        app._openModal('modal-save-image');
    },

    closeSaveImageModal() {
        app._closeModal('modal-save-image');
    },

    saveCurrentImage() {
        const src = this._saveImageSrc;
        this._saveImageSrc = null;
        this.closeSaveImageModal();
        if (!src || !window.AndroidBridge || !AndroidBridge.saveImage) {
            app.showToast('保存失败');
            return;
        }
        app.showToast('正在保存...');
        var name = 'IMG_' + Date.now() + '.jpg';
        AndroidBridge.saveImage(src, name);
        window._onSaveFileResult = function(result) {
            if (result.indexOf('success') === 0) {
                app.showToast('图片已保存');
            } else {
                app.showToast('保存失败');
            }
        };
    },

    async deleteCurrentImage() {
        const src = this._saveImageSrc;
        this._saveImageSrc = null;
        this.closeSaveImageModal();
        if (!src) { app.showToast('empty'); return; }

        // Delete from IndexedDB (scan all entries)
        const allImages = await DB.exportAllImages();
        let found = false;
        for (const [key, value] of Object.entries(allImages)) {
            if (value === src) {
                await DB.deleteImageData(key);
                found = true;
            }
        }

        // Clear from any part record that has this image
        const parts = await DB.all('parts');
        for (const p of parts) {
            if (p.image === src) {
                p.image = '';
                await DB.run('parts', p);
                found = true;
            }
        }

        app.showToast(found ? '图片已删除' : '未找到该图片');
        this.load();
        app.refreshDashboard();
    },

    takePhoto(mode) {
        app.takePicture(data => {
            app.currentImageData = data;
            const img = document.getElementById('part-image-preview');
            img.src = data; img.style.display = 'block';
        }, mode);
    },

    async deleteItem(id) {
        const inventory = await DB.all('inventory');
        inventory.filter(i => i.part_id === id).forEach(i => DB.deleteItem('inventory', i.id));
        const records = await DB.all('records');
        records.filter(r => r.part_id === id).forEach(r => DB.deleteItem('records', r.id));
        await DB.deleteItem('parts', id);
        app.showToast('已删除');
        this.closeModal();
        this.load();
        app.updateStatsBar();
    },

    confirmDelete() {
        if (!this.editingId) return;
        this.deleteItem(this.editingId);
    }
};
