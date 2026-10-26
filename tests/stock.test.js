const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(seed = {}) {
    const data = new Map();
    const elements = new Map();
    let failKey;
    const storage = {
        getItem: key => data.get(key) ?? null,
        setItem(key, value) {
            if (key === failKey) { failKey = undefined; throw new Error('Quota exceeded'); }
            data.set(key, String(value));
        },
        removeItem: key => data.delete(key)
    };
    for (const name of ['parts', 'inventory', 'warehouses', 'records', 'prices']) {
        storage.setItem('parts_manager_' + name, JSON.stringify(seed[name] || []));
    }
    const context = vm.createContext({
        localStorage: storage, console, setTimeout, clearTimeout, Blob,
        indexedDB: { open() { const req = {}; queueMicrotask(() => req.onerror()); return req; } },
        app: { showToast() {} }, window: { addEventListener() {} }, navigator: {},
        document: { addEventListener() {}, getElementById(id) {
            if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '' });
            return elements.get(id);
        } },
        escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    });
    for (const file of ['database', 'stock', 'parts', 'export', 'app']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/js/' + file + '.js'), 'utf8') +
            '\nglobalThis.' + file + 'API = ' + ({ database: 'DB', stock: 'Stock', parts: 'partsManager', export: 'exportManager', app: 'app' }[file]) + ';', context);
    }
    const db = context.databaseAPI, stock = context.stockAPI, manager = context.partsAPI;
    context.appAPI.showToast = () => {};
    manager.renderNextPage = () => {};
    return { db, stock, manager, storage, elements, app: context.appAPI, exportManager: context.exportAPI, fail: key => { failKey = key; } };
}

const legacy = {
    parts: [{ id: 1, name: 'iPhone14屏幕', category: '屏幕', model: 'iPhone14', location: '背包', qty: 3, min_stock: 1 }],
    warehouses: [{ id: 1, name: '默认仓库' }],
    inventory: [{ id: 1, part_id: 1, warehouse_id: 1, qty: 3 }]
};

test('old single-location data retains its location and quantity', async () => {
    const { db, stock } = fixture(legacy);
    await db.init();
    const rows = stock.distribution(await db.get('parts', 1), await db.all('inventory'), await db.all('warehouses'));
    assert.equal(rows[0].location, '背包');
    assert.equal(rows[0].qty, 3);
});

test('legacy warehouses remain separate; drained stock stays zero after restart', async () => {
    const f = fixture({ ...legacy, parts: [{ ...legacy.parts[0], qty: 20 }],
        warehouses: [{ id: 1, name: '家里' }, { id: 2, name: '后备箱' }],
        inventory: [{ id: 1, part_id: 1, warehouse_id: 1, qty: 0 }, { id: 2, part_id: 1, warehouse_id: 2, qty: 2 }] });
    await f.db.init();
    const part = await f.db.get('parts', 1);
    assert.equal(part.qty, 2);
    assert.deepEqual(Array.from(f.stock.distribution(part, await f.db.all('inventory'), await f.db.all('warehouses')), i => [i.location, i.qty]), [['家里', 0], ['后备箱', 2]]);
});

test('splitting a part across locations keeps total and location history consistent', async () => {
    const { db, stock } = fixture(legacy);
    const part = await stock.save(1, { min_stock: 0 }, [{ location: '背包', qty: 2 }, { location: '家里', qty: 5 }]);
    assert.equal(part.qty, 7);
    assert.equal(part.min_stock, 0);
    assert.deepEqual(Array.from(await db.all('records'), r => [r.location, r.type, r.qty]), [['背包', 'out', 1], ['家里', 'in', 5]]);
    await db.init();
    assert.equal((await db.get('parts', 1)).qty, 7);
});

