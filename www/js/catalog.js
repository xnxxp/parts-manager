// catalog.js - Built-in iPhone (7 ~ 17) parts template catalog
// Drives the "从模板添加" quick-add picker: pick series -> model -> part type ->
// quality, then auto-fill the add-part form (name / category / model).

// Series -> models (iPhone 7 through 17, mainstream variants)
const CATALOG_SERIES = [
    { series: '7',       models: ['iPhone 7', 'iPhone 7 Plus'] },
    { series: '8',       models: ['iPhone 8', 'iPhone 8 Plus'] },
    { series: 'X',       models: ['iPhone X'] },
    { series: 'XR/XS',   models: ['iPhone XR', 'iPhone XS', 'iPhone XS Max'] },
    { series: '11',      models: ['iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max'] },
    { series: 'SE',      models: ['iPhone SE (2代)', 'iPhone SE (3代)'] },
    { series: '12',      models: ['iPhone 12 mini', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max'] },
    { series: '13',      models: ['iPhone 13 mini', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max'] },
    { series: '14',      models: ['iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max'] },
    { series: '15',      models: ['iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max'] },
    { series: '16',      models: ['iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max'] },
    { series: '17',      models: ['iPhone 17', 'iPhone 17 Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max'] }
];

// Part types mapped to the app's existing category set
// (屏幕 / 电池 / 排线 / 摄像头 / 壳后盖 / 按键 / 充电口 / 扬声器 / 其他)
const CATALOG_PART_TYPES = [
    { type: '屏幕总成',         category: '屏幕' },
    { type: '外屏玻璃',         category: '屏幕' },
    { type: '电池',             category: '电池' },
    { type: '后盖玻璃',         category: '壳/后盖' },
    { type: '中框',             category: '壳/后盖' },
    { type: '后置摄像头',       category: '摄像头' },
    { type: '前置摄像头',       category: '摄像头' },
    { type: '摄像头镜头玻璃',   category: '摄像头' },
    { type: '尾插/充电口',      category: '充电口' },
    { type: '听筒',             category: '扬声器' },
    { type: '扬声器',           category: '扬声器' },
    { type: '振动马达',         category: '排线' },
    { type: '按键排线',         category: '按键' },
    { type: '面容/Face ID组件', category: '排线' },
    { type: '卡托',             category: '其他' },
    { type: '主板',             category: '其他' }
];

const CATALOG_QUALITIES = ['原装', '国产', '品牌'];

const catalogManager = {
    _series: '', _model: '', _type: '', _cat: '', _quality: '',

    open() {
        this._series = ''; this._model = ''; this._type = ''; this._cat = ''; this._quality = '';
        this._renderSeries();
        this._renderModels();
        this._renderTypes();
        this._renderQuality();
        this._updatePreview();
        app._openModal('modal-catalog');
    },

    close() {
        app._closeModal('modal-catalog');
    },

    _chip(label, active, onclick) {
        return '<button class="cat-chip ' + (active ? 'active' : '') + '" onclick="' + onclick + '">' + label + '</button>';
    },

    _renderSeries() {
        const html = CATALOG_SERIES.map(s =>
            this._chip(s.series, this._series === s.series, "catalogManager.selectSeries('" + s.series + "')")
        ).join('');
        document.getElementById('catalog-series').innerHTML = html;
    },

    _renderModels() {
        const el = document.getElementById('catalog-models');
        if (!this._series) { el.innerHTML = '<span class="catalog-hint">先选系列</span>'; return; }
        const found = CATALOG_SERIES.find(x => x.series === this._series) || { models: [] };
        el.innerHTML = found.models.map(m =>
            this._chip(m, this._model === m, "catalogManager.selectModel('" + m.replace(/'/g, "\\'") + "')")
        ).join('');
    },

    _renderTypes() {
        const html = CATALOG_PART_TYPES.map(t =>
            this._chip(t.type, this._type === t.type, "catalogManager.selectType('" + t.type.replace(/'/g, "\\'") + "')")
        ).join('');
        document.getElementById('catalog-types').innerHTML = html;
    },

    _renderQuality() {
        const html = CATALOG_QUALITIES.map(q =>
            this._chip(q, this._quality === q, "catalogManager.selectQuality('" + q + "')")
        ).join('');
        document.getElementById('catalog-quality').innerHTML = html;
    },

    selectSeries(s) {
        if (s !== this._series) this._model = ''; // reset model when series changes
        this._series = s;
        this._renderSeries();
        this._renderModels();
        this._updatePreview();
    },

    selectModel(m) {
        this._model = m;
        this._renderModels();
        this._updatePreview();
    },

    selectType(t) {
        this._type = t;
        this._cat = (CATALOG_PART_TYPES.find(x => x.type === t) || {}).category || '其他';
        this._renderTypes();
        this._updatePreview();
    },

    selectQuality(q) {
        this._quality = q;
        this._renderQuality();
        this._updatePreview();
    },

    _updatePreview() {
        const el = document.getElementById('catalog-preview');
        const btn = document.getElementById('catalog-apply-btn');
        if (this._model && this._type && this._quality) {
            const name = this._model + ' ' + this._type + '(' + this._quality + ')';
            el.textContent = '将生成：' + name + '   ·   分类：' + this._cat;
            el.style.color = '#626f55';
            btn.disabled = false;
        } else {
            el.textContent = '请依次选择 系列 → 机型 → 配件类型 → 品质';
            el.style.color = '#8c9181';
            btn.disabled = true;
        }
    },

    apply() {
        if (!this._model || !this._type || !this._quality) return;
        const name = this._model + ' ' + this._type + '(' + this._quality + ')';
        partsManager.applyTemplate(name, this._cat, this._model);
        this.close();
    }
};
