// parts.js - Parts management (browser version)
const partsManager = {
    editingId: null,

    loadCategories() {
        const cats = ['屏幕', '电池', '排线', '摄像头', '壳/后盖', '按键', '充电口', '扬声器', '其他'];
        const sel = document.getElementById('parts-category-filter');
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            sel.appendChild(opt);
        });
    },

    async load() {
        const search = (document.getElementById('parts-search')?.value || '').trim().toLowerCase();
        const cat = document.getElementById('parts-category-filter')?.value || '';
        let rows = await DB.all('parts');
        if (search) {
            rows = rows.filter(r => r.name.toLowerCase().includes(search) || r.model.toLowerCase().includes(search));
        }
        if (cat) {
            rows = rows.filter(r => r.category === cat);
        }
        rows.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        this.render(rows);
    },

    render(rows) {
        const el = document.getElementById('parts-list');
        if (!rows.length) { el.innerHTML = '<p class="empty-text">暂无配件，点击右上角添加</p>'; return; }
        el.innerHTML = rows.map(r => {
            const imgHtml = r.image ?
                `<img src="${r.image}" alt="">` : '&#128230;';
            return `<div class="item-card" onclick="partsManager.viewDetail(${r.id})">
                <div class="item-image">${imgHtml}</div>
                <div class="item-info">
                    <div class="item-name">${r.name}${r.model ? ' <small style="color:#888">' + r.model + '</small>' : ''}</div>
                    <div class="item-meta">${r.category} ${r.spec ? '· ' + r.spec : ''}</div>
                </div>
                <div class="item-actions">
                    <button class="btn-edit" onclick="event.stopPropagation();partsManager.edit(${r.id})">编辑</button>
                    <button class="btn-danger" onclick="event.stopPropagation();partsManager.deleteItem(${r.id})">删除</button>
                </div>
            </div>`;
        }).join('');
    },

    search() { this.load(); },

    openAddModal() {
        this.editingId = null;
        document.getElementById('modal-part-title').textContent = '添加配件';
        document.getElementById('part-form').reset();
        document.getElementById('part-image-preview').style.display = 'none';
        document.getElementById('part-image-placeholder').style.display = 'flex';
        app.currentImageData = null;
        document.getElementById('modal-part').style.display = 'flex';
    },

    edit(id) {
        DB.get('parts', id).then(r => {
            if (!r) return;
            this.editingId = id;
            document.getElementById('modal-part-title').textContent = '编辑配件';
            document.getElementById('part-name').value = r.name;
            document.getElementById('part-model').value = r.model;
            document.getElementById('part-category').value = r.category;
            document.getElementById('part-spec').value = r.spec;
            document.getElementById('part-min-stock').value = r.min_stock;
            if (r.image) {
                app.currentImageData = r.image;
                document.getElementById('part-image-preview').src = r.image;
                document.getElementById('part-image-preview').style.display = 'block';
                document.getElementById('part-image-placeholder').style.display = 'none';
            }
            document.getElementById('modal-part').style.display = 'flex';
        });
    },

    save(e) {
        e.preventDefault();
        const data = {
            name: document.getElementById('part-name').value.trim(),
            model: document.getElementById('part-model').value.trim(),
            category: document.getElementById('part-category').value,
            spec: document.getElementById('part-spec').value.trim(),
            min_stock: parseInt(document.getElementById('part-min-stock').value) || 1,
            image: app.currentImageData || ''
        };
        if (this.editingId) {
            DB.run('parts', { ...data, id: this.editingId }).then(() => {
                app.showToast('配件已更新'); this.closeModal(); this.load();
            });
        } else {
            DB.run('parts', data).then(() => {
                app.showToast('配件已添加'); this.closeModal(); this.load();
            });
        }
    },

    deleteItem(id) {
        if (!confirm('确定删除这个配件？关联的库存、记录和价格也会被删除。')) return;
        DB.deleteItem('parts', id).then(() => {
            // Cascade delete
            const inventory = DB.getStore('inventory').filter(i => i.part_id === id);
            inventory.forEach(i => DB.deleteItem('inventory', i.id));
            const records = DB.getStore('records').filter(r => r.part_id === id);
            records.forEach(r => DB.deleteItem('records', r.id));
            const prices = DB.getStore('prices').filter(p => p.part_id === id);
            prices.forEach(p => DB.deleteItem('prices', p.id));
            app.showToast('已删除'); this.load();
        });
    },

    async viewDetail(id) {
        const part = await DB.get('parts', id);
        if (!part) return;

        const allParts = await DB.all('parts');
        const allWarehouses = await DB.all('warehouses');
        const allInventory = await DB.all('inventory');

        const partWh = allInventory.filter(i => i.part_id === id);
        const invMap = {};
        partWh.forEach(i => { invMap[i.warehouse_id] = (invMap[i.warehouse_id] || 0) + (i.qty || 0); });

        let stockHtml = allWarehouses.map(w => {
            const qty = invMap[w.id] || 0;
            return `<div class="stock-wh-item"><span>${w.name} ${w.location ? '('+w.location+')' : ''}</span><span><strong>${qty}</strong> 件</span></div>`;
        }).join('');

        const allPrices = await DB.all('prices');
        const partPrices = allPrices.filter(p => p.part_id === id).sort((a, b) => b.created_at - a.created_at);
        const latestPrice = partPrices[0];

        let priceHtml = '';
        if (latestPrice) {
            priceHtml = `<div style="margin-bottom:8px;">
                <span class="price-cost">拿货价: ${latestPrice.cost || 0}元</span>
                <span class="price-sell" style="margin-left:12px;">零售: ${latestPrice.sell_price || 0}元</span>
                ${latestPrice.supplier ? '<span style="font-size:12px;color:#888;margin-left:8px;">供应商: ' + latestPrice.supplier + '</span>' : ''}
            </div>`;
            if (partPrices.length > 1) {
                priceHtml += '<div style="font-size:12px;color:#888;margin-top:6px;">历史价格:</div>';
                priceHtml += partPrices.slice(0, 5).map(p => `<div class="price-history-item">
                    <div class="price-history-header">
                        <span>拿货: ${p.cost}元 | 零售: ${p.sell_price || 0}元</span>
                        <span>${new Date(p.created_at * 1000).toLocaleDateString()}</span>
                    </div>
                    ${p.supplier ? '<div>供应商: ' + p.supplier + '</div>' : ''}
                </div>`).join('');
            }
        } else {
            priceHtml = '<p style="color:#aaa;font-size:13px;">暂无价格记录</p>';
        }

        document.getElementById('part-detail-content').innerHTML = `
            <div class="detail-section">
                <h4>基本信息</h4>
                <div class="detail-row"><span class="detail-label">名称</span><span class="detail-value">${part.name}</span></div>
                ${part.model ? '<div class="detail-row"><span class="detail-label">型号</span><span class="detail-value">' + part.model + '</span></div>' : ''}
                <div class="detail-row"><span class="detail-label">分类</span><span class="detail-value">${part.category}</span></div>
                ${part.spec ? '<div class="detail-row"><span class="detail-label">规格</span><span class="detail-value">' + part.spec + '</span></div>' : ''}
                <div class="detail-row"><span class="detail-label">预警库存</span><span class="detail-value">${part.min_stock}</span></div>
                ${part.image ? '<div style="margin-top:8px;"><img src="' + part.image + '" style="max-width:100%;border-radius:8px;"></div>' : ''}
            </div>
            <div class="detail-section">
                <h4>库存分布</h4>
                <div class="stock-by-warehouse">${stockHtml}</div>
            </div>
            <div class="detail-section">
                <h4>价格信息</h4>
                ${priceHtml}
            </div>
            <div class="form-actions">
                <button class="btn-primary" onclick="inventoryManager.openForPart(${part.id});partsManager.closeDetail();">&#8593; 入库</button>
                <button class="btn-secondary" onclick="partsManager.closeDetail();partsManager.edit(${part.id});">编辑</button>
            </div>
        `;
        document.getElementById('modal-part-detail').style.display = 'flex';
    },

    closeDetail() {
        document.getElementById('modal-part-detail').style.display = 'none';
    },

    closeModal() {
        document.getElementById('modal-part').style.display = 'none';
        this.editingId = null;
    },

    takePhoto() {
        app.takePicture(data => {
            app.currentImageData = data;
            const img = document.getElementById('part-image-preview');
            img.src = data; img.style.display = 'block';
            document.getElementById('part-image-placeholder').style.display = 'none';
        });
    }
};
