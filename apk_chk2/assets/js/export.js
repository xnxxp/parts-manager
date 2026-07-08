// export.js
const exportManager = {
    async exportInventory() {
        const inventory = await DB.all('inventory');
        const parts = await DB.all('parts');
        const warehouses = await DB.all('warehouses');
        const partMap = {}; parts.forEach(p => partMap[p.id] = p);
        const whMap = {}; warehouses.forEach(w => whMap[w.id] = w);

        const rows = inventory.filter(i => (i.qty || 0) > 0).map(i => ({
            仓库: whMap[i.warehouse_id]?.name || '?',
            配件: partMap[i.part_id]?.name || '?',
            型号: partMap[i.part_id]?.model || '',
            分类: partMap[i.part_id]?.category || '',
            库存数量: i.qty || 0,
            入库单价: i.unit_price || ''
        })).sort((a, b) => a.仓库.localeCompare(b.仓库, 'zh'));

        if (!rows.length) { app.showToast('暂无库存数据'); return; }
        this.downloadXlsx(rows, '库存明细', '库存明细');
    },

    async exportPrice() {
        const prices = await DB.all('prices');

        prices.sort((a, b) => b.created_at - a.created_at);
        const rows = prices.map(r => ({
            标题: r.title || '未命名',
            类型: r.excel_data ? 'Excel' : '图片',
            备注: r.note || '',
            上传时间: new Date(r.created_at * 1000).toLocaleString()
        }));

        if (!rows.length) { app.showToast('暂无价格表数据'); return; }
        this.downloadXlsx(rows, '价格表清单', '价格表清单');
    },

    async exportRecords() {
        const records = await DB.all('records');
        const parts = await DB.all('parts');
        const warehouses = await DB.all('warehouses');
        const partMap = {}; parts.forEach(p => partMap[p.id] = p);
        const whMap = {}; warehouses.forEach(w => whMap[w.id] = w);

        records.sort((a, b) => b.created_at - a.created_at);
        const rows = records.map(r => ({
            类型: r.type === 'in' ? '入库' : r.type === 'out' ? '出库' : '调拨',
            配件: partMap[r.part_id]?.name || '?',
            型号: partMap[r.part_id]?.model || '',
            仓库: whMap[r.warehouse_id]?.name || '?',
            目标仓库: r.to_warehouse_id ? (whMap[r.to_warehouse_id]?.name || '?') : '',
            数量: r.qty,
            单价: r.unit_price || '',
            备注: r.note || '',
            时间: new Date(r.created_at * 1000).toLocaleString()
        }));

        if (!rows.length) { app.showToast('暂无操作记录'); return; }
        this.downloadXlsx(rows, '操作记录', '操作记录');
    },

    backupData() {
        DB.all('warehouses').then(warehouses => {
            DB.all('parts').then(parts => {
                DB.all('inventory').then(inventory => {
                    DB.all('records').then(records => {
                        DB.all('prices').then(prices => {
                            const backup = {
                                version: '1.0',
                                date: new Date().toISOString(),
                                data: { warehouses, parts, inventory, records, prices }
                            };
                            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = '配件库存备份_' + new Date().toISOString().slice(0, 10) + '.json';
                            a.click();
                            URL.revokeObjectURL(url);
                            app.showToast('备份成功');
                        });
                    });
                });
            });
        });
    },

    importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const backup = JSON.parse(ev.target.result);
                if (!backup.data) { app.showToast('无效的备份文件'); return; }
                if (!confirm('恢复数据将覆盖现有数据，确定继续？')) return;
                const d = backup.data;

                localStorage.setItem(DB.DB_NAME + '_warehouses', JSON.stringify(d.warehouses || []));
                localStorage.setItem(DB.DB_NAME + '_parts', JSON.stringify(d.parts || []));
                localStorage.setItem(DB.DB_NAME + '_inventory', JSON.stringify(d.inventory || []));
                localStorage.setItem(DB.DB_NAME + '_records', JSON.stringify(d.records || []));
                localStorage.setItem(DB.DB_NAME + '_prices', JSON.stringify(d.prices || []));

                app.showToast('数据恢复成功');
                app.refreshDashboard();
            } catch (err) {
                console.error(err);
                app.showToast('恢复失败: 文件格式错误');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    },

    downloadXlsx(data, sheetName, fileName) {
        try {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
            a.click();
            URL.revokeObjectURL(url);
            app.showToast('导出成功');
        } catch (e) {
            console.error('Export error:', e);
            app.showToast('导出失败');
        }
    }
};