test('taking from one location never consumes stock from another', async () => {
    const { db, stock } = fixture(legacy);
    await stock.save(1, {}, [{ location: '背包', qty: 1 }, { location: '家里', qty: 5 }]);
    await stock.adjust(1, 'out', '背包');
    await assert.rejects(stock.adjust(1, 'out', '背包'), /没有库存/);
    assert.equal((await db.get('parts', 1)).qty, 5);
    assert.equal((await db.all('inventory')).find(r => r.location === '家里').qty, 5);
    await stock.adjust(1, 'in', '背包');
    assert.equal((await db.get('parts', 1)).qty, 6);
});

test('metadata-only edit retains quantity and does not add fake stock history', async () => {
    const { db, stock } = fixture(legacy);
    await stock.save(1, { note: '' }, [{ location: '背包', qty: 3 }]);
    assert.equal((await db.all('records')).length, 0);
    assert.equal((await db.get('parts', 1)).qty, 3);
});

test('zero stock retains its location and can be restocked', async () => {
    const { db, stock } = fixture();
    const part = await stock.save(null, { name: '电池' }, [{ location: '后备箱', qty: 0 }]);
    await db.init();
    await stock.adjust(part.id, 'in', '后备箱');
    assert.equal((await db.get('parts', part.id)).qty, 1);
});

test('invalid, fractional, negative or duplicate location quantities are rejected', () => {
    const { stock } = fixture();
    for (const qty of ['', -1, 1.5, 'oops', Infinity]) {
        assert.throws(() => stock.validateLocations([{ location: '背包', qty }]));
    }
    assert.throws(() => stock.validateLocations([{ location: ' 背包', qty: 1 }, { location: '背包 ', qty: 2 }]), /一行/);
    assert.throws(() => stock.validateLocations([{ location: '', qty: 1 }]));
    assert.equal(stock.status(0, 0), 'empty');
    assert.equal(stock.status(1, 0), 'available');
    assert.equal(stock.status(1, 1), 'low');
});

for (const key of ['stock_journal', 'parts', 'inventory', 'records', 'warehouses']) {
    test('failed write rolls back all stock stores: ' + key, async () => {
        const f = fixture(legacy);
        const names = ['parts', 'inventory', 'records', 'warehouses'];
        const before = names.map(n => f.storage.getItem('parts_manager_' + n));
        f.fail('parts_manager_' + key);
        await assert.rejects(f.stock.save(1, {}, [{ location: '背包', qty: 8 }]));
        assert.deepEqual(names.map(n => f.storage.getItem('parts_manager_' + n)), before);
        assert.equal(f.storage.getItem('parts_manager_stock_journal'), null);
    });
}

test('interrupted transaction is recovered at app startup', async () => {
    const f = fixture(legacy);
    const previous = { parts_manager_parts: f.storage.getItem('parts_manager_parts'),
        parts_manager_inventory: f.storage.getItem('parts_manager_inventory') };
    f.storage.setItem('parts_manager_stock_journal', JSON.stringify(previous));
    f.storage.setItem('parts_manager_parts', '[]');
    await f.db.init();
    assert.equal((await f.db.get('parts', 1)).qty, 3);
    assert.equal(f.storage.getItem('parts_manager_stock_journal'), null);
});

test('combined filters use selected-location quantity and keep empty locations discoverable', async () => {
    const f = fixture(legacy);
    await f.stock.save(1, {}, [{ location: '背包', qty: 0 }, { location: '家里', qty: 5 }]);
    await f.manager.filterLocation('背包');
    assert.equal(f.manager._allRows[0].displayQty, 0);
    await f.manager.filterStatus('empty');
    assert.equal(f.manager._allRows.length, 1);
    await f.manager.filterStatus('available');
    assert.equal(f.manager._allRows.length, 0);
    await f.manager.filterLocation('家里');
    assert.equal(f.manager._allRows.length, 1);
    f.elements.get('parts-search').value = 'iPhone14';
    await f.manager.load();
    assert.equal(f.manager._allRows.length, 1);
    await f.manager.filterCategory('电池');
    assert.equal(f.manager._allRows.length, 0);
    await f.manager.clearFilters();
    f.elements.get('parts-search').value = '家里';
    await f.manager.load();
    assert.equal(f.manager._allRows[0].qty, 5);
});

