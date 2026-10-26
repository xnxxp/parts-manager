// price.js
const priceManager = {
    editingId: null,
    currentSheetIndex: 0,
    currentWorkbookData: null,  // parsed workbook data

    async load() {
        const rows = await DB.all('prices');
        rows.sort((a, b) => b.created_at - a.created_at);
        // Resolve image references (IndexedDB id) into data URLs for rendering.
        // Legacy inline base64 is returned as-is by DB.resolveImage.
        for (const r of rows) {
            if (r.image) {
                try { r.image = await DB.resolveImage(r.image) || ''; }
                catch (e) { r.image = ''; }
            }
        }
        this.render(rows);
    },

    render(rows) {
        const el = document.getElementById('price-list');
        if (!rows.length) {
            el.innerHTML = '<p class="empty-text">&#128200; 暂无价格表，点击右上角上传</p>';
            return;
        }
        el.innerHTML = rows.map(r => {
            const imgLabel = r.image ? '<span style="background:#eef0ff;color:#667eea;padding:3px 10px;border-radius:6px;font-size:12px;">&#128247; 图片</span>' : '';
            const excelLabel = r.excel_data ? '<span class="excel-badge">&#128200; Excel</span>' : '';
            const subtitle = r.note ? '<div style="font-size:12px;color:#888;margin-top:2px;">' + escapeHtml(r.note) + '</div>' : '';
            const thumb = r.image ? `<div class="price-thumb" onclick="event.stopPropagation();app.showImageViewer('${r.image.replace(/'/g, "\\'")}')"><img src="${r.image}" alt=""></div>` : '';

            // onclick: if has excel, open excel viewer; else open image viewer
            let clickAction;
            if (r.excel_data) {
                clickAction = `if(!event.target.closest('.btn-delete')&&!event.target.closest('.excel-delete'))priceManager.viewExcel(${r.id})`;
            } else if (r.image) {
                clickAction = `if(!event.target.closest('.btn-delete'))app.showImageViewer('${r.image.replace(/'/g, "\\'")}')`;
            } else {
                clickAction = '';
            }

            return `<div class="price-item" onclick="${clickAction}">
                <div class="price-header">
                    <div style="flex:1;min-width:0;">
                        <div class="price-name">&#128200; ${escapeHtml(r.title || '未命名')}</div>
                        <div class="price-date">${new Date(r.created_at * 1000).toLocaleString()}</div>
                        ${subtitle}
                    </div>
                    <button class="btn-delete" onclick="event.stopPropagation();priceManager.deleteItem(${r.id})">删除</button>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;">
                    ${imgLabel}${excelLabel}
                </div>
                ${thumb ? '<div style="margin-top:12px;">' + thumb + '</div>' : ''}
            </div>`;
        }).join('');
    },

    openAddModal() {
        this.editingId = null;
        document.getElementById('price-title').value = '';
        document.getElementById('price-note').value = '';
        document.getElementById('price-image-preview').style.display = 'none';
        document.getElementById('price-image-placeholder').style.display = 'flex';
        document.getElementById('price-excel-name').textContent = '点击选择 .xlsx 文件';
        document.getElementById('price-excel-file').value = '';
        const excelArea = document.querySelector('.excel-upload-area');
        if (excelArea) excelArea.classList.remove('has-file');
        app.currentImageData = null;
        app.currentImageId = null;
        app.currentExcelData = null;
        app._openModal('modal-price');
    },

    handleImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                // Compress (mirrors part photos) then store in IndexedDB so the
                // raw base64 doesn't bloat localStorage's 5MB quota.
                const compressed = await app.compressImage(ev.target.result, 1280, 0.72);
                let id = null;
                try {
                    id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    const saved = await DB.saveImage(id, compressed);
                    if (!saved) id = null; // IDB write failed -> fall back to inline base64
                } catch (e) { id = null; } // IDB unavailable -> fall back to inline
                app.currentImageId = id;
                app.currentImageData = compressed;
                const img = document.getElementById('price-image-preview');
                img.src = compressed; img.style.display = 'block';
                document.getElementById('price-image-placeholder').style.display = 'none';
            } catch (e) {
                // Compression failed: keep the original data URL as inline fallback
                app.currentImageId = null;
                app.currentImageData = ev.target.result;
                const img = document.getElementById('price-image-preview');
                img.src = ev.target.result; img.style.display = 'block';
                document.getElementById('price-image-placeholder').style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    },

    handleExcel(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            app.currentExcelData = ev.target.result;  // base64
            const nameEl = document.getElementById('price-excel-name');
            nameEl.textContent = file.name;
            nameEl.style.color = '#34c759';
            nameEl.style.fontWeight = '600';
            const area = document.querySelector('.excel-upload-area');
            if (area) area.classList.add('has-file');
        };
        reader.readAsDataURL(file);
    },

    save(e) {
        e.preventDefault();
        if (partsManager._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        const title = document.getElementById('price-title').value.trim();
        const note = document.getElementById('price-note').value.trim();
        if (!title) { app.showToast('请输入标题'); return; }
        const data = {
            title,
            note,
            // Prefer IndexedDB id reference; fall back to inline base64 if IDB unavailable
            image: app.currentImageId || app.currentImageData || '',
            excel_data: app.currentExcelData || ''
        };
        if (this.editingId) {
            data.id = this.editingId;
        }
        DB.run('prices', data).then(r => {
            if (r && r.error) { app.showToast('保存失败：存储空间不足，请导出备份后清理'); return; }
            app.showToast('已上传');
            this.closeModal();
            this.load();
        });
    },

    viewExcel(id) {
        DB.get('prices', id).then(row => {
            if (!row || !row.excel_data) { app.showToast('暂无 Excel 数据'); return; }

            // Parse the xlsx file
            try {
                const base64 = row.excel_data.split(',')[1]; // strip data:application/...;base64,
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const workbook = XLSX.read(bytes, { type: 'array' });

                this.currentWorkbookData = workbook;
                this.currentSheetIndex = 0;

                document.getElementById('excel-viewer-title').textContent = row.title || '价格表';
                this.renderExcelSheet();
                document.getElementById('modal-excel-viewer').style.display = 'flex';
                app._openModal('modal-excel-viewer');
            } catch (err) {
                console.error('Excel parse error:', err);
                app.showToast('Excel 文件解析失败');
            }
        });
    },

    renderExcelSheet() {
        const wb = this.currentWorkbookData;
        if (!wb) return;
        const sheetNames = wb.SheetNames;
        const idx = Math.min(this.currentSheetIndex, sheetNames.length - 1);
        const sheetName = sheetNames[idx];
        const sheet = wb.Sheets[sheetName];

        // Convert to HTML, then sanitize before injecting: XLSX.utils.sheet_to_html
        // does not escape HTML/script in cell text, so a crafted workbook could
        // inject <script> or on* handlers. Strip those before innerHTML.
        const html = this._sanitizeHtml(XLSX.utils.sheet_to_html(sheet, { editable: false }));

        // Build sheet tabs
        const tabsHtml = sheetNames.map((name, i) =>
            `<button class="excel-sheet-tab ${i === idx ? 'active' : ''}" onclick="priceManager.switchSheet(${i})">${escapeHtml(name)}</button>`
        ).join('');

        document.getElementById('excel-viewer-body').innerHTML =
            `<div class="excel-sheet-tabs">${tabsHtml}</div>` +
            `<div class="excel-table-wrap">${html}</div>`;
    },

    // Strip active content from an HTML string produced by XLSX so it is safe
    // to inject via innerHTML. Removes script/style/iframe/object/embed and
    // strips on* event-handler attributes plus javascript: URLs.
    _sanitizeHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove());
        tmp.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                const n = attr.name.toLowerCase();
                const v = (attr.value || '').trim().toLowerCase();
                if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href') && v.indexOf('javascript:') === 0)) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return tmp.innerHTML;
    },

    switchSheet(index) {
        this.currentSheetIndex = index;
        this.renderExcelSheet();
    },

    closeExcelViewer() {
        app._closeModal('modal-excel-viewer');
        this.currentWorkbookData = null;
        this.currentSheetIndex = 0;
    },

    async viewImage(id) {
        const row = await DB.get('prices', id);
        if (row && row.image) {
            const src = await DB.resolveImage(row.image);
            if (src) app.showImageViewer(src);
        }
    },

    async deleteItem(id) {
        if (partsManager._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        if (!confirm('确定删除此价格表？')) return;
        partsManager._stockBusy = true;
        try {
            const prices = await DB.all('prices');
            const row = prices.find(item => item.id === id);
            if (!row) throw new Error('价格表已不存在');
            if (!DB.commitStores({ prices: prices.filter(item => item.id !== id) })) throw new Error('删除失败，原有数据已保留');
            if (row && row.image && row.image.indexOf('data:image') !== 0) {
                await DB.deleteUnusedImage(row.image);
            }
            app.showToast('已删除');
            await this.load();
        } catch (e) { app.showToast(e.message || '删除失败'); }
        finally { partsManager._stockBusy = false; }
    },

    closeModal() {
        app._closeModal('modal-price');
    }
};
