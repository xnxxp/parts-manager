// export.js
const exportManager = {
    _pendingExport: null,  // { blob, fileName }

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
        this._generateXlsx(rows, '库存明细', '库存明细.xlsx');
    },

    async exportRecords() {
        const records = await DB.all('records');
        const parts = await DB.all('parts');
        const warehouses = await DB.all('warehouses');
        const partMap = {}; parts.forEach(p => partMap[p.id] = p);
        const whMap = {}; warehouses.forEach(w => whMap[w.id] = w);
        const rows = records.sort((a, b) => b.created_at - a.created_at).map(r => ({
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
        this._generateXlsx(rows, '操作记录', '操作记录.xlsx');
    },

    // Generate xlsx and show download confirm modal
    _generateXlsx(data, sheetName, fileName) {
        try {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const sizeKB = (blob.size / 1024).toFixed(1);
            this._pendingExport = { blob, fileName };
            this._showConfirmModal(fileName, sizeKB);
        } catch (e) {
            console.error('Export error:', e);
            app.showToast('导出失败');
        }
    },

    // Export price sheets: package images + excel files into a zip
    async exportPrice() {
        const prices = await DB.all('prices');
        prices.sort((a, b) => b.created_at - a.created_at);

        if (!prices.length) { app.showToast('暂无价格表数据'); return; }

        try {
            const zip = new JSZip();
            const folder = zip.folder('价格表导出');

            // Add a manifest/readme
            let manifest = '价格表导出清单\n================\n导出时间：' + new Date().toLocaleString() + '\n\n';
            let fileCount = 0;

            for (const price of prices) {
                const safeName = (price.title || '未命名').replace(/[\\/:*?"<>|]/g, '_');
                const entry = folder.folder(safeName);

                // Add image if exists
                if (price.image) {
                    const imgData = this._dataURLToBlob(price.image);
                    entry.file(safeName + '.jpg', imgData);
                    manifest += '[图片] ' + safeName + '.jpg\n';
                    fileCount++;
                }

                // Add excel file if exists
                if (price.excel_data) {
                    const base64 = price.excel_data.includes(',') ? price.excel_data.split(',')[1] : price.excel_data;
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    entry.file(safeName + '.xlsx', bytes);
                    manifest += '[Excel] ' + safeName + '.xlsx\n';
                    fileCount++;
                }

                // Add note if exists
                if (price.note) {
                    entry.file('备注.txt', price.note, { type: 'text/plain;charset=utf-8' });
                    manifest += '[备注] ' + safeName + '/备注.txt\n';
                    fileCount++;
                }
            }

            // Add manifest to root
            zip.file('导出清单.txt', manifest, { type: 'text/plain;charset=utf-8' });

            const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionLevel: 6 });
            const sizeKB = (zipBlob.size / 1024).toFixed(1);
            const fileName = '价格表导出_' + new Date().toISOString().slice(0, 10) + '.zip';

            this._pendingExport = { blob: zipBlob, fileName: fileName };
            this._showConfirmModal(fileName, sizeKB);
        } catch (e) {
            console.error('Export price error:', e);
            app.showToast('导出失败');
        }
    },

    // Backup all data into a zip file
    backupData() {
        DB.all('warehouses').then(warehouses => {
            DB.all('parts').then(parts => {
                DB.all('inventory').then(inventory => {
                    DB.all('records').then(records => {
                        DB.all('prices').then(prices => {
                            DB.exportAllImages().then(images => {
                                const backup = {
                                    version: '2.0',
                                    date: new Date().toISOString(),
                                    data: { warehouses, parts, inventory, records, prices, images }
                                };
                                const jsonStr = JSON.stringify(backup, null, 2);
                                const blob = new Blob([jsonStr], { type: 'application/json' });
                                const fileName = '配件库存备份_' + new Date().toISOString().slice(0, 10) + '.json';
                                const sizeKB = (blob.size / 1024).toFixed(1);
                                this._pendingExport = { blob, fileName };
                                this._showConfirmModal(fileName, sizeKB);
                            });
                        });
                    });
                });
            });
        });
    },

    // Show unified download confirm modal
    _showConfirmModal(fileName, sizeKB) {
        document.getElementById('dl-file-name').textContent = fileName;
        document.getElementById('dl-file-size').textContent = sizeKB + ' KB';
        app._openModal('modal-download');
    },

    // User clicked "下载保存"
    confirmDownload() {
        app._closeModal('modal-download');
        if (!this._pendingExport) return;
        const { blob, fileName } = this._pendingExport;

        if (window.AndroidBridge && AndroidBridge.saveFile) {
            const reader = new FileReader();
            reader.onload = function(e) {
                var base64 = e.target.result.includes(',') ? e.target.result.split(',')[1] : e.target.result;
                var mimeType = blob.type || 'application/octet-stream';
                AndroidBridge.saveFile(base64, fileName, mimeType);
            };
            reader.readAsDataURL(blob);
            window._onSaveFileResult = function(result) {
                if (result.startsWith('success:')) {
                    app.showToast('已保存: ' + result.substring(8));
                } else {
                    app.showToast('保存失败: ' + result.substring(7));
                }
                exportManager._pendingExport = null;
            };
        } else {
            this._saveWithAnchor(blob, fileName);
            this._pendingExport = null;
        }
    },

    closeDownloadModal() {
        app._closeModal('modal-download');
        this._pendingExport = null;
    },

    closeBackupModal() {
        document.getElementById('modal-backup').style.display = 'none';
    },

    // Fallback: browser download
    _saveWithAnchor(blob, fileName) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
        app.showToast('文件已下载');
    },

    // Convert dataURL to Blob
    _dataURLToBlob(dataURL) {
        var parts = dataURL.split(',');
        var mime = parts[0].match(/:(.*?);/)[1];
        var b64 = atob(parts[1]);
        var bytes = new Uint8Array(b64.length);
        for (var i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
        return new Blob([bytes], { type: mime });
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

                if (d.images && Object.keys(d.images).length > 0) {
                    await DB.importImages(d.images);
                }

                app.showToast('数据恢复成功');
                app.refreshDashboard();
            } catch (err) {
                console.error(err);
                app.showToast('恢复失败: 文件格式错误');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
};
