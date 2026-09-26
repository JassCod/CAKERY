import { state, api, can, qs } from '../state.js';
import { esc, icon, num, money, fmtDate, todayStr, addDays, relDay, toast, formModal, confirmDialog, empty, openModal, avatar, pct } from '../ui.js';

export default async function production(el, { query }) {
  let date = query.date || todayStr();
  let mine = false;
  const kitchens = state.settings.kitchens || [];
  let kitchen = query.kitchen ?? (kitchens.includes(state.user.kitchen) ? state.user.kitchen : '');
  let items = [];
  async function loadItems() {
    items = (await api('/items')).items.filter(i => i.active !== false);
  }
  // Names offered for a kitchen: its own items first, then products not tied to any kitchen.
  const namesFor = k => {
    const own = items.filter(i => k && i.kitchen === k);
    const loose = items.filter(i => !i.kitchen && i.type === 'product');
    const list = k ? [...own, ...loose] : items.filter(i => i.type === 'product');
    return [...new Map(list.map(i => [i.name.toLowerCase(), i])).values()];
  };
  await loadItems();
  const canLog = can('production.log', 'production.manage');
  const canSales = can('production.sales', 'production.log', 'production.manage');
  const isManager = can('production.manage');
  const recentLimit = addDays(todayStr(), -1);

  let carryNote = '';
  const carriedDates = new Set();
  async function load() {
    // Unsold items from the last production day are brought into today automatically.
    if (!carriedDates.has(date) && date >= addDays(todayStr(), -1) && can('production.log', 'production.sales', 'production.manage')) {
      carriedDates.add(date);
      try {
        const c = await api('/production/carry', { method: 'POST', body: { date } });
        carryNote = c.carried ? `${icon('refresh')} Brought forward ${c.carried} unsold item${c.carried > 1 ? 's' : ''} from ${relDay(c.from)} — shown as “left over”.` : '';
        if (c.pending_counts) carryNote += ` ${icon('alert')} ${c.pending_counts} entr${c.pending_counts > 1 ? 'ies' : 'y'} from ${relDay(c.from)} still need sold counts before leftovers can carry over.`;
      } catch { /* not critical */ }
    }
    const data = await api('/production' + qs({ date, mine: mine ? 1 : '', kitchen }));
    render(data);
  }

  function ownEditable(l) { return isManager || (l.made_by === state.user.id && l.date >= recentLimit); }
  function salesEditable(l) { return isManager || (l.date >= recentLimit && (can('production.sales') || l.made_by === state.user.id)); }

  function render({ logs, summary }) {
    const totals = summary.reduce((t, r) => ({ made: t.made + Number(r.made), carried: t.carried + Number(r.carried || 0), sold: t.sold + Number(r.sold), wasted: t.wasted + Number(r.wasted), pending: t.pending + Number(r.pending_counts) }), { made: 0, carried: 0, sold: 0, wasted: 0, pending: 0 });
    const avail = totals.made + totals.carried;
    const value = summary.reduce((t, r) => t + (r.sell_price || 0) * r.sold, 0);
    const isRecent = date >= recentLimit && date <= todayStr();
    el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-icon" data-prev aria-label="Previous day">${icon('chevLeft')}</button>
      <input type="date" class="input" data-date value="${date}" max="${todayStr()}" style="min-width:0;width:170px">
      <button class="btn btn-icon" data-next aria-label="Next day" ${date >= todayStr() ? 'disabled' : ''}>${icon('chevRight')}</button>
      <b style="margin-left:4px">${esc(relDay(date))}</b>
      <div class="spacer"></div>
      <label class="check small"><input type="checkbox" data-mine ${mine ? 'checked' : ''}> Only my entries</label>
      ${canSales && logs.length && (isRecent || isManager) ? `<button class="btn" data-eod>${icon('clipboard')} End-of-day counts${totals.pending ? ` <span class="badge amber">${totals.pending}</span>` : ''}</button>` : ''}
    </div>

    ${carryNote && date >= addDays(todayStr(), -1) ? `<div class="card card-pad mb" style="background:var(--info-50);border-color:transparent;color:var(--info);font-weight:600">${carryNote}</div>` : ''}
    ${kitchens.length ? `<div class="toolbar"><div class="tabs">${['', ...kitchens].map(k => `<button data-kitchen="${esc(k)}" class="${k === kitchen ? 'active' : ''}">${k ? (/cake/i.test(k) ? '🎂 ' : /snack/i.test(k) ? '🥐 ' : '🍳 ') + esc(k) : 'All kitchens'}</button>`).join('')}</div></div>` : ''}

    ${canLog && (isRecent || isManager) ? `
    <div class="card mb">
      <div class="card-head"><h3>${icon('chef')} Log what was made${kitchen ? ' in ' + esc(kitchen) : ''}${date !== todayStr() ? ' · ' + esc(relDay(date)) : ''}</h3></div>
      <form class="card-body quick-form" data-quick autocomplete="off">
        <div class="field"><label>Item name</label>
          <input class="input" name="item_name" list="prod-names" required placeholder="${kitchen && /snack/i.test(kitchen) ? 'e.g. Veg Puff' : 'e.g. Rasmalai Cake 1kg'}">
          <datalist id="prod-names">${namesFor(kitchen).map(i => `<option value="${esc(i.name)}">`).join('')}</datalist></div>
        ${kitchens.length ? `<div class="field"><label>Kitchen</label><select class="select" name="kitchen">
          ${kitchens.map(k => `<option ${k === (kitchen || state.user.kitchen || kitchens[0]) ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>`
          : '<div class="field"><label>Sold <span class="muted">(optional)</span></label><input class="input num" type="number" name="qty_sold" min="0" step="any" placeholder="later"></div>'}
        <div class="field"><label>Qty made</label><input class="input num" type="number" name="qty_made" min="0" step="any" required></div>
        <div class="field"><label>Notes</label><input class="input" name="notes" placeholder="e.g. eggless batch"></div>
        <button class="btn btn-primary" type="submit" style="height:40px">${icon('plus')} Add</button>
      </form>
      ${namesFor(kitchen).length ? `<div class="card-foot" style="flex-wrap:wrap;gap:6px"><span class="small muted">Tap to pick:</span>
        ${namesFor(kitchen).slice(0, 24).map(i => `<button type="button" class="chip" data-pick="${esc(i.name)}" data-pk="${esc(i.kitchen || '')}" style="border:0;cursor:pointer">${esc(i.name)}</button>`).join('')}</div>`
        : '<div class="card-foot small muted">Type the name of what you made — new names are saved automatically for next time.</div>'}
    </div>` : ''}

    <div class="grid g4 mb">
      <div class="card stat"><div class="label">Made today</div><div class="value">${num(totals.made)}</div><div class="foot">${totals.carried ? `+ ${num(totals.carried)} left from before` : `${summary.length} products`}</div></div>
      <div class="card stat"><div class="label">Sold</div><div class="value pos">${num(totals.sold)}</div><div class="foot">${pct(totals.sold, avail)}% of ${num(avail)} available</div></div>
      <div class="card stat"><div class="label">Wasted</div><div class="value neg">${num(totals.wasted)}</div><div class="foot">${pct(totals.wasted, avail)}% of available</div></div>
      <div class="card stat"><div class="label">${can('dashboard.financials') ? 'Est. value sold' : 'Counts pending'}</div>
        <div class="value">${can('dashboard.financials') ? money(value, { dec: false }) : num(totals.pending)}</div>
        <div class="foot">${can('dashboard.financials') ? 'at selling price' : 'entries without sold count'}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Entries</h3><div class="spacer"></div><span class="muted small">${esc(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
      ${logs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Item</th><th>By</th><th class="right">Made / from before</th><th class="right">Sold</th><th class="right">Wasted</th><th class="right">Left</th><th>Notes</th><th></th></tr></thead>
        <tbody>${logs.map(l => {
          const left = Number(l.carried_in || 0) + Number(l.qty_made) - Number(l.qty_sold || 0) - Number(l.qty_wasted);
          return `<tr>
          <td class="strong">${esc(l.item_name)}${l.kitchen && !kitchen ? `<div class="small muted">${esc(l.kitchen)}</div>` : ''}</td>
          <td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(l.made_by_name || '?', 'sm')}<span class="small">${esc(l.made_by_name || '—')}</span></span></td>
          <td class="right num">${Number(l.qty_made) ? `${num(l.qty_made)} <span class="muted small">${esc(l.unit)}</span>` : ''}${Number(l.carried_in) ? `<div><span class="badge blue" title="${esc(l.notes || '')}">${icon('refresh')} ${num(l.carried_in)} left over</span></div>` : ''}</td>
          <td class="right num">${l.qty_sold == null ? '<span class="badge amber">pending</span>' : `<b class="pos">${num(l.qty_sold)}</b>`}</td>
          <td class="right num">${l.qty_wasted ? `<span class="neg">${num(l.qty_wasted)}</span>` : '0'}</td>
          <td class="right num">${l.qty_sold == null ? '—' : left > 0 ? `<b style="color:var(--info)" title="Carries to the next day">${num(left)} →</b>` : num(left)}</td>
          <td class="small muted" style="max-width:220px">${esc(l.notes || '')}</td>
          <td><div class="actions">
            ${salesEditable(l) ? `<button class="btn btn-sm" data-sales="${l.id}" title="Update sold / wasted">${icon('check')} Sold</button>` : ''}
            ${ownEditable(l) ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${l.id}" title="Edit">${icon('edit')}</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-del="${l.id}" title="Delete">${icon('trash')}</button>` : ''}
          </div></td></tr>`;
        }).join('')}</tbody></table></div>` : empty('No production logged', 'Entries logged by the kitchen for this day will appear here.', 'chef')}
    </div>

    ${summary.length > 1 ? `<div class="card mt"><div class="card-head"><h3>By product</h3></div><div class="table-wrap"><table class="table">
      <thead><tr><th>Product</th><th class="right">Made</th><th class="right">From before</th><th class="right">Sold</th><th class="right">Wasted</th><th style="width:30%">Sell-through</th></tr></thead>
      <tbody>${summary.map(s => { const av = Number(s.made) + Number(s.carried || 0); return `<tr><td class="strong">${esc(s.item_name)}</td><td class="right num">${num(s.made)}</td><td class="right num">${Number(s.carried) ? num(s.carried) : '—'}</td><td class="right num">${num(s.sold)}</td><td class="right num">${num(s.wasted)}</td>
        <td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${Math.min(100, pct(s.sold, av))}%"></i></div><span class="small muted">${pct(s.sold, av)}%</span></div></td></tr>`; }).join('')}
      </tbody></table></div></div>` : ''}`;

    el.querySelector('[data-date]').onchange = e => { date = e.target.value || todayStr(); load(); };
    el.querySelector('[data-prev]').onclick = () => { date = addDays(date, -1); load(); };
    el.querySelector('[data-next]').onclick = () => { if (date < todayStr()) { date = addDays(date, 1); load(); } };
    el.querySelector('[data-mine]').onchange = e => { mine = e.target.checked; load(); };

    el.querySelectorAll('[data-kitchen]').forEach(b => b.onclick = () => { kitchen = b.dataset.kitchen; load(); });
    const quick = el.querySelector('[data-quick]');
    if (quick) {
      quick.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        quick.elements.item_name.value = b.dataset.pick;
        if (quick.elements.kitchen && b.dataset.pk) quick.elements.kitchen.value = b.dataset.pk;
        quick.elements.qty_made.focus();
      });
      el.querySelectorAll('.card-foot [data-pick]').forEach(b => b.onclick = () => {
        quick.elements.item_name.value = b.dataset.pick;
        if (quick.elements.kitchen && b.dataset.pk) quick.elements.kitchen.value = b.dataset.pk;
        quick.elements.qty_made.focus();
      });
      quick.addEventListener('submit', async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(quick));
        if (!f.item_name.trim() || f.qty_made === '') { toast('Enter the item name and quantity made', 'error'); return; }
        try {
          await api('/production', { method: 'POST', body: { ...f, item_name: f.item_name.trim(), date } });
          toast(`Logged ${f.qty_made} × ${f.item_name.trim()}`);
          await loadItems();
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    const byId = id => logs.find(l => l.id === Number(id));
    el.querySelectorAll('[data-sales]').forEach(b => b.onclick = () => salesModal(byId(b.dataset.sales)));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editModal(byId(b.dataset.edit)));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const l = byId(b.dataset.del);
      if (!(await confirmDialog(`Delete ${l.item_name} (${num(l.qty_made)} made)?`))) return;
      try { await api(`/production/${l.id}`, { method: 'DELETE' }); toast('Entry deleted'); load(); } catch (err) { toast(err.message, 'error'); }
    });
    const eod = el.querySelector('[data-eod]');
    if (eod) eod.onclick = () => eodModal(logs.filter(salesEditable));
  }

  async function salesModal(l) {
    const r = await formModal({
      title: `Sold count · ${l.item_name}`, size: 'narrow',
      intro: `<p class="muted" style="margin-top:0">Available <b>${num(Number(l.qty_made) + Number(l.carried_in || 0))} ${esc(l.unit)}</b> on ${esc(relDay(l.date))}${Number(l.carried_in) ? ` (${num(l.carried_in)} left over from before)` : ''}. Anything not sold or wasted carries to the next day.</p>`,
      fields: [
        { name: 'qty_sold', label: 'Quantity sold', type: 'number', min: 0, required: true, value: l.qty_sold ?? '' },
        { name: 'qty_wasted', label: 'Wasted / damaged', type: 'number', min: 0, value: l.qty_wasted || 0 },
      ],
      onSubmit: v => api(`/production/${l.id}/sales`, { method: 'PUT', body: v }),
    });
    if (r) { toast('Counts updated'); load(); }
  }

  async function editModal(l) {
    const r = await formModal({
      title: 'Edit production entry', size: 'narrow',
      fields: [
        { name: 'item_id', label: 'Item', type: 'select', options: items.map(i => [i.id, i.name]), value: l.item_id, required: true, full: true },
        ...(isManager ? [{ name: 'date', label: 'Date', type: 'date', value: l.date, required: true, full: true }] : []),
        { name: 'qty_made', label: 'Quantity made', type: 'number', min: 0, value: l.qty_made, required: true, full: true },
        { name: 'notes', label: 'Notes', type: 'textarea', value: l.notes || '', full: true },
      ],
      onSubmit: v => api(`/production/${l.id}`, { method: 'PUT', body: v }),
    });
    if (r) { toast('Entry updated'); load(); }
  }

  function eodModal(rows) {
    openModal({
      title: `End-of-day counts · ${relDay(date)}`, size: 'wide',
      body: `<p class="muted" style="margin-top:0">Enter how many of each item were sold and wasted today. Leftover is calculated automatically.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>By</th><th class="right">Available</th><th class="right">Sold</th><th class="right">Wasted</th><th class="right">Left</th></tr></thead>
      <tbody>${rows.map(l => `<tr data-row="${l.id}" data-made="${Number(l.qty_made) + Number(l.carried_in || 0)}"><td class="strong">${esc(l.item_name)}</td><td class="small">${esc(l.made_by_name || '')}</td>
        <td class="right num">${num(Number(l.qty_made) + Number(l.carried_in || 0))}</td>
        <td class="right"><input class="input num qty-input" type="number" min="0" step="any" name="sold" value="${l.qty_sold ?? ''}" placeholder="0"></td>
        <td class="right"><input class="input num qty-input" type="number" min="0" step="any" name="wasted" value="${l.qty_wasted || ''}" placeholder="0"></td>
        <td class="right num" data-left>—</td></tr>`).join('')}</tbody></table></div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${icon('check')} Save counts</button>`,
      onMount: m => {
        const upd = tr => {
          const s = tr.querySelector('[name=sold]').value, w = tr.querySelector('[name=wasted]').value;
          tr.querySelector('[data-left]').textContent = s === '' ? '—' : num(Number(tr.dataset.made) - Number(s) - Number(w || 0));
        };
        m.el.querySelectorAll('tr[data-row]').forEach(tr => { upd(tr); tr.addEventListener('input', () => upd(tr)); });
        m.el.querySelector('[data-save]').onclick = async e => {
          e.target.disabled = true;
          let n = 0;
          try {
            for (const tr of m.el.querySelectorAll('tr[data-row]')) {
              const sold = tr.querySelector('[name=sold]').value;
              if (sold === '') continue;
              await api(`/production/${tr.dataset.row}/sales`, { method: 'PUT', body: { qty_sold: sold, qty_wasted: tr.querySelector('[name=wasted]').value || 0 } });
              n++;
            }
            m.close(); toast(`Saved counts for ${n} item${n === 1 ? '' : 's'}`); load();
          } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        };
      },
    });
  }

  await load();
}