test('restock candidates use total stock, retain open plans and honor disabled warnings', () => {
    const { stock } = fixture();
    const parts = [
        { id: 1, name: '屏幕', qty: 0, min_stock: 1 },
        { id: 2, name: '电池', qty: 1, min_stock: 1 },
        { id: 3, name: '排线', qty: 1, min_stock: 0 },
        { id: 4, name: '摄像头', qty: 5, min_stock: 1, restock_plan: { qty: 2, location: '背包' } },
        { id: 5, name: '充电口', qty: 0, min_stock: 0 }
    ];
    const inventory = [{ id: 1, part_id: 1, location: '背包', qty: 0 }, { id: 2, part_id: 1, location: '家里', qty: 5 }];
    const rows = stock.replenishment(parts, inventory, []);
    assert.deepEqual(Array.from(rows, r => r.id), [5, 2, 4]);
    assert.equal(rows.find(r => r.id === 2).suggestedQty, 1);
});

test('restock plans survive backup and restore without changing stock or history', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, '6', ' 家里 ');
    assert.equal((await f.db.get('parts', 1)).qty, 3);
    assert.equal((await f.db.all('records')).length, 0);
    const backup = JSON.parse(await (await f.exportManager._buildBackupBlob()).text());
    const restored = fixture(backup.data);
    await restored.db.init();
    const plan = (await restored.db.get('parts', 1)).restock_plan;
    assert.equal(plan.qty, 6);
    assert.equal(plan.location, '家里');
    assert.equal(restored.stock.replenishment(await restored.db.all('parts'), await restored.db.all('inventory'), await restored.db.all('warehouses')).length, 1);
});

test('partial delivery increments only the selected location and keeps the remaining plan', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, 5, '背包');
    const part = await f.stock.receiveRestock(1, 2, '背包');
    assert.equal(part.qty, 5);
    assert.equal(part.restock_plan.qty, 3);
    const records = await f.db.all('records');
    assert.equal(records.length, 1);
    assert.equal(records[0].qty, 2);
    assert.equal(records[0].location, '背包');
    assert.equal(records[0].note, '补货清单入库');
});

test('delivery to a new location completes plan; a repeated receipt cannot add stock twice', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, 2, '后备箱');
    const part = await f.stock.receiveRestock(1, 3, '后备箱');
    assert.equal(part.qty, 6);
    assert.equal(part.restock_plan, null);
    assert.equal((await f.db.all('inventory')).find(r => r.location === '背包').qty, 3);
    assert.equal((await f.db.all('inventory')).find(r => r.location === '后备箱').qty, 3);
    await assert.rejects(f.stock.receiveRestock(1, 3, '后备箱'), /已完成或取消/);
    assert.equal((await f.db.get('parts', 1)).qty, 6);
    assert.equal(f.stock.replenishment(await f.db.all('parts'), await f.db.all('inventory'), await f.db.all('warehouses')).length, 0);
});

test('a completed small plan remains a candidate if stock is still low', async () => {
    const f = fixture({ parts: [{ id: 1, name: '电池', qty: 0, min_stock: 5 }] });
    await f.stock.planRestock(1, 2, '家里');
    await f.stock.receiveRestock(1, 2, '家里');
    const rows = f.stock.replenishment(await f.db.all('parts'), await f.db.all('inventory'), await f.db.all('warehouses'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].plannedQty, 0);
    assert.equal(rows[0].status, 'low');
});

test('cancelling a plan leaves stock and history unchanged', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, 4, '背包');
    await f.stock.planRestock(1, 0, '');
    assert.equal((await f.db.get('parts', 1)).restock_plan, null);
    assert.equal((await f.db.get('parts', 1)).qty, 3);
    assert.equal((await f.db.all('records')).length, 0);
});

