// parts.js - Parts management (home page with list, search, categories, FAB form)
const partsManager = {
    editingId: null,
    customCategories: [],
    currentFilter: '',
    currentStatus: '',
    currentLocation: '',
    _loadRevision: 0,
    PAGE_SIZE: 30,
    _allRows: [],
    _rendered: 0,
    _listObserver: null,
    _searchTimer: null,
    _stockBusy: false,   // guard: ignore rapid +/- taps while a stock op is in flight
    _detailPartId: null,
    _historyLimit: 10,

    getCategoryColor(cat) {
        const map = {
            '屏幕': '#626f55', '电池': '#f59e0b', '排线': '#10b981',
            '摄像头': '#8b5cf6', '壳/后盖': '#ec4899', '按键': '#06b6d4',
            '充电口': '#f97316', '扬声器': '#6366f1', '其他': '#94a3b8'
        };
        return map[cat] || '#71815f';
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
        const revision = ++this._loadRevision;
        await this.buildCategoryChips();
        if (revision !== this._loadRevision) return;
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const warehouses = await DB.all('warehouses');
        if (revision !== this._loadRevision) return;
        let rows = Stock.rows(parts, inventory, warehouses);
        const names = Array.from(new Set(rows.flatMap(r => r.locations.map(i => i.location))))
            .sort((a, b) => a.localeCompare(b, 'zh'));
        if (this.currentLocation && !names.includes(this.currentLocation)) this.currentLocation = '';
        const select = document.getElementById('location-filter');
        select.innerHTML = '<option value="">全部位置</option>' + names.map(name =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        select.value = this.currentLocation;

        rows = Stock.scope(rows, this.scopeFilters());
        const counts = this.updateStockTotal(rows);
        document.getElementById('category-filter-label').textContent = this.currentFilter || '全部';
        document.getElementById('home-filter-reset').hidden = !(this.currentFilter || this.currentStatus ||
            this.currentLocation || document.getElementById('parts-search').value.trim());
        document.getElementById('stock-filters').innerHTML = [
            ['', '全部'], ['available', '库存充足'], ['low', '快用完'], ['empty', '已用完']
        ].map(([value, label]) => `<button type="button" data-status="${value}" aria-pressed="${this.currentStatus === value}"
            class="stock-filter ${this.currentStatus === value ? 'active' : ''} ${value}"
            onclick="partsManager.filterStatus(this.dataset.status)">${label} <span>${counts[value]} ${value === 'empty' ? '种' : '件'}</span></button>`).join('');
        if (this.currentStatus) rows = rows.filter(r => Stock.status(r.displayQty, r.min_stock) === this.currentStatus);
        // Sort by stock urgency, then by most recently updated:
        //   rank 2 = out of stock (qty <= 0)      — most urgent, top of list
        //   rank 1 = low stock (0 < qty <= min_stock)
        //   rank 0 = normal
        rows.sort((a, b) => {
            const rank = r => {
                const q = r.displayQty;
                if (q <= 0) return 2;
                if (Stock.status(q, r.min_stock) === 'low') return 1;
                return 0;
            };
            const ar = rank(a), br = rank(b);
            if (ar !== br) return br - ar;
            return (b.updated_at || 0) - (a.updated_at || 0);
        });
        // Incremental rendering: keep the full filtered set, paint a page at a time.
        this._allRows = rows;
        document.getElementById('parts-result-summary').textContent =
            `${this.currentLocation || '全部位置'} · ${rows.length} 种配件 · 剩余 ${rows.reduce((sum, r) => sum + r.displayQty, 0)} 件`;
        this.renderNextPage(true);
    },

    scopeFilters() {
        return { category: this.currentFilter, location: this.currentLocation,
            search: document.getElementById('parts-search')?.value || '' };
    },

    updateStockTotal(rows) {
        const counts = Stock.availability(rows);
        document.getElementById('stat-stock').textContent = counts[''];
        const filters = this.scopeFilters();
        document.getElementById('stat-stock-label').textContent =
            filters.category || filters.location || filters.search.trim() ? '筛选库存（件）' : '总库存（件）';
        return counts;
    },

    filterStatus(status) { this.currentStatus = status; return this.load(); },
    filterLocation(location) { this.currentLocation = location; return this.load(); },
    clearFilters() {
        this.currentFilter = this.currentStatus = this.currentLocation = '';
        document.getElementById('parts-search').value = '';
        document.getElementById('category-filter').open = false;
        return this.load();
    },

    filterCategory(cat) {
        this.currentFilter = cat;
        document.getElementById('category-filter').open = false;
        return this.load();
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
                const cEsc = escapeHtml(c);
                return `<button class="cat-chip ${this.currentFilter === c ? 'active' : ''}" data-cat="${cEsc}" onclick="partsManager.filterCategory(this.dataset.cat)">${cEsc}</button>`;
            }).join('');
    },

    search() {
        if (this._searchTimer) clearTimeout(this._searchTimer);
        const self = this;
        this._searchTimer = setTimeout(() => { self.load(); }, 250);
    },

    // Paint the list one page at a time so a large inventory doesn't build
    // hundreds of DOM nodes on first paint. Scrolling to the sentinel loads more.
    renderNextPage(reset) {
        const el = document.getElementById('parts-list');
        if (reset) {
            this._rendered = 0;
            el.innerHTML = '';
        }
        const total = this._allRows.length;
        if (total === 0) {
            const filtered = this.currentFilter || this.currentStatus || this.currentLocation || document.getElementById('parts-search').value.trim();
            el.innerHTML = '<div class="card" style="text-align:center;padding:32px;"><p class="empty-text">' +
                (filtered ? '没有符合条件的配件，试试重置筛选。' : '暂无配件，点击右上角“添加”。') + '</p></div>';
            this._detachSentinel();
            return;
        }
        const next = this._allRows.slice(this._rendered, this._rendered + this.PAGE_SIZE);
        const base = this._rendered;
        const html = next.map((r, i) => this._partItemHtml(r, base + i)).join('');
        if (reset) {
            el.innerHTML = html;
        } else {
            const s = document.getElementById('parts-list-sentinel');
            if (s) s.insertAdjacentHTML('beforebegin', html);
            else el.insertAdjacentHTML('beforeend', html);
        }
        this._rendered += next.length;
        this._ensureSentinel();
        this._updateListFooter(total);
    },

    _partItemHtml(r, index) {
        const qty = r.displayQty ?? r.qty ?? 0;
        const status = Stock.status(qty, r.min_stock);
        const name = escapeHtml(r.name);
        const category = escapeHtml(r.category);
        const brand = escapeHtml(r.brand);
        const locations = r.locations || [];
        const visibleLocations = this.currentLocation ?
            locations.filter(i => i.location === this.currentLocation) : locations.slice(0, 2);
        const moreLocations = this.currentLocation ? 0 : Math.max(0, locations.length - 2);

        return `<div class="part-item" data-part-id="${r.id}" onclick="if(!event.target.closest('button'))partsManager.viewDetail(${r.id})">
            <div class="part-main">
                <div class="part-info">
                    <button type="button" class="part-name" onclick="partsManager.viewDetail(${r.id})" title="${name}" aria-label="${name}，查看详情">${name}</button>
                    <div class="part-meta-row">
                        <span>${category}</span>
                        <span class="meta-sep">·</span>
                        <span>${r.condition === 'old' ? '旧件' : '新件'}</span>
                        ${r.brand ? '<span class="meta-sep">·</span><span>' + brand + '</span>' : ''}
                    </div>
                </div>
                <div class="part-stock-section">
                    <span class="part-stock-number ${status}" id="qty-${r.id}">${qty}</span>
                    <span class="part-stock-label">${this.currentLocation ? '该位置' : '合计'}（件）</span>
                    ${status !== 'available' ? `<span class="stock-status ${status}">${status === 'empty' ? '已用完' : '快用完'}</span>` : ''}
                </div>
            </div>
            <div class="part-bottom">
                <div class="part-location-list">${visibleLocations.map(i => `<span class="location-quantity" title="${escapeHtml(i.location)}">${escapeHtml(i.location)} <strong>${i.qty}</strong></span>`).join('')}${moreLocations ? `<button type="button" class="more-locations" onclick="partsManager.viewDetail(${r.id})">另 ${moreLocations} 处</button>` : ''}</div>
                <div class="part-controls" onclick="event.stopPropagation();">
                    <button type="button" class="stock-btn-circle stock-minus-btn" aria-label="用掉一件" ${qty <= 0 ? 'disabled' : ''} onclick="partsManager.quickStock(${r.id}, 'out')">&#8722;</button>
                    <button type="button" class="stock-btn-circle stock-plus-btn" aria-label="补充一件" onclick="partsManager.quickStock(${r.id}, 'in')">&#43;</button>
                </div>
            </div>
        </div>`;
    },

    _ensureSentinel() {
        let s = document.getElementById('parts-list-sentinel');
        if (!s) {
            s = document.createElement('div');
            s.id = 'parts-list-sentinel';
            s.className = 'list-sentinel';
        }
        document.getElementById('parts-list').appendChild(s); // keep it last
        if (!this._listObserver) {
            const self = this;
            this._listObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) self._onSentinelVisible();
            }, { root: null, rootMargin: '300px' });
        }
        this._listObserver.observe(s);
        return s;
    },

    _detachSentinel() {
        const s = document.getElementById('parts-list-sentinel');
        if (s && s.parentNode) s.parentNode.removeChild(s);
    },

    _onSentinelVisible() {
        if (this._rendered < this._allRows.length) {
            this.renderNextPage(false);
        }
    },

    _updateListFooter(total) {
        const s = document.getElementById('parts-list-sentinel');
        if (!s) return;
        if (this._rendered >= total) {
            s.innerHTML = total > 0 ? '<span class="sentinel-text">已显示全部 ' + total + ' 个配件</span>' : '';
            s.classList.add('sentinel-done');
        } else {
            s.innerHTML = '<span class="sentinel-text">&#8635; 加载更多...</span>';
            s.classList.remove('sentinel-done');
        }
    },

    // ----- Add/Edit Modal -----
    async openAddModal() {
        if (this._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        this.editingId = null;
        document.getElementById('modal-part-title').textContent = '添加配件';
        document.getElementById('part-form').reset();
        document.getElementById('part-category').innerHTML = '<option value="">选择分类</option>' +
            this.getAllCategories().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        document.getElementById('part-image-preview').style.display = 'none';
        document.getElementById('part-remove-photo-btn').style.display = 'none';
        // Reset BOTH photo fields. Clearing only currentImageData left a stale
        // currentImageId behind from a previously edited part, and
        // _resolveImageValue() prefers the id — so a brand-new part silently
        // inherited the last edited part's photo.
        app.currentImageId = null;
        app.currentImageData = null;
        document.getElementById('new-cat-row').style.display = 'none';
        document.getElementById('part-delete-btn').style.display = 'none';
        document.getElementById('part-locations').innerHTML = '';
        this.addLocationRow(this.currentLocation, 0);
        await this.updateLocationSuggestions();
        app._openModal('modal-part');
    },

    addLocationRow(location = '', qty = 0) {
        const row = document.createElement('div');
        row.className = 'part-location-row';
        row.innerHTML = `<input class="location-name" type="text" required list="location-suggestions"
            aria-label="存放位置" placeholder="背包、家里、后备箱" value="${escapeHtml(location)}">
            <input class="location-qty" type="number" required min="0" step="1" inputmode="numeric"
            aria-label="此位置的数量" value="${qty}" oninput="partsManager.updateLocationTotal()">
            <button type="button" class="remove-location-btn" aria-label="移除此位置"
                onclick="partsManager.removeLocationRow(this)">×</button>`;
        document.getElementById('part-locations').appendChild(row);
        this.updateLocationTotal();
    },

    removeLocationRow(button) {
        const container = document.getElementById('part-locations');
        if (container.children.length <= 1) { app.showToast('请至少保留一个位置'); return; }
        button.closest('.part-location-row').remove();
        this.updateLocationTotal();
    },

    readLocationRows() {
        return Array.from(document.querySelectorAll('#part-locations .part-location-row')).map(row => ({
            location: row.querySelector('.location-name').value,
            qty: row.querySelector('.location-qty').value
        }));
    },

    updateLocationTotal() {
        document.getElementById('part-qty').value = this.readLocationRows()
            .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);
    },

    async updateLocationSuggestions() {
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const warehouses = await DB.all('warehouses');
        const names = new Set(['背包', '家里', '后备箱']);
        parts.forEach(p => Stock.distribution(p, inventory, warehouses).forEach(i => names.add(i.location)));
        document.getElementById('location-suggestions').innerHTML = Array.from(names)
            .map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
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
            this.getAllCategories().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        document.getElementById('part-category').value = name;
        app.showToast('分类已添加');
    },

    async edit(id) {
        if (this._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        const r = await DB.get('parts', id);
        if (!r) return;
        this.editingId = id;
        document.getElementById('modal-part-title').textContent = '编辑配件';
        document.getElementById('part-name').value = r.name;
        document.getElementById('part-category').innerHTML = '<option value="">选择分类</option>' +
            this.getAllCategories().map(c => `<option value="${escapeHtml(c)}" ${c === r.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
        document.querySelector('input[name="part-condition"][value="' + (r.condition || 'new') + '"]').checked = true;
        document.getElementById('part-price').value = r.unit_price || '';
        document.getElementById('part-brand').value = r.brand || '';
        const locations = Stock.distribution(r, await DB.all('inventory'), await DB.all('warehouses'));
        document.getElementById('part-locations').innerHTML = '';
        locations.forEach(i => this.addLocationRow(i.location, i.qty));
        await this.updateLocationSuggestions();
        document.getElementById('part-model').value = r.model || '';
        document.getElementById('part-min-stock').value = r.min_stock ?? 1;
        document.getElementById('part-note').value = r.note || '';
        document.getElementById('new-cat-row').style.display = 'none';
        if (r.image) {
            app.currentImageId = r.image;
            app.currentImageData = await DB.resolveImage(r.image);
            const img = document.getElementById('part-image-preview');
            if (app.currentImageData) {
                img.src = app.currentImageData; img.style.display = 'block';
                document.getElementById('part-remove-photo-btn').style.display = 'inline-block';
            } else {
                img.style.display = 'none';
                document.getElementById('part-remove-photo-btn').style.display = 'none';
            }
        } else {
            app.currentImageId = null;
            app.currentImageData = null;
            document.getElementById('part-image-preview').style.display = 'none';
            document.getElementById('part-remove-photo-btn').style.display = 'none';
        }
        document.getElementById('part-delete-btn').style.display = 'block';
        app._openModal('modal-part');
    },

    async save(e) {
        e.preventDefault();
        if (this._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        this._stockBusy = true;
        try {
            const editingId = this.editingId;
            const locations = Stock.validateLocations(this.readLocationRows());
            const name = document.getElementById('part-name').value.trim();
            const category = document.getElementById('part-category').value;
            const threshold = document.getElementById('part-min-stock').value;
            const min_stock = threshold.trim() === '' ? 1 : Number(threshold);
            if (!name || !category) throw new Error('请填写配件名称和分类');
            if (!Number.isSafeInteger(min_stock) || min_stock < 0) throw new Error('预警数量必须是大于或等于 0 的整数');
            const price = document.getElementById('part-price').value;
            const unit_price = price === '' ? null : Number(price);
            if (unit_price !== null && (!Number.isFinite(unit_price) || unit_price < 0)) throw new Error('金额必须大于或等于 0');
            const data = {
                name, category, min_stock, unit_price,
                condition: document.querySelector('input[name="part-condition"]:checked')?.value || 'new',
                brand: document.getElementById('part-brand').value.trim(),
                model: document.getElementById('part-model').value.trim(),
                note: document.getElementById('part-note').value.trim(),
                image: await this._resolveImageValue()
            };
            await Stock.save(editingId, data, locations, editingId ? '编辑调整库存位置/数量' : '新增配件入库');
            app.showToast(editingId ? '配件已更新' : '配件已添加');
            this.closeModal();
            if (app.currentPage === 'home') await this.load();
            if (app.currentPage === 'restock') await restockManager.load();
            await app.updateStatsBar();
        } catch (e) {
            app.showToast(e.message || '保存失败，请重试');
        } finally { this._stockBusy = false; }
    },

    // Normalize the current photo into the value stored in part.image:
    //  - if currentImageId is set -> store it (IndexedDB reference)
    //  - if currentImageId is a legacy inline base64 -> compress & migrate to IndexedDB, store id
    //  - else if only currentImageData exists (fallback) -> store inline base64
    //  - else -> empty string
    async _resolveImageValue() {
        if (app.currentImageId) {
            if (app.currentImageId.indexOf('data:image') === 0) {
                try {
                    const compressed = await app.compressImage(app.currentImageId, 1280, 0.72);
                    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    const saved = await DB.saveImage(id, compressed);
                    if (saved) return id;
                    return app.currentImageId; // IDB failed -> keep inline base64
                } catch (e) {
                    return app.currentImageId; // keep inline on failure
                }
            }
            return app.currentImageId;
        }
        if (app.currentImageData) return app.currentImageData;
        return '';
    },

    async quickStock(partId, type, location) {
        if (this._stockBusy) return;
        this._stockBusy = true;
        try {
            const part = await DB.get('parts', partId);
            if (!part) return;
            const rows = Stock.distribution(part, await DB.all('inventory'), await DB.all('warehouses'));
            const chosen = location || this.currentLocation;
            if (!chosen && rows.length > 1) {
                const options = document.getElementById('stock-location-options');
                options.innerHTML = '';
                document.getElementById('stock-location-title').textContent = type === 'in' ? '补充到哪个位置？' : '从哪个位置用掉？';
                for (const row of rows) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'stock-location-option';
                    button.textContent = row.location + ' · 剩余 ' + row.qty + ' 件';
                    button.disabled = type === 'out' && row.qty <= 0;
                    button.onclick = () => this.quickStock(partId, type, row.location);
                    options.appendChild(button);
                }
                app._openModal('modal-stock-location');
                return;
            }
            const target = chosen || rows[0].location;
            const result = await Stock.adjust(partId, type, target);
            app._closeModal('modal-stock-location');
            app.showToast(target + (type === 'in' ? ' +1' : ' −1') + '，合计剩余 ' + result.qty + ' 件');
            if (app.currentPage === 'home') await this.load();
            if (app.currentPage === 'restock') await restockManager.load();
            await app.updateStatsBar();
        } catch (e) {
            app.showToast(e.message || '操作失败，请重试');
        } finally { this._stockBusy = false; }
    },

    async viewDetail(id) {
        const part = await DB.get('parts', id);
        if (!part) return;
        this._detailPartId = id;
        this._historyLimit = 10;

        const imageSrc = await DB.resolveImage(part.image);

        const allWarehouses = await DB.all('warehouses');
        const allInventory = await DB.all('inventory');

        const locations = Stock.distribution(part, allInventory, allWarehouses);
        const total = locations.reduce((sum, i) => sum + i.qty, 0);
        const stockHtml = locations.map(i =>
            `<div class="stock-wh-item"><span>${escapeHtml(i.location)}</span><span><strong>${i.qty}</strong> 件</span></div>`
        ).join('');

        const condLabel = part.condition === 'old' ? '旧件' : '新件';
        const condColor = part.condition === 'old' ? '#96652c' : '#697e57';

        const pName = escapeHtml(part.name);
        const pCategory = escapeHtml(part.category);
        const pBrand = escapeHtml(part.brand);
        const pModel = escapeHtml(part.model);
        const pNote = escapeHtml(part.note);
        const pPrice = escapeHtml(part.unit_price);

        document.getElementById('part-detail-content').innerHTML = `
            <div class="detail-section">
                <h4>基本信息</h4>
                <div class="detail-row"><span class="detail-label">名称</span><span class="detail-value">${pName}</span></div>
                <div class="detail-row"><span class="detail-label">分类</span><span class="detail-value">${pCategory}</span></div>
                <div class="detail-row"><span class="detail-label">新旧件</span><span class="detail-value" style="color:${condColor};font-weight:600;">${condLabel}</span></div>
                ${part.brand ? '<div class="detail-row"><span class="detail-label">供应商</span><span class="detail-value">' + pBrand + '</span></div>' : ''}
                ${part.model ? '<div class="detail-row"><span class="detail-label">适配机型</span><span class="detail-value">' + pModel + '</span></div>' : ''}
                <div class="detail-row"><span class="detail-label">低库存预警</span><span class="detail-value">${part.min_stock === 0 ? '已关闭' : (part.min_stock ?? 1) + ' 件'}</span></div>
                ${part.note ? '<div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">' + pNote + '</span></div>' : ''}
                ${part.unit_price ? '<div class="detail-row"><span class="detail-label">单价</span><span class="detail-value" style="color:#96652c;">¥' + pPrice + '</span></div>' : ''}
                ${imageSrc ? '<div style="margin-top:8px;"><img src="' + imageSrc + '" data-part-id="' + part.id + '" style="max-width:100%;border-radius:8px;" onclick="app.showImageViewer(this.src)"></div><div style="margin-top:6px;"><button type="button" onclick="partsManager.requestDeletePhoto(' + part.id + ')" style="background:#ad5b48;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">&#128465; 删除照片</button></div>' : ''}
            </div>
            <div class="detail-section">
                <h4>存放位置 · 合计剩余 ${total} 件</h4>
                <div class="stock-by-warehouse">${stockHtml || '<p style="color:#8c9181;font-size:13px;">暂无库存分布</p>'}</div>
            </div>
            <div class="form-actions detail-actions">
                <button class="btn-primary" onclick="partsManager.quickStockFromDetail(${part.id});partsManager.closeDetail();">&#43; 入库</button>
                <button class="btn-secondary" onclick="partsManager.quickStock(${part.id}, 'out');partsManager.closeDetail();" ${total <= 0 ? 'disabled' : ''}>用掉 1 件</button>
                <button class="btn-secondary" onclick="partsManager.closeDetail();partsManager.edit(${part.id});">编辑位置/数量</button>
            </div>
            <div class="detail-section">
                <h4>最近记录 <span id="part-history-count" class="history-count"></span></h4>
                <div id="part-history" aria-live="polite"></div>
            </div>
        `;
        await this.renderHistory();
        app._openModal('modal-part-detail');
    },

    historyRowsHTML(records, warehouses) {
        return records.map(record => {
            const warehouse = warehouses.find(w => w.id === record.warehouse_id);
            const destination = warehouses.find(w => w.id === record.to_warehouse_id);
            const location = record.location || (warehouse?.name !== '默认仓库' ? warehouse?.name : '') || '旧记录未标注位置';
            const toLocation = record.to_location || destination?.name || '目标位置未记录';
            const label = record.type === 'in' ? '入库' : record.type === 'out' ? '出库' : record.type === 'transfer' ? '移动' : '库存调整';
            const sign = record.type === 'in' ? '+' : record.type === 'out' ? '−' : '';
            const time = Number(record.created_at) > 0 ? new Date(record.created_at * 1000).toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai'
            }) : '时间未记录';
            return `<li class="history-item">
                <div class="history-main"><strong class="history-type ${record.type === 'in' ? 'in' : record.type === 'out' ? 'out' : 'transfer'}">${label} ${sign}${escapeHtml(record.qty)} 件</strong><time title="北京时间">${escapeHtml(time)}</time></div>
                <p class="history-location">${escapeHtml(location)}${record.type === 'transfer' ? ' → ' + escapeHtml(toLocation) : ''}</p>
                ${record.note ? `<p class="history-note">${escapeHtml(record.note)}</p>` : ''}
            </li>`;
        }).join('');
    },

    async renderHistory() {
        const id = this._detailPartId;
        if (!id) return;
        const records = Stock.history(await DB.all('records'), id);
        const warehouses = await DB.all('warehouses');
        if (id !== this._detailPartId) return;
        document.getElementById('part-history-count').textContent = `共 ${records.length} 条`;
        const shown = records.slice(0, this._historyLimit);
        document.getElementById('part-history').innerHTML = shown.length ?
            `<ol class="history-list">${this.historyRowsHTML(shown, warehouses)}</ol>` +
            (shown.length < records.length ? `<button type="button" class="history-more" onclick="partsManager.moreHistory()">查看更多（已显示 ${shown.length}/${records.length} 条）</button>` : '') :
            '<p class="form-hint">还没有操作记录。补充或取用配件后会自动记录。</p>';
    },

    async moreHistory() {
        this._historyLimit += 10;
        await this.renderHistory();
    },

    async quickStockFromDetail(partId) {
        await this.quickStock(partId, 'in');
    },

    closeDetail() {
        this._detailPartId = null;
        app._closeModal('modal-part-detail');
    },

    closeModal() {
        app._closeModal('modal-part');
        this.editingId = null;
        // Clear the photo scratch state too, so it can never leak into the next
        // add/edit session. (openAddModal also resets these defensively.)
        app.currentImageId = null;
        app.currentImageData = null;
        document.getElementById('new-cat-row').style.display = 'none';
    },

    // Fill the add-part form from a catalog template (iPhone 7-17 quick add).
    // Ensures the mapped category exists in the select before selecting it.
    applyTemplate(name, category, model) {
        document.getElementById('part-name').value = name;
        const sel = document.getElementById('part-category');
        if (!this.getAllCategories().includes(category)) {
            this.customCategories.push(category);
            sel.innerHTML = '<option value="">选择分类</option>' +
                this.getAllCategories().map(c => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('');
        }
        sel.value = category;
        document.getElementById('part-model').value = model;
        document.getElementById('new-cat-row').style.display = 'none';
        app.showToast('已填入模板，请补充数量/价格/位置');
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

    removeCurrentPhoto() {
        app.currentImageId = null;
        app.currentImageData = null;
        const img = document.getElementById('part-image-preview');
        img.src = ''; img.style.display = 'none';
        document.getElementById('part-remove-photo-btn').style.display = 'none';
        app.showToast('已移除照片,保存后生效');
    },

    requestDeletePhoto(partId) {
        if (!partId) return;
        this._pendingDeleteId = partId;
        app._openModal('modal-confirm-photo');
    },

    cancelDeletePhoto() {
        this._pendingDeleteId = null;
        app._closeModal('modal-confirm-photo');
    },

    async confirmDeletePhoto() {
        if (this._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        const partId = this._pendingDeleteId;
        this._pendingDeleteId = null;
        app._closeModal('modal-confirm-photo');
        if (!partId) return;
        this._stockBusy = true;
        try {
            const parts = await DB.all('parts');
            const part = parts.find(row => row.id === partId);
            if (!part) throw new Error('配件已不存在');
            const oldImage = part.image;
            part.image = '';
            if (!DB.commitStores({ parts })) throw new Error('删除照片失败，原照片已保留');
            if (oldImage && oldImage.indexOf('data:image') !== 0) {
                try { await DB.deleteUnusedImage(oldImage); } catch (e) {}
            }
            app.showToast('照片已删除');
            app.refreshDashboard();
            const detail = document.getElementById('modal-part-detail');
            if (detail && detail.style.display !== 'none') {
                await this.viewDetail(partId);
            }
        } catch (e) { app.showToast(e.message || '删除照片失败'); }
        finally { this._stockBusy = false; }
    },

    async saveCurrentImage() {
        const src = this._saveImageSrc;
        this._saveImageSrc = null;
        this.closeSaveImageModal();
        if (!src || !window.AndroidBridge || !AndroidBridge.saveImage) {
            app.showToast('保存失败');
            return;
        }
        app.showToast('正在保存...');
        var name = 'IMG_' + Date.now() + '.jpg';
        try {
            await app.saveNative('saveImage', src, name);
            app.showToast('图片已保存');
        } catch (e) { app.showToast(e.message || '保存失败'); }
    },

    takePhoto(mode) {
        app.takePicture(async (data) => {
            // Compress and move the photo into IndexedDB so it doesn't bloat
            // localStorage. part.image will store the IndexedDB key (id).
            let id = null;
            let preview = data;
            try {
                const compressed = await app.compressImage(data, 1280, 0.72);
                preview = compressed;
                try {
                    id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    const saved = await DB.saveImage(id, compressed);
                    if (!saved) id = null; // IDB unavailable/failed -> fallback to inline base64
                } catch (e) {
                    id = null; // IndexedDB unavailable -> fallback to inline base64
                }
            } catch (e) {
                id = null;
                preview = data;
            }
            app.currentImageId = id;
            app.currentImageData = preview;
            const img = document.getElementById('part-image-preview');
            img.src = preview; img.style.display = 'block';
            document.getElementById('part-remove-photo-btn').style.display = 'inline-block';
        }, mode);
    },

    async deleteItem(id) {
        if (this._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        this._stockBusy = true;
        try {
            const parts = await DB.all('parts');
            const part = parts.find(row => row.id === id);
            if (!part) throw new Error('配件已不存在');
            const inventory = await DB.all('inventory');
            const records = await DB.all('records');
            if (!DB.commitStores({ parts: parts.filter(row => row.id !== id),
                inventory: inventory.filter(row => row.part_id !== id),
                records: records.filter(row => row.part_id !== id) })) {
                throw new Error('删除失败，原有数据已保留');
            }
            if (part && part.image && part.image.indexOf('data:image') !== 0) {
                try { await DB.deleteUnusedImage(part.image); } catch (e) {}
            }
            app.showToast('已删除');
            this.closeModal();
            await this.load();
            await app.updateStatsBar();
        } catch (e) { app.showToast(e.message || '删除失败'); }
        finally { this._stockBusy = false; }
    },

    confirmDelete() {
        if (!this.editingId) return;
        this.deleteItem(this.editingId);
    }
};
