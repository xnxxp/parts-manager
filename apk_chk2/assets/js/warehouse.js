// warehouse.js
const warehouseManager = {
    editingId: null,

    async load() {
        const warehouses = await DB.all('warehouses');
        const inventory = await DB.all('inventory');
        const whPartCount = {};
        inventory.forEach(i => { if (!whPartCount[i.warehouse_id]) whPartCount[i.warehouse_id] = new Set(); whPartCount[i.warehouse_id].add(i.part_id); });
        const rows = warehouses.map(w => ({ ...w, part_count: whPartCount[w.id] ? whPartCount[w.id].size : 0 }));
        this.render(rows);
    },

    render(rows) {
        const el = document.getElementById('warehouse-list');
        if (!rows.length) { el.innerHTML = '<p class="empty-text">暂无仓库，点击右上角添加</p>'; return; }
        el.innerHTML = rows.map(r => `
            <div class="warehouse-card">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div class="warehouse-name">&#127970; ${r.name}</div>
                        <div class="warehouse-info">${r.location ? '位置: ' + r.location : ''} ${r.note ? '· ' + r.note : ''}</div>
                        <span class="warehouse-count">${r.part_count} 种配件</span>
                    </div>
                    <div class="item-actions">
                        <button class="btn-edit" onclick="warehouseManager.edit(${r.id})">编辑</button>
                        <button class="btn-danger" onclick="warehouseManager.deleteItem(${r.id})">删除</button>
                    </div>
                </div>
            </div>
        `).join('');
    },

    openAddModal() {
        this.editingId = null;
        document.getElementById('modal-warehouse-title').textContent = '添加仓库';
        document.getElementById('warehouse-form').reset();
        document.getElementById('modal-warehouse').style.display = 'flex';
    },

    edit(id) {
        DB.get('warehouses', id).then(r => {
            if (!r) return;
            this.editingId = id;
            document.getElementById('modal-warehouse-title').textContent = '编辑仓库';
            document.getElementById('warehouse-name').value = r.name;
            document.getElementById('warehouse-location').value = r.location;
            document.getElementById('warehouse-note').value = r.note;
            document.getElementById('modal-warehouse').style.display = 'flex';
        });
    },

    save(e) {
        e.preventDefault();
        const name = document.getElementById('warehouse-name').value.trim();
        const location = document.getElementById('warehouse-location').value.trim();
        const note = document.getElementById('warehouse-note').value.trim();
        if (!name) { app.showToast('请输入仓库名称'); return; }
        if (this.editingId) {
            DB.run('warehouses', { id: this.editingId, name, location, note }).then(() => {
                app.showToast('仓库已更新'); this.closeModal(); this.load(); app.refreshDashboard();
            });
        } else {
            DB.run('warehouses', { name, location, note }).then(() => {
                app.showToast('仓库已添加'); this.closeModal(); this.load(); app.refreshDashboard();
            });
        }
    },

    async deleteItem(id) {
        const inventory = await DB.all('inventory');
        const hasStock = inventory.some(i => i.warehouse_id === id && i.qty > 0);
        if (hasStock) { app.showToast('该仓库还有库存，无法删除'); return; }
        if (!confirm('确定删除此仓库？')) return;
        DB.deleteItem('warehouses', id).then(() => { app.showToast('已删除'); this.load(); });
    },

    closeModal() {
        document.getElementById('modal-warehouse').style.display = 'none';
        this.editingId = null;
    }
};