test('bad plan or receipt input cannot change any inventory', async () => {
    const f = fixture(legacy);
    for (const qty of ['', -1, 1.5, Infinity, 'abc']) await assert.rejects(f.stock.planRestock(1, qty, '背包'));
    await assert.rejects(f.stock.planRestock(1, 2, ' '));
    await f.stock.planRestock(1, 4, '背包');
    for (const qty of ['', 0, -1, 1.5, Infinity, 'abc']) await assert.rejects(f.stock.receiveRestock(1, qty, '背包'));
    await assert.rejects(f.stock.receiveRestock(1, 2, ' '));
    await assert.rejects(f.stock.receiveRestock(99, 2, '背包'));
    assert.equal((await f.db.get('parts', 1)).qty, 3);
    assert.equal((await f.db.get('parts', 1)).restock_plan.qty, 4);
    assert.equal((await f.db.all('records')).length, 0);
});

test('a failed delivery keeps its plan, inventory and records together', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, 2, '背包');
    f.fail('parts_manager_records');
    await assert.rejects(f.stock.receiveRestock(1, 2, '背包'));
    assert.equal((await f.db.get('parts', 1)).qty, 3);
    assert.equal((await f.db.get('parts', 1)).restock_plan.qty, 2);
    assert.equal((await f.db.all('inventory'))[0].qty, 3);
    assert.equal((await f.db.all('records')).length, 0);
});

test('failed plan saving does not replace the previous plan', async () => {
    const f = fixture(legacy);
    await f.stock.planRestock(1, 3, '家里');
    f.fail('parts_manager_parts');
    await assert.rejects(f.stock.planRestock(1, 8, '后备箱'));
    assert.equal((await f.db.get('parts', 1)).restock_plan.qty, 3);
    assert.equal((await f.db.get('parts', 1)).restock_plan.location, '家里');
});

test('history shows only this part with most recent events first, including same-second events', () => {
    const { stock } = fixture();
    const records = [{ id: 1, part_id: 1, created_at: 10 }, { id: 2, part_id: 2, created_at: 30 },
        { id: 3, part_id: 1, created_at: 20 }, { id: 4, part_id: 1, created_at: 20 }];
    assert.deepEqual(Array.from(stock.history(records, 1), r => r.id), [4, 3, 1]);
    assert.deepEqual(records.map(r => r.id), [1, 2, 3, 4]);
});

