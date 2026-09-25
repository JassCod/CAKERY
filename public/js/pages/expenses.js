import { state, api, can, qs } from '../state.js';
import { esc, icon, money, fmtDay, fmtMonth, todayStr, addDays, shiftMonth, toast, formModal, confirmDialog, empty, downloadCSV, MODE_LABEL, debounce, pct } from '../ui.js';

export default async function expenses(el, { query }) {
  const f = { month: query.month || todayStr().slice(0, 7), category: '', mode: '', q: '', vendor_id: query.vendor_id || '' };
  const canView = can('expenses.view');
  const vendors = (await api('/vendors').catch(() => ({ vendors: [] }))).vendors;
  const cats = state.settings.expense_categories || [];

  async function load() {
    if (!canView) return renderCreateOnly();
    const data = await api('/expenses' + qs(f));
    render(data);
  }

  function renderCreateOnly() {
    el.innerHTML = `<div class="card">${empty('Record an expense', 'You can add expenses; viewing the full list needs manager access.', 'receipt', `<button class="btn btn-primary" data-add>${icon('plus')} Add expense</button>`)}</div>`;
    el.querySelector('[data-add]').onclick = () => edit();
  }

  function render({ expenses: rows, byCategory, totals }) {
    const maxCat = Math.max(1, ...byCategory.map(c => c.total));
    el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-icon" data-mprev aria-label="Previous month">${icon('chevLeft')}</button>
      <b style="min-width:140px;text-align:center">${esc(fmtMonth(f.month))}</b>
      <button class="btn btn-icon" data-mnext aria-label="Next month" ${f.month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <div class="search">${icon('search')}<input class="input" data-q placeholder="Search description, vendor, ref…" value="${esc(f.q)}"></div>
      <select class="select" data-cat><option value="">All categories</option>${[...new Set([...cats, ...byCategory.map(c => c.category)])].map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select class="select" data-mode><option value="">All modes</option>${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${k === f.mode ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="btn" data-csv>${icon('download')} CSV</button>
      ${can('expenses.create', 'expenses.manage') ? `<button class="btn btn-primary" data-add>${icon('plus')} Add expense</button>` : ''}
    </div>

    <div class="grid g4 mb">
      <div class="card stat hero"><div class="label">Total expenses</div><div class="value">${money(totals.total, { dec: false })}</div><div class="foot">${totals.count} transactions</div></div>
      <div class="card stat"><div class="label">${icon('cash')} Paid in cash</div><div class="value">${money(totals.cash, { dec: false })}</div><div class="foot">${pct(totals.cash, totals.total)}% of total</div></div>
      <div class="card stat"><div class="label">${icon('phone')} Paid online / bank</div><div class="value">${money(totals.online, { dec: false })}</div><div class="foot">${pct(totals.online, totals.total)}% of total</div></div>
      <div class="card stat"><div class="label">Biggest category</div><div class="value" style="font-size:20px">${esc(byCategory[0] ? byCategory[0].category : '—')}</div><div class="foot">${byCategory[0] ? money(byCategory[0].total) : ''}</div></div>
    </div>

    <div class="grid g-2-1">
      <div class="card">
        ${rows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Category</th><th>Details</th><th>Mode</th><th class="right">Amount</th><th>By</th><th></th></tr></thead>
          <tbody>${rows.map(e => `<tr>
            <td class="nowrap">${esc(fmtDay(e.date))}</td>
            <td><span class="badge rose">${esc(e.category)}</span></td>
            <td style="max-width:320px"><div class="strong">${esc(e.vendor_name || e.paid_to || '')}</div><div class="small muted">${esc(e.description || '')}${e.reference ? ' · Ref ' + esc(e.reference) : ''}</div></td>
            <td class="small nowrap">${esc(MODE_LABEL[e.payment_mode] || e.payment_mode)}</td>
            <td class="right num strong nowrap">${money(e.amount)}</td>
            <td class="small nowrap">${esc(e.created_by_name || '—')}</td>
            <td><div class="actions">${canModify(e) ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${e.id}" title="Edit">${icon('edit')}</button><button class="btn btn-sm btn-ghost btn-icon" data-del="${e.id}" title="Delete">${icon('trash')}</button>`
              : e.source === 'vendor_payment' ? `<a class="btn btn-sm btn-ghost" href="#/vendors/${e.vendor_id}" title="Recorded from vendor payment">${icon('truck')}</a>` : ''}</div></td>
          </tr>`).join('')}</tbody></table></div>` : empty('No expenses found', 'Try another month or filter.', 'receipt')}
      </div>
      <div class="card">
        <div class="card-head"><h3>By category</h3></div>
        <div class="card-body">${byCategory.length ? byCategory.map(c => `
          <div style="margin-bottom:14px;cursor:pointer" data-pick="${esc(c.category)}">
            <div class="row between small"><b>${esc(c.category)}</b><span class="num">${money(c.total)} <span class="muted">· ${c.count}</span></span></div>
            <div class="bar" style="margin-top:6px"><i style="width:${(c.total / maxCat) * 100}%"></i></div>
          </div>`).join('') : '<div class="muted small">Nothing yet.</div>'}</div>
      </div>
    </div>`;

    el.querySelector('[data-mprev]').onclick = () => { f.month = shiftMonth(f.month, -1); load(); };
    el.querySelector('[data-mnext]').onclick = () => { f.month = shiftMonth(f.month, 1); load(); };
    el.querySelector('[data-q]').oninput = debounce(e => { f.q = e.target.value; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350);
    el.querySelector('[data-cat]').onchange = e => { f.category = e.target.value; load(); };
    el.querySelector('[data-mode]').onchange = e => { f.mode = e.target.value; load(); };
    el.querySelectorAll('[data-pick]').forEach(p => p.onclick = () => { f.category = f.category === p.dataset.pick ? '' : p.dataset.pick; load(); });
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = () => edit();
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(rows.find(r => r.id === Number(b.dataset.edit))));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const e = rows.find(r => r.id === Number(b.dataset.del));
      if (!(await confirmDialog(`Delete ${e.category} expense of ${money(e.amount)} on ${fmtDay(e.date)}?`))) return;
      try { await api(`/expenses/${e.id}`, { method: 'DELETE' }); toast('Expense deleted'); load(); } catch (err) { toast(err.message, 'error'); }
    });
    el.querySelector('[data-csv]').onclick = () => downloadCSV(`expenses-${f.month}.csv`, [
      ['Date', 'Category', 'Amount', 'Mode', 'Vendor', 'Paid to', 'Description', 'Reference', 'Recorded by'],
      ...rows.map(e => [e.date, e.category, e.amount, e.payment_mode, e.vendor_name || '', e.paid_to || '', e.description || '', e.reference || '', e.created_by_name || '']),
    ]);
  }

  function canModify(e) {
    if (e.source === 'vendor_payment') return false;
    return can('expenses.manage') || (e.created_by === state.user.id && e.date >= addDays(todayStr(), -1));
  }

  async function edit(e) {
    const manage = can('expenses.manage');
    const r = await formModal({
      title: e ? 'Edit expense' : 'Add expense',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: e ? e.date : (query.date || todayStr()), required: true, attrs: `max="${todayStr()}" ${manage ? '' : `min="${addDays(todayStr(), -1)}"`}` },
        { name: 'amount', label: 'Amount', type: 'money', value: e ? e.amount : '', required: true },
        { name: 'category', label: 'Category', type: 'datalist', options: cats, value: e ? e.category : '', required: true, placeholder: 'e.g. Raw Materials' },
        { name: 'payment_mode', label: 'Paid by', type: 'select', options: Object.entries(MODE_LABEL), value: e ? e.payment_mode : 'cash' },
        { name: 'vendor_id', label: 'Vendor (optional)', type: 'select', placeholder: '— none —', options: vendors.map(v => [v.id, v.name]), value: e ? e.vendor_id || '' : '' },
        { name: 'paid_to', label: 'Paid to (if not a vendor)', value: e ? e.paid_to || '' : '', placeholder: 'e.g. electrician' },
        { name: 'description', label: 'Description', type: 'textarea', value: e ? e.description || '' : '', full: true, placeholder: 'What was this for?' },
        { name: 'reference', label: 'Reference / bill no.', value: e ? e.reference || '' : '', full: true },
      ],
      onSubmit: v => api(e ? `/expenses/${e.id}` : '/expenses', { method: e ? 'PUT' : 'POST', body: v }),
    });
    if (r) { toast(e ? 'Expense updated' : 'Expense recorded'); load(); }
  }

  await load();
  if (query.new && can('expenses.create', 'expenses.manage')) { history.replaceState(null, '', '#/expenses'); edit(); }
}
