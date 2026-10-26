// Location-level stock accounting, shared by forms, filters and quick +/-.
const Stock = {
    status(qty, minStock) {
        if (qty <= 0) return 'empty';
        return qty <= (minStock ?? 1) ? 'low' : 'available';
    },

    rows(parts, inventory, warehouses) {
        return parts.map(part => {
            const locations = this.distribution(part, inventory, warehouses);
            return { ...part, locations, qty: locations.reduce((sum, row) => sum + row.qty, 0) };
        });
    },

    scope(rows, { category = '', search = '', location = '' } = {}) {
        const query = search.trim().toLowerCase();
        return rows.filter(part => (!category || part.category === category) &&
            (!location || part.locations.some(row => row.location === location)) &&
            (!query || [part.name, part.model, part.brand, ...part.locations.map(row => row.location)]
                .some(value => String(value || '').toLowerCase().includes(query))))
            .map(part => ({ ...part, displayQty: location ?
                part.locations.find(row => row.location === location).qty : part.qty }));
    },

    availability(rows) {
        const counts = { '': 0, available: 0, low: 0, empty: 0 };
        for (const part of rows) {
            const qty = part.displayQty;
            const status = this.status(qty, part.min_stock);
            counts[''] += qty;
            if (status === 'empty') counts.empty++;
            else counts[status] += qty;
        }
        return counts;
    },

    distribution(part, inventory, warehouses) {
        const rows = inventory.filter(i => i.part_id === part.id);
        const groups = new Map();
        for (const row of rows) {
            const wh = warehouses.find(w => w.id === row.warehouse_id);
            const location = row.location?.trim() ||
                (wh && wh.name !== '默认仓库' ? wh.name : part.location?.trim()) || '未设置位置';
            const group = groups.get(location) || { location, qty: 0, warehouse_id: row.warehouse_id };
            group.qty += Number(row.qty) || 0;
            groups.set(location, group);
        }
        if (!groups.size) groups.set(part.location?.trim() || '未设置位置', {
            location: part.location?.trim() || '未设置位置', qty: Number(part.qty) || 0
        });
        return Array.from(groups.values());
    },

    validateLocations(locations) {
        if (!locations.length) throw new Error('请至少填写一个存放位置');
        const seen = new Set();
        return locations.map(row => {
            const location = String(row.location || '').trim();
            const qty = Number(row.qty);
            if (!location) throw new Error('请输入存放位置');
            if (seen.has(location)) throw new Error('同一个位置只需填写一行');
            if (String(row.qty).trim() === '' || !Number.isSafeInteger(qty) || qty < 0) {
                throw new Error('数量必须是大于或等于 0 的整数');
            }
            seen.add(location);
            return { location, qty };
        });
    },

    replenishment(parts, inventory, warehouses) {
        return parts.map(part => {
            const locations = this.distribution(part, inventory, warehouses);
            const qty = locations.reduce((sum, row) => sum + row.qty, 0);
            const status = this.status(qty, part.min_stock);
            const plannedQty = part.restock_plan?.qty || 0;
            return { ...part, qty, locations, status, plannedQty,
                suggestedQty: Math.max(1, (part.min_stock ?? 1) + 1 - qty) };
        }).filter(part => part.status !== 'available' || part.plannedQty > 0)
            .sort((a, b) => {
                const rank = { empty: 0, low: 1, available: 2 };
                return rank[a.status] - rank[b.status] || (b.plannedQty > 0) - (a.plannedQty > 0) ||
                    (a.name || '').localeCompare(b.name || '', 'zh');
            });
    },

    async planRestock(partId, qtyValue, locationValue) {
        const qty = Number(qtyValue);
        const location = String(locationValue || '').trim();
        if (String(qtyValue).trim() === '' || !Number.isSafeInteger(qty) || qty < 0) {
            throw new Error('计划数量必须是大于或等于 0 的整数');
        }
        if (qty > 0 && !location) throw new Error('请填写准备存放的位置');
        const parts = await DB.all('parts');
        const part = parts.find(p => p.id === partId);
        if (!part) throw new Error('配件已不存在');
        part.restock_plan = qty === 0 ? null : { qty, location, updated_at: Math.floor(Date.now() / 1000) };
        if (!DB.commitStores({ parts })) throw new Error('计划保存失败：请导出备份后清理存储空间');
    },

    async receiveRestock(partId, qtyValue, locationValue) {
        const qty = Number(qtyValue);
        const location = String(locationValue || '').trim();
        if (String(qtyValue).trim() === '' || !Number.isSafeInteger(qty) || qty <= 0) {
            throw new Error('实际买到的数量必须是大于 0 的整数');
        }
        if (!location) throw new Error('请选择或填写入库位置');
        const part = await DB.get('parts', partId);
        if (!part) throw new Error('配件已不存在');
        if (!(part.restock_plan?.qty > 0)) throw new Error('补货计划已完成或取消，请刷新清单');
        const rows = this.distribution(part, await DB.all('inventory'), await DB.all('warehouses'));
        let target = rows.find(row => row.location === location);
        if (!target) { target = { location, qty: 0 }; rows.push(target); }
        target.qty += qty;
        const remaining = Math.max(0, part.restock_plan.qty - qty);
        const restock_plan = remaining ? { ...part.restock_plan, qty: remaining,
            updated_at: Math.floor(Date.now() / 1000) } : null;
        return this.save(partId, { restock_plan }, rows, '补货清单入库');
    },

    history(records, partId) {
        return records.filter(record => record.part_id === partId).sort((a, b) =>
            (Number(b.created_at) || 0) - (Number(a.created_at) || 0) ||
            (Number(b.id) || 0) - (Number(a.id) || 0));
    },

    async save(partId, draft, locations, note = '编辑调整库存') {
        const desired = this.validateLocations(locations);
        const parts = await DB.all('parts');
        const inventory = await DB.all('inventory');
        const records = await DB.all('records');
        const warehouses = await DB.all('warehouses');
        const previous = parts.find(p => p.id === partId);
        if (partId && !previous) throw new Error('配件已不存在，请重新打开');
        const now = Math.floor(Date.now() / 1000);
        const nextId = rows => rows.reduce((n, r) => Math.max(n, Number(r.id) || 0), 0) + 1;
        if (!warehouses.length) warehouses.push({ id: 1, name: '默认仓库', created_at: now, updated_at: now });
        const id = previous ? previous.id : nextId(parts);
        const before = previous ? this.distribution(previous, inventory, warehouses) : [];
        const part = { ...previous, ...draft, id,
            qty: desired.reduce((sum, row) => sum + row.qty, 0),
            location: desired[0].location, created_at: previous?.created_at || now, updated_at: now };
        if (!Number.isSafeInteger(part.qty)) throw new Error('总数量过大');
        const newInventory = inventory.filter(i => i.part_id !== id);
        let inventoryId = nextId(inventory);
        let recordId = nextId(records);
        for (const row of desired) {
            const old = before.find(i => i.location === row.location);
            newInventory.push({ id: inventoryId++, part_id: id,
                warehouse_id: old?.warehouse_id || warehouses[0].id,
                location: row.location, qty: row.qty, condition: part.condition || 'new',
                unit_price: part.unit_price, updated_at: now });
        }
        for (const location of new Set([...before, ...desired].map(i => i.location))) {
            const old = before.find(i => i.location === location);
            const current = newInventory.find(i => i.part_id === id && i.location === location);
            const delta = (current?.qty || 0) - (old?.qty || 0);
            if (delta) records.push({ id: recordId++, part_id: id,
                warehouse_id: current?.warehouse_id || old?.warehouse_id || warehouses[0].id,
                location, type: delta > 0 ? 'in' : 'out', qty: Math.abs(delta),
                unit_price: part.unit_price, note, created_at: now });
        }
        const newParts = previous ? parts.map(p => p.id === id ? part : p) : [...parts, part];
        if (!DB.commitStores({ parts: newParts, inventory: newInventory, records, warehouses })) {
            throw new Error('保存失败：请导出备份后清理存储空间');
        }
        return part;
    },

    async adjust(partId, type, location) {
        if (!['in', 'out'].includes(type)) throw new Error('无效的操作');
        const part = await DB.get('parts', partId);
        if (!part) throw new Error('配件已不存在');
        const rows = this.distribution(part, await DB.all('inventory'), await DB.all('warehouses'));
        const row = rows.find(i => i.location === location);
        if (!row) throw new Error('位置已变化，请重新选择');
        if (type === 'out' && row.qty <= 0) throw new Error('这个位置已经没有库存');
        row.qty += type === 'in' ? 1 : -1;
        return this.save(partId, {}, rows, type === 'in' ? '快捷入库' : '快捷出库');
    }
};