test('history labels old transfers correctly and escapes user text without guessing old locations', () => {
    const { manager } = fixture();
    const html = manager.historyRowsHTML([
        { type: 'in', qty: 3, warehouse_id: 1, note: '<script>alert(1)</script>' },
        { type: 'transfer', qty: 2, warehouse_id: 2, to_warehouse_id: 3, created_at: 100 },
        { type: 'out', qty: 1, location: '背包"<>' }
    ], [{ id: 1, name: '默认仓库' }, { id: 2, name: '家里' }, { id: 3, name: '后备箱' }]);
    assert.ok(html.includes('入库 +3 件'));
    assert.ok(html.includes('旧记录未标注位置'));
    assert.ok(html.includes('家里 → 后备箱'));
    assert.ok(html.includes('出库 −1 件'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('背包&quot;&lt;&gt;'));
});

test('history pagination reaches every record while the initial detail stays short', async () => {
    const records = Array.from({ length: 25 }, (_, n) => ({ id: n + 1, part_id: 1, type: 'in', qty: 1, created_at: n + 1 }));
    const f = fixture({ ...legacy, records });
    f.manager._detailPartId = 1;
    await f.manager.renderHistory();
    assert.equal((f.elements.get('part-history').innerHTML.match(/<li /g) || []).length, 10);
    await f.manager.moreHistory();
    await f.manager.moreHistory();
    assert.equal((f.elements.get('part-history').innerHTML.match(/<li /g) || []).length, 25);
    assert.ok(!f.elements.get('part-history').innerHTML.includes('查看更多'));
});

test('availability partitions pieces without overlapping; empty stock counts kinds', async () => {
    const f = fixture({ parts: [
        { id: 1, name: '屏幕', location: '背包', qty: 1, min_stock: 1 },
        { id: 2, name: '电池', location: '家里', qty: 5, min_stock: 1 },
        { id: 3, name: '排线', location: '背包', qty: 0, min_stock: 1 }
    ] });
    await f.manager.load();
    const counts = f.stock.availability(f.manager._allRows);
    assert.equal(counts.available, 5);
    assert.equal(counts.low, 1);
    assert.equal(counts.empty, 1);
    assert.equal(counts.available + counts.low, counts['']);
    assert.equal(f.elements.get('stat-stock').textContent, 6);
    const html = f.elements.get('stock-filters').innerHTML;
    assert.ok(html.includes('库存充足 <span>5 件</span>'));
    assert.ok(html.includes('快用完 <span>1 件</span>'));
    assert.ok(html.includes('已用完 <span>1 种</span>'));
    await f.manager.filterStatus('available');
    assert.deepEqual(Array.from(f.manager._allRows, row => row.id), [2]);
    await f.manager.filterStatus('low');
    assert.deepEqual(Array.from(f.manager._allRows, row => row.id), [1]);
    assert.equal(f.elements.get('stat-stock').textContent, 6);
    await f.manager.filterStatus('empty');
    assert.deepEqual(Array.from(f.manager._allRows, row => row.id), [3]);
    assert.equal(f.elements.get('stat-stock').textContent, 6);
});

test('header refresh keeps the same location/category/search scope as status counters', async () => {
    const f = fixture({ parts: [
        { id: 1, name: '屏幕', category: '屏幕', qty: 6, min_stock: 1 },
        { id: 2, name: '电池', category: '电池', qty: 2, min_stock: 1 }
    ], inventory: [
        { id: 1, part_id: 1, location: '背包', qty: 1 },
        { id: 2, part_id: 1, location: '家里', qty: 5 },
        { id: 3, part_id: 2, location: '背包', qty: 2 }
    ] });
    await f.manager.filterLocation('背包');
    assert.equal(f.elements.get('stat-stock').textContent, 3);
    assert.equal(f.elements.get('stat-stock-label').textContent, '筛选库存（件）');
    await f.app.updateStatsBar();
    assert.equal(f.elements.get('stat-stock').textContent, 3);
    await f.manager.filterStatus('available');
    assert.equal(f.manager._allRows.length, 1);
    assert.equal(f.elements.get('stat-stock').textContent, 3);
    await f.manager.filterCategory('屏幕');
    assert.equal(f.manager._allRows.length, 0);
    await f.app.updateStatsBar();
    assert.equal(f.elements.get('stat-stock').textContent, 1);
    await f.manager.clearFilters();
    assert.equal(f.elements.get('stat-stock').textContent, 8);
    f.elements.get('parts-search').value = '电池';
    await f.manager.load();
    await f.app.updateStatsBar();
    assert.equal(f.elements.get('stat-stock').textContent, 2);
    assert.ok(f.elements.get('stock-filters').innerHTML.includes('库存充足 <span>2 件</span>'));
});

test('a stock change moves pieces between availability counters with the total preserved', async () => {
    const f = fixture({ parts: [{ id: 1, name: '电池', location: '背包', qty: 1, min_stock: 1 }] });
    await f.db.init();
    await f.manager.load();
    assert.equal(f.stock.availability(f.manager._allRows).low, 1);
    await f.stock.adjust(1, 'in', '背包');
    await f.manager.load();
    const after = f.stock.availability(f.manager._allRows);
    assert.equal(after.available, 2);
    assert.equal(after.low, 0);
    assert.equal(after.available + after.low, f.elements.get('stat-stock').textContent);
});

test('disabled low-stock warnings count all positive pieces as sufficient', () => {
    const f = fixture();
    const counts = f.stock.availability([
        { displayQty: 100, min_stock: 0 }, { displayQty: 1, min_stock: 0 }, { displayQty: 0, min_stock: 0 }
    ]);
    assert.equal(counts.available, 101);
    assert.equal(counts.low, 0);
    assert.equal(counts[''], 101);
    assert.equal(counts.empty, 1);
});
