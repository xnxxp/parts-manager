// price.js
const priceManager = {
    editingId: null,

    async load() {
        const rows = await DB.all('prices');
        rows.sort((a, b) => b.created_at - a.created_at);
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
            const subtitle = r.note ? '<div style="font-size:12px;color:#888;margin-top:2px;">' + r.note + '</div>' : '';
            const thumb = r.image ? `<div class="price-thumb" onclick="event.stopPropagation();app.showImageViewer('${r.image.replace(/'/g, "\\'")}')"><img src="${r.image}" alt=""></div>` : '';
            return `<div class="price-item" onclick="if(!event.target.closest('.btn-delete'))app.showImageViewer('${r.image.replace(/'/g, "\\'")}')">
                <div class="price-header">
                    <div style="flex:1;min-width:0;">
                        <div class="price-name">&#128200; ${r.title || '未命名'}</div>
                        <div class="price-date">${new Date(r.created_at * 1000).toLocaleString()}</div>
                        ${subtitle}
                    </div>
                    <button class="btn-delete" onclick="event.stopPropagation();priceManager.deleteItem(${r.id})">删除</button>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                    ${imgLabel}
                </div>
                ${thumb}
            </div>`;
        }).join('');
    },

    openAddModal() {
        this.editingId = null;
        document.getElementById('price-title').value = '';
        document.getElementById('price-note').value = '';
        document.getElementById('price-image-preview').style.display = 'none';
        document.getElementById('price-image-placeholder').style.display = 'flex';
        app.currentImageData = null;
        app.currentExcelData = null;
        document.getElementById('modal-price').style.display = 'flex';
    },

    handleImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            app.currentImageData = ev.target.result;
            const img = document.getElementById('price-image-preview');
            img.src = ev.target.result; img.style.display = 'block';
            document.getElementById('price-image-placeholder').style.display = 'none';
        };
        reader.readAsDataURL(file);
    },

    save(e) {
        e.preventDefault();
        const title = document.getElementById('price-title').value.trim();
        const note = document.getElementById('price-note').value.trim();
        if (!title) { app.showToast('请输入标题'); return; }
        const data = { title, note, image: app.currentImageData || '' };
        DB.run('prices', data).then(() => {
            app.showToast('已上传'); this.closeModal(); this.load();
        });
    },

    viewImage(id) {
        DB.get('prices', id).then(row => {
            if (row && row.image) app.showImageViewer(row.image);
        });
    },

    deleteItem(id) {
        if (!confirm('确定删除此价格表？')) return;
        DB.deleteItem('prices', id).then(() => { app.showToast('已删除'); this.load(); });
    },

    closeModal() {
        document.getElementById('modal-price').style.display = 'none';
    }
};
