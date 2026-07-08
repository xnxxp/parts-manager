// inventory.js
const inventoryManager = {
    type: 'in',

    async load() {
        await this.populateSelects();
        await this.loadRecords();
    },

    async populateSelects() {
        const whSelect = document.getElementById('inv-warehouse');
        const toWhSelect = document.getElementById('inv-to-warehouse');
        const warehouses = await DB.all('warehouses');
        warehouses.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        const opts = '<option value="">请选择仓库</option>' +
            warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        whSelect.innerHTML = opts;
        toWhSelect.innerHTML = opts;
    },

    setType(t) {
        this.type = t;
        document.querySelectorAll('.inventory-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.inventory-tabs .tab-btn[data-type="${t}"]`).classList.add('active');
        document.getElementById('inv-warehouse-group').style.display = t === 'transfer' ? 'none' : 'block';
        document.getElementById('inv-to-warehouse-group').style.display = t === 'transfer' ? 'block' : 'none';
        document.getElementById('inv-price-group').style.display = t === 'in' ? 'block' : 'none';
        document.getElementById('inv-brand-group').style.display = t === 'in' ? 'block' : 'none';
    },

    async submit(e) {
        e.preventDefault();
        const partName = document.getElementById('inv-part-name').value.trim();
        const brand = document.getElementById('inv-brand')?.value.trim() || '';
        const price = parseFloat(document.getElementById('inv-price')?.value) || null;
        const condition = document.querySelector('input[name="inv-condition"]:checked')?.value || 'new';
        const warehouseId = parseInt(document.getElementById('inv-warehouse').value);
        const qty = parseInt(document.getElementById('inv-qty').value);
        const note = document.getElementById('inv-note').value.trim();

        if (!partName) { app.showToast('请输入配件名称'); return; }
        if (this.type !== 'transfer' && !warehouseId) { app.showToast('请选择仓库'); return; }
        if (!qty || qty <= 0) { app.showToast('请输入有效数量'); return; }
        if (this.type === 'in' && price && isNaN(price)) { app.showToast('请输入有效价格'); return; }

        let part = await DB.get('parts', partName);
        if (!part) {
            const newId = await DB.run('parts', { name: partName, brand, category: '其他', min_stock: 1 });
            part = { id: newId.insertId };
        }
        const partId = part.id;

        const inventory = await DB.all('inventory');
        const invForPart = inventory.filter(i => i.part_id === partId);
        const invForWh = invForPart.find(i => i.warehouse_id === warehouseId);
        const currentQty = invForWh ? (invForWh.qty || 0) : 0;

        if (this.type === 'out') {
            if (currentQty < qty) { app.showToast('库存不足！当前: ' + currentQty); return; }
            if (invForWh) { invForWh.qty = currentQty - qty; await DB.run('inventory', invForWh); }
            await DB.run('records', { type: 'out', part_id: partId, warehouse_id: warehouseId, qty, note, unit_price: price });
            app.showToast('出库成功');
        } else if (this.type === 'in') {
            if (invForWh) {
                invForWh.qty = currentQty + qty;
                if (price) invForWh.unit_price = price;
                invForWh.condition = condition;
                await DB.run('inventory', invForWh);
            } else {
                const invData = { part_id: partId, warehouse_id: warehouseId, qty, condition };
                if (price) invData.unit_price = price;
                await DB.run('inventory', invData);
            }
            await DB.run('records', { type: 'in', part_id: partId, warehouse_id: warehouseId, qty, note, unit_price: price });
            app.showToast('入库成功');
        } else {
            const toWhId = parseInt(document.getElementById('inv-to-warehouse').value);
            if (!toWhId) { app.showToast('请选择目标仓库'); return; }
            if (toWhId === warehouseId) { app.showToast('源仓库和目标仓库不能相同'); return; }
            if (currentQty < qty) { app.showToast('源仓库库存不足！'); return; }
            if (invForWh) { invForWh.qty = currentQty - qty; await DB.run('inventory', invForWh); }
            const targetInv = invForPart.find(i => i.warehouse_id === toWhId);
            if (targetInv) { targetInv.qty = (targetInv.qty || 0) + qty; await DB.run('inventory', targetInv); }
            else { await DB.run('inventory', { part_id: partId, warehouse_id: toWhId, qty }); }
            await DB.run('records', { type: 'transfer', part_id: partId, warehouse_id: warehouseId, to_warehouse_id: toWhId, qty, note });
            app.showToast('调拨成功');
        }
        this.afterSubmit();
    },

    afterSubmit() {
        document.getElementById('inventory-form').reset();
        this.loadRecords();
    },

    async loadRecords() {
        const records = await DB.all('records');
        const parts = await DB.all('parts');
        const warehouses = await DB.all('warehouses');
        const partMap = {}; parts.forEach(p => partMap[p.id] = p);
        const whMap = {}; warehouses.forEach(w => whMap[w.id] = w);
        records.sort((a, b) => b.created_at - a.created_at);
        const recent = records.slice(0, 20);
        const el = document.getElementById('inventory-records');
        if (!recent.length) { el.innerHTML = '<p class="empty-text">暂无记录</p>'; return; }
        el.innerHTML = recent.map(r => {
            const typeLabel = r.type === 'in' ? '入库' : r.type === 'out' ? '出库' : '调拨';
            const p = partMap[r.part_id];
            const wh = whMap[r.warehouse_id];
            let detail = wh ? wh.name : '?';
            if (r.type === 'transfer' && r.to_warehouse_id) {
                const toWh = whMap[r.to_warehouse_id];
                detail = (wh ? wh.name : '?') + ' → ' + (toWh ? toWh.name : '?');
            }
            const priceInfo = r.unit_price ? ' <span style="color:#e67e22;font-weight:600;">¥' + r.unit_price + '</span>' : '';
            return `<div class="record-item">
                <span class="record-type ${r.type}">${typeLabel}</span>
                <span class="record-info">${p ? p.name : '?'} x${r.qty} ${detail}${priceInfo}</span>
                <span class="record-time">${app.formatTime(r.created_at)}</span>
            </div>`;
        }).join('');
    }
};
