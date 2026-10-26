const restockManager = {
    _loadRevision: 0,
    _partId: null,
    _mode: 'plan',

    async load() {
        const revision = ++this._loadRevision;
        const rows = Stock.replenishment(await DB.all('parts'), await DB.all('inventory'), await DB.all('warehouses'));
        if (revision !== this._loadRevision) return;
        const planned = rows.filter(row => row.plannedQty > 0);
        const needs = rows.filter(row => row.status !== 'available').length;
        document.getElementById('restock-summary').textContent =
            `${needs} 种需要补货 · 已计划 ${planned.length} 种 / ${planned.reduce((sum, row) => sum + row.plannedQty, 0)} 件`;
        const list = document.getElementById('restock-list');
        if (!rows.length) {
            list.innerHTML = '<div class="card restock-empty">当前没有需要补货的配件，也没有待完成的计划。</div>';
            return;
        }
        list.innerHTML = rows.map(part => {
            const plan = part.restock_plan;
            return `<article class="restock-card">
                <div class="restock-card-heading"><h3>${escapeHtml(part.name)}</h3>
                    <span class="stock-status ${part.status}">${part.status === 'empty' ? '已用完' : part.status === 'low' ? '快用完' : '库存充足'}</span></div>
                <p class="restock-meta">${escapeHtml(part.category)}${part.brand ? ' · ' + escapeHtml(part.brand) : ''} · 合计剩余 ${part.qty} 件</p>
                <div class="part-location-list">${part.locations.map(row =>
                    `<span class="location-quantity">${escapeHtml(row.location)} ${row.qty} 件</span>`).join('')}</div>
                <p class="restock-plan">${part.plannedQty > 0 ?
                    `准备买 <strong>${part.plannedQty}</strong> 件 · 存到 ${escapeHtml(plan.location)}` :
                    `建议补充 ${part.suggestedQty} 件，让总数量高于预警值`}</p>
                <div class="restock-actions">
                    <button type="button" class="btn-secondary" onclick="partsManager.viewDetail(${part.id})">查看记录</button>
                    <button type="button" class="btn-secondary" onclick="restockManager.open(${part.id}, 'plan')">${part.plannedQty > 0 ? '修改计划' : '计划补货'}</button>
                    ${part.plannedQty > 0 ? `<button type="button" class="btn-primary" onclick="restockManager.open(${part.id}, 'receive')">已买到，入库</button>` : ''}
                </div>
            </article>`;
        }).join('');
    },

    async open(partId, mode) {
        if (partsManager._stockBusy) { app.showToast('正在处理，请稍候'); return; }
        const part = await DB.get('parts', partId);
        if (!part) { app.showToast('配件已不存在'); return; }
        if (mode === 'receive' && !(part.restock_plan?.qty > 0)) {
            app.showToast('计划已完成或取消'); await this.load(); return;
        }
        this._partId = partId;
        this._mode = mode;
        const rows = Stock.replenishment([part], await DB.all('inventory'), await DB.all('warehouses'));
        document.getElementById('restock-modal-title').textContent = mode === 'receive' ? '补货入库' : '补货计划';
        document.getElementById('restock-part-name').textContent = part.name;
        document.getElementById('restock-qty-label').textContent = mode === 'receive' ? '实际买到数量' : '准备买多少件';
        const input = document.getElementById('restock-qty');
        input.min = mode === 'receive' ? '1' : '0';
        input.value = part.restock_plan?.qty || rows[0]?.suggestedQty || 1;
        document.getElementById('restock-location').value = part.restock_plan?.location || part.location || '';
        document.getElementById('restock-modal-hint').textContent = mode === 'receive' ?
            '按实际买到的数量入库；分批到货会保留剩余计划。' : '保存计划不会改变库存。数量设为 0 可取消计划。';
        document.getElementById('restock-submit').textContent = mode === 'receive' ? '确认入库' : '保存计划';
        await partsManager.updateLocationSuggestions();
        app._openModal('modal-restock');
    },

    async submit(event) {
        event.preventDefault();
        if (partsManager._stockBusy) return;
        partsManager._stockBusy = true;
        const button = document.getElementById('restock-submit');
        button.disabled = true;
        try {
            const partId = this._partId;
            const mode = this._mode;
            const qty = document.getElementById('restock-qty').value;
            const location = document.getElementById('restock-location').value;
            if (mode === 'receive') {
                const part = await Stock.receiveRestock(partId, qty, location);
                app.showToast(`已入库 ${Number(qty)} 件${part.restock_plan ? '，还有 ' + part.restock_plan.qty + ' 件待补' : '，计划已完成'}`);
            } else {
                await Stock.planRestock(partId, qty, location);
                app.showToast(Number(qty) === 0 ? '补货计划已取消' : '补货计划已保存');
            }
            app._closeModal('modal-restock');
            await this.load();
            app.refreshDashboard();
        } catch (error) {
            app.showToast(error.message || '保存失败，请重试');
        } finally {
            button.disabled = false;
            partsManager._stockBusy = false;
        }
    }
};
