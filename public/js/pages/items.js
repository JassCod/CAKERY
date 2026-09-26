import { state, api, can, qs } from '../state.js';
import { esc, icon, money, num, fmtDateTime, toast, formModal, confirmDialog, empty, openModal, downloadCSV, debounce } from '../ui.js';

const TYPES = { product: 'Products (for sale)', ingredient: 'Ingredients / raw', packaging: 'Packaging', other: 'Other' };
const TYPE_BADGE = { product: 'rose', ingredient: 'amber', packaging: 'blue', other: '' };
const REASONS_IN = [['purchase', 'Purchase / received'], ['return', 'Returned'], ['production', 'Produced in-house'], ['adjustment', 'Adjustment']];
const REASONS_OUT = [['usage', 'Used in kitchen'], ['wastage', 'Wastage / expired'], ['adjustment', 'Adjustment']];

export default async function items(el, { query }) {
  const f = { q: '', type: query.type || '', category: '', low: query.low === '1' ? '1' : '' };
  const manage = can('items.manage');
  const showCost = manage || can('dashboard.financials');

  async function load() { render(await api('/items' + qs(f))); }

  function render({ items: rows, summary }) {
    const cats = [...new Set([...(state.settings.item_categories || []), ...rows.map(r => r.category).filter(Boolean)])];
    el.innerHTML = `
    <div class="grid g4 mb">
      <div class="card stat"><div class="label">Active items</div><div class="value">${num(summary.total)}</div><div class="foot">every item of the shop on record</div><div class="ico tone-rose">${icon('box')}</div></div>
      <div class="card stat" style="cursor:pointer" data-lowcard><div class="label">Low / out of stock</div><div class="value ${summary.low ? 'neg' : ''}">${num(summary.low || 0)}</div><div class="foot">at or below reorder level</div><div class="ico tone-red">${icon('alert')}</div></div>
      ${summary.stock_value != null ? `<div class="card stat"><div class="label">Stock value (at cost)</div><div class="value">${money(summary.stock_value || 0, { dec: false })}</div><div class="foot">quantity × cost price</div><div class="ico tone-green">${icon('wallet')}</div></div>` : ''}
      <div class="card stat"><div class="label">Showing</div><div class="value">${num(rows.length)}</div><div class="foot">${f.type ? esc(TYPES[f.type]) : 'all types'}</div><div class="ico tone-blue">${icon('layers')}</div></div>
    </div>
    <div class="toolbar">
      <div class="tabs">${[['', 'All'], ...Object.entries(TYPES).map(([k, v]) => [k, v.split(' ')[0]])].map(([k, v]) => `<button data-type="${k}" class="${f.type === k ? 'active' : ''}">${esc(v)}</button>`).join('')}</div>
      <div class="search">${icon('search')}<input class="input" data-q placeholder="Search name or SKU…" value="${esc(f.q)}"></div>
      <select class="select" data-cat><option value="">All categories</option>${cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="check small"><input type="checkbox" data-low ${f.low ? 'checked' : ''}> Low stock only</label>
      <div class="spacer"></div>
      <button class="btn" data-csv>${icon('download')} CSV</button>
      ${manage ? `<button class="btn btn-primary" data-add>${icon('plus')} Add item</button>` : ''}
    </div>
    <div class="card">
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Item</th><th>Type</th><th>Category</th><th class="right">In stock</th>${showCost ? '<th class="right">Cost</th>' : ''}<th class="right">Selling price</th><th></th></tr></thead>
        <tbody>${rows.map(i => {
          const low = i.reorder_level > 0 && i.stock_qty <= i.reorder_level;
          return `<tr>
          <td><div class="strong">${esc(i.name)}</div><div class="small muted">${i.sku ? 'SKU ' + esc(i.sku) : ''}${i.notes ? (i.sku ? ' · ' : '') + esc(i.notes) : ''}</div></td>
          <td><span class="badge ${TYPE_BADGE[i.type]}">${esc(i.type)}</span></td>
          <td class="small">${esc(i.category || '—')}${i.kitchen ? `<div class="muted">${esc(i.kitchen)}</div>` : ''}</td>
          <td class="right num nowrap"><b class="${low ? 'neg' : ''}">${num(i.stock_qty)}</b> <span class="muted small">${esc(i.unit)}</span>${low ? '<div><span class="badge red">Low</span></div>' : i.reorder_level ? `<div class="small muted">min ${num(i.reorder_level)}</div>` : ''}</td>
          ${showCost ? `<td class="right num small">${money(i.cost_price)}</td>` : ''}
          <td class="right num">${i.sell_price ? money(i.sell_price) : '<span class="muted">—</span>'}</td>
          <td><div class="actions">
            ${can('stock.adjust', 'items.manage') ? `<button class="btn btn-sm" data-stock="${i.id}">${icon('refresh')} Stock</button>` : ''}
            <button class="btn btn-sm btn-ghost btn-icon" data-hist="${i.id}" title="Stock history">${icon('history')}</button>
            ${manage ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${i.id}" title="Edit">${icon('edit')}</button><button class="btn btn-sm btn-ghost btn-icon" data-del="${i.id}" title="Delete">${icon('trash')}</button>` : ''}
          </div></td></tr>`;
        }).join('')}</tbody></table></div>`
      : empty('No items found', manage ? 'Add your cakes, pastries, ingredients and packaging so everything is on record.' : '', 'box', manage ? `<button class="btn btn-primary" data-add2>${icon('plus')} Add first item</button>` : '')}
    </div>`;

    el.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { f.type = b.dataset.type; load(); });
    el.querySelector('[data-q]').oninput = debounce(e => { f.q = e.target.value; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
    el.querySelector('[data-cat]').onchange = e => { f.category = e.target.value; load(); };
    el.querySelector('[data-low]').onchange = e => { f.low = e.target.checked ? '1' : ''; load(); };
    el.querySelector('[data-lowcard]').onclick = () => { f.low = '1'; load(); };
    for (const s of ['[data-add]', '[data-add2]']) { const b = el.querySelector(s); if (b) b.onclick = () => edit(null, cats); }
    const byId = id => rows.find(r => r.id === Number(id));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(byId(b.dataset.edit), cats));
    el.querySelectorAll('[data-stock]').forEach(b => b.onclick = () => stock(byId(b.dataset.stock)));
    el.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showHistory(byId(b.dataset.hist)));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const i = byId(b.dataset.del);
      if (!(await confirmDialog(`Delete "${i.name}"? If it has production history it will be archived instead.`))) return;
      try { const r = await api(`/items/${i.id}`, { method: 'DELETE' }); toast(r.archived ? 'Item archived (has history)' : 'Item deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelector('[data-csv]').onclick = () => downloadCSV('items.csv', [
      ['Name', 'SKU', 'Type', 'Category', 'Unit', 'Stock', 'Reorder level', ...(showCost ? ['Cost price'] : []), 'Selling price'],
      ...rows.map(i => [i.name, i.sku || '', i.type, i.category || '', i.unit, i.stock_qty, i.reorder_level, ...(showCost ? [i.cost_price] : []), i.sell_price]),
    ]);
  }

  async function edit(i, cats) {
    const r = await formModal({
      title: i ? `Edit ${i.name}` : 'Add item',
      fields: [
        { name: 'name', label: 'Item name', value: i?.name, required: true, full: true, placeholder: 'e.g. Black Forest Pastry' },
        { name: 'type', label: 'Type', type: 'select', options: Object.entries(TYPES), value: i?.type || f.type || 'product' },
        { name: 'category', label: 'Category', type: 'datalist', options: cats, value: i?.category || '' },
        ...((state.settings.kitchens || []).length ? [{ name: 'kitchen', label: 'Made in kitchen', type: 'select', placeholder: '— none / bought in —', options: state.settings.kitchens, value: i?.kitchen || '' }] : []),
        { name: 'unit', label: 'Unit', type: 'datalist', options: ['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'packet', 'dozen', 'tray'], value: i?.unit || 'pcs' },
        { name: 'sku', label: 'SKU / code', value: i?.sku || '' },
        { name: 'cost_price', label: 'Cost price (per unit)', type: 'money', value: i?.cost_price ?? '' },
        { name: 'sell_price', label: 'Selling price (per unit)', type: 'money', value: i?.sell_price ?? '' },
        ...(i ? [] : [{ name: 'stock_qty', label: 'Opening stock', type: 'number', min: 0, value: '' }]),
        { name: 'reorder_level', label: 'Reorder level', type: 'number', min: 0, value: i?.reorder_level ?? '', hint: 'Alert when stock falls to this' },
        { name: 'notes', label: 'Notes', type: 'textarea', value: i?.notes || '', full: true },
        ...(i ? [{ name: 'active', label: 'Active', type: 'checkbox', value: !!i.active, full: true }] : []),
      ],
      onSubmit: v => api(i ? `/items/${i.id}` : '/items', { method: i ? 'PUT' : 'POST', body: v }),
    });
    if (r) { toast(i ? 'Item updated' : 'Item added'); load(); }
  }

  async function stock(i) {
    const r = await formModal({
      title: `Stock · ${i.name}`, size: 'narrow',
      intro: `<div class="money" style="margin-bottom:14px"><small>Current stock</small><b>${num(i.stock_qty)} ${esc(i.unit)}</b></div>`,
      fields: [
        { name: 'direction', label: 'Action', type: 'select', options: [['in', 'Stock in (+)'], ['out', 'Stock out (−)'], ['set', 'Set exact count (stock-take)']], value: 'in', full: true },
        { name: 'qty', label: `Quantity (${i.unit})`, type: 'number', min: 0, required: true, full: true },
        { name: 'reason', label: 'Reason', type: 'select', options: REASONS_IN, full: true },
        { name: 'note', label: 'Note', full: true, placeholder: 'optional' },
      ],
      onMount: (_m, form) => {
        const dir = form.elements.direction, reason = form.elements.reason;
        dir.onchange = () => {
          const opts = dir.value === 'out' ? REASONS_OUT : dir.value === 'set' ? [['adjustment', 'Stock-take adjustment']] : REASONS_IN;
          reason.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        };
      },
      onSubmit: v => api(`/items/${i.id}/stock`, { method: 'POST', body: v }),
    });
    if (r) { toast(`Stock updated → ${num(r.balance)} ${i.unit}`); load(); }
  }

  async function showHistory(i) {
    const { movements } = await api(`/items/${i.id}/movements`);
    openModal({
      title: `Stock history · ${i.name}`, size: 'wide',
      body: movements.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Reason</th><th class="right">Change</th><th class="right">Balance</th><th>By</th><th>Note</th></tr></thead>
        <tbody>${movements.map(m => `<tr><td class="small nowrap">${esc(fmtDateTime(m.created_at))}</td><td><span class="badge">${esc(m.reason)}</span></td>
        <td class="right num ${m.change < 0 ? 'neg' : 'pos'}">${m.change > 0 ? '+' : ''}${num(m.change)}</td><td class="right num">${num(m.balance)}</td>
        <td class="small">${esc(m.user_name || '—')}</td><td class="small muted">${esc(m.note || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No stock movements yet', '', 'history'),
    });
  }

  await load();
}
