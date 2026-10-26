// export.js
const exportManager = {
    _pendingExport: null,  // { blob, fileName }
    _pendingImport: null,
    _importReader: null,
    _importInput: null,
    _importRestoring: false,
    _importState: 'closed',
    _importSummary: '',

    async exportInventory() {
        const inventory = await DB.all('inventory');
        const parts = await DB.all('parts');
        const warehouses = await DB.all('warehouses');
        const partMap = {}; parts.forEach(p => partMap[p.id] = p);
        const whMap = {}; warehouses.forEach(w => whMap[w.id] = w);

        const rows = inventory.filter(i => (i.qty || 0) > 0).map(i => ({
            仓库: whMap[i.warehouse_id]?.name || '?',
            存放位置: i.location || Stock.distribution(partMap[i.part_id] || {}, [i], warehouses)[0]?.location || '',
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
            存放位置: r.location || whMap[r.warehouse_id]?.name || '',
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

                // Add image if exists. price.image may be an IndexedDB id (the
                // common case since photos moved to IDB) or a legacy inline data
                // URL — resolve it to a data URL before converting to a Blob,
                // otherwise _dataURLToBlob throws on a bare id and the whole
                // export fails.
                if (price.image) {
                    const resolved = await DB.resolveImage(price.image);
                    if (resolved) {
                        const imgData = this._dataURLToBlob(resolved);
                        entry.file(safeName + '.jpg', imgData);
                        manifest += '[图片] ' + safeName + '.jpg\n';
                        fileCount++;
                    }
                }

                // Add excel file if exists
                if (price.excel_data) {
                    const base64 = price.excel_data.split(',')[1];
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

    // Build a full JSON backup blob (all stores + images). Shared by the manual
    // "备份数据" action and the silent auto-backup.
    async _buildBackupBlob() {
        const [warehouses, parts, inventory, records, prices, images] = await Promise.all([
            DB.all('warehouses'), DB.all('parts'), DB.all('inventory'),
            DB.all('records'), DB.all('prices'), DB.exportAllImages()
        ]);
        this.checkImages([...parts, ...prices], images);
        const backup = {
            version: '2.0',
            date: new Date().toISOString(),
            data: { warehouses, parts, inventory, records, prices, images }
        };
        return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    },

    // Backup all data into a zip file
    async backupData() {
        try {
            const blob = await this._buildBackupBlob();
            const fileName = '配件库存备份_' + new Date().toISOString().slice(0, 10) + '.json';
            const sizeKB = (blob.size / 1024).toFixed(1);
            this._pendingExport = { blob, fileName };
            this._showConfirmModal(fileName, sizeKB);
        } catch (e) {
            console.error('Backup error:', e);
            app.showToast(e.message || '备份失败');
        }
    },

    // Show unified download confirm modal
    _showConfirmModal(fileName, sizeKB) {
        document.getElementById('dl-file-name').textContent = fileName;
        document.getElementById('dl-file-size').textContent = sizeKB + ' KB';
        app._openModal('modal-download');
    },

    // User clicked "下载保存"
    async confirmDownload() {
        app._closeModal('modal-download');
        if (!this._pendingExport) return;
        const { blob, fileName } = this._pendingExport;
        this._pendingExport = null;
        try {
            if (window.AndroidBridge && window.AndroidBridge.saveFile) {
                const base64 = await app.blobToBase64(blob);
                await app.saveNative('saveFile', base64, fileName, blob.type || 'application/octet-stream');
                app.showToast('已保存: ' + fileName);
            } else this._saveWithAnchor(blob, fileName);
        } catch (e) { app.showToast(e.message || '保存失败'); }
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

    isImageData(value) {
        return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(value);
    },

    checkImages(rows, images) {
        for (const row of rows) {
            if (!row.image) continue;
            const value = this.isImageData(row.image) ? row.image :
                (Object.prototype.hasOwnProperty.call(images, row.image) ? images[row.image] : null);
            if (!this.isImageData(value)) throw new Error('图片缺失或损坏，无法完成备份或恢复');
        }
    },

    validateBackup(backup) {
        const fail = detail => { throw new Error('备份文件格式错误：' + detail); };
        const input = backup?.data;
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail('缺少数据');
        const stores = ['warehouses', 'parts', 'inventory', 'records', 'prices'];
        const data = {};
        const ids = {};
        const integer = value => Number.isSafeInteger(value) && value >= 0;
        for (const name of stores) {
            if (!Array.isArray(input[name])) fail(name + ' 应为数组');
            ids[name] = new Set();
            data[name] = input[name].map(row => {
                if (!row || typeof row !== 'object' || Array.isArray(row) ||
                    !integer(row.id) || row.id === 0 || ids[name].has(row.id)) fail(name + ' 编号无效或重复');
                ids[name].add(row.id);
                for (const key of ['name', 'category', 'brand', 'model', 'location', 'note', 'title', 'image', 'excel_data']) {
                    if (row[key] != null && typeof row[key] !== 'string') fail(name + '.' + key);
                }
                for (const key of ['qty', 'min_stock', 'created_at', 'updated_at']) {
                    if (row[key] != null && !integer(row[key])) fail(name + '.' + key);
                }
                if (row.unit_price != null && (typeof row.unit_price !== 'number' || !Number.isFinite(row.unit_price) || row.unit_price < 0)) fail(name + '.unit_price');
                if (row.condition != null && !['new', 'old'].includes(row.condition)) fail(name + '.condition');
                if ((name === 'parts' || name === 'warehouses') && !row.name?.trim()) fail(name + '.name');
                if (name === 'parts' && row.restock_plan != null) {
                    const plan = row.restock_plan;
                    if (!integer(plan.qty) || plan.qty === 0 || typeof plan.location !== 'string' || !plan.location.trim()) fail('补货计划');
                }
                if (name === 'records' && !['in', 'out', 'transfer'].includes(row.type)) fail('记录类型');
                if ((name === 'inventory' || name === 'records') && !integer(row.qty)) fail(name + '.qty');
                return { ...row };
            });
        }
        for (const row of [...data.inventory, ...data.records]) {
            if (!ids.parts.has(row.part_id)) fail('库存或记录引用不存在的配件');
            for (const key of ['warehouse_id', 'to_warehouse_id']) {
                if (row[key] != null && !ids.warehouses.has(row[key])) fail('库存或记录引用不存在的仓库');
            }
        }
        data.images = input.images === undefined ? {} : input.images;
        if (!data.images || typeof data.images !== 'object' || Array.isArray(data.images)) fail('images');
        for (const value of Object.values(data.images)) if (!this.isImageData(value)) fail('图片内容');
        this.checkImages([...data.parts, ...data.prices], data.images);
        // Normalize legacy backups before committing so the first screen and
        // subsequent launches use the same inventory source of truth.
        if (!data.warehouses.length) data.warehouses.push({ id: 1, name: '默认仓库' });
        let inventoryId = data.inventory.reduce((max, row) => Math.max(max, row.id), 0);
        for (const part of data.parts) {
            const rows = data.inventory.filter(row => row.part_id === part.id);
            part.qty = rows.length ? rows.reduce((sum, row) => sum + row.qty, 0) : (part.qty ?? 0);
            if (!integer(part.qty)) fail('库存总数量过大');
            if (!rows.length && part.qty > 0) data.inventory.push({ id: ++inventoryId, part_id: part.id,
                warehouse_id: data.warehouses[0].id, qty: part.qty, location: part.location || '未设置位置' });
        }
        return data;
    },

    async restoreBackup(backup) {
        const data = this.validateBackup(backup);
        if (partsManager._stockBusy) throw new Error('正在处理，请稍候再恢复');
        partsManager._stockBusy = true;
        const staged = {};
        const prefix = 'restore_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_';
        let committed = false;
        try {
            // Fresh image keys keep the current photos intact if any later
            // write fails. Interrupted staging only leaves unused image blobs.
            const keys = new Map();
            for (const row of [...data.parts, ...data.prices]) {
                if (!row.image || this.isImageData(row.image)) continue;
                if (!keys.has(row.image)) {
                    const key = prefix + keys.size;
                    keys.set(row.image, key);
                    staged[key] = data.images[row.image];
                }
                row.image = keys.get(row.image);
            }
            if (Object.keys(staged).length && !await DB.importImages(staged)) throw new Error('图片写入失败，原有数据未替换');
            const { images, ...stores } = data;
            if (!DB.commitStores(stores)) throw new Error('恢复失败：存储空间不足，原有数据已保留');
            committed = true;
        } finally {
            if (!committed) for (const key of Object.keys(staged)) await DB.deleteImage(key);
            partsManager._stockBusy = false;
        }
    },

    _showImportState(state, message) {
        this._importState = state;
        document.getElementById('modal-import').dataset.state = state;
        document.getElementById('import-title').textContent = {
            reading: '正在读取备份', confirm: '确认恢复数据', restoring: '正在恢复数据',
            success: '恢复完成', error: '无法恢复数据'
        }[state];
        document.getElementById('import-message').textContent = message;
        const summary = document.getElementById('import-summary');
        summary.textContent = this._importSummary;
        summary.hidden = !['confirm', 'success'].includes(state);
        document.getElementById('import-progress').hidden = !['reading', 'restoring'].includes(state);
        const confirmButton = document.getElementById('import-confirm');
        confirmButton.hidden = state !== 'confirm';
        confirmButton.disabled = state !== 'confirm';
        const closeButton = document.getElementById('import-close');
        closeButton.textContent = ['reading', 'confirm'].includes(state) ? '取消' : '关闭';
        closeButton.disabled = state === 'restoring';
        document.getElementById('import-dismiss').disabled = state === 'restoring';
    },

    _showImportError(error) {
        this._pendingImport = null;
        this._showImportState('error', error instanceof SyntaxError ?
            '恢复失败：文件格式错误，请选择 App 导出的 JSON 备份。' : (error.message || '恢复失败，请重试。'));
    },

    // Called by every modal close path, including backdrop taps and back actions.
    beforeCloseImport() {
        if (this._importRestoring) { app.showToast('正在恢复数据，请稍候'); return false; }
        const reader = this._importReader;
        this._importReader = null;
        if (this._importInput) this._importInput.value = '';
        this._importInput = null;
        this._pendingImport = null;
        this._importSummary = '';
        this._importState = 'closed';
        if (reader?.readyState === 1) reader.abort();
        return true;
    },

    async confirmImport() {
        if (!this._pendingImport || this._importRestoring) return;
        const backup = this._pendingImport;
        this._importRestoring = true;
        this._showImportState('restoring', '正在恢复配件、库存、记录和图片，请稍候。');
        try {
            await this.restoreBackup(backup);
            this._pendingImport = null;
            this._showImportState('success', '数据已恢复，可以关闭窗口查看库存。');
            app.showToast('数据恢复成功');
            app.refreshDashboard();
        } catch (error) {
            this._showImportError(error);
        } finally {
            this._importRestoring = false;
        }
    },

    // Parsing/confirmation stays outside persistence. Never use window.confirm:
    // the iOS WebView may suppress native JavaScript dialogs and return false.
    importData(e) {
        const input = e.target;
        const file = input.files?.[0];
        if (!file) return;
        if (this._importReader || this._pendingImport || this._importRestoring) {
            input.value = '';
            app.showToast('请先完成当前的恢复操作');
            return;
        }
        this._importInput = input;
        this._importSummary = '';
        document.getElementById('import-file-name').textContent = file.name;
        this._showImportState('reading', '正在读取并检查备份文件，可以取消。');
        app._openModal('modal-import');
        const finishRead = () => {
            this._importReader = null;
            this._importInput = null;
            input.value = '';
        };
        try {
            const reader = this._importReader = new FileReader();
            reader.onload = ev => {
                if (this._importReader !== reader) return;
                finishRead();
                try {
                    const backup = JSON.parse(ev.target.result);
                    const data = this.validateBackup(backup);
                    const images = new Set([...data.parts, ...data.prices].map(row => row.image).filter(Boolean)).size;
                    this._importSummary = `${data.parts.length} 种配件 · ${data.parts.reduce((sum, part) => sum + part.qty, 0)} 件库存\n` +
                        `${data.records.length} 条记录 · ${data.prices.length} 份价格表 · ${images} 张图片`;
                    this._pendingImport = backup;
                    this._showImportState('confirm', '恢复将覆盖当前配件、库存、记录和价格表。确认备份内容正确后再继续。');
                } catch (error) { this._showImportError(error); }
            };
            reader.onerror = reader.onabort = () => {
                if (this._importReader !== reader) return;
                finishRead();
                this._showImportError(new Error('备份文件读取失败或已中断，请重新选择文件。'));
            };
            reader.readAsText(file);
        } catch (error) {
            finishRead();
            this._showImportError(new Error('备份文件无法读取，请重新选择本机可访问的 JSON 文件。'));
        }
    }
};
