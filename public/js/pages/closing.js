import { api, can, qs } from '../state.js';
import { esc, icon, money, moneyShort, fmtDay, fmtMonth, fmtDateTime, todayStr, shiftMonth, relDay, toast, confirmDialog, empty, downloadCSV, MODE_LABEL, cur } from '../ui.js';

export default async function closing(el, { query }) {
  let month = query.month || todayStr().slice(0, 7);
  let selected = query.date || todayStr();
  if (selected.slice(0, 7) !== month) month = selected.slice(0, 7);

  async function load() {
    const [list, day] = await Promise.all([
      can('closing.view') ? api('/closings' + qs({ month })) : Promise.resolve(null),
      api(`/closings/day/${selected}`),
    ]);
    render(list, day);
  }

  function calendar(list) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sun
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const map = Object.fromEntries((list ? list.closings : []).map(c => [c.date, c]));
    const missing = new Set(list ? list.missing : []);
    const t = todayStr();
    let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div class="day blank"></div>';
    for (let d = 1; d <= days; d++) {
      const ds = `${month}-${String(d).padStart(2, '0')}`;
      const c = map[ds];
      const cls = ds > t ? 'future' : c ? 'closed' : (missing.has(ds) || ds < t) ? 'missing' : '';
      cells += `<div class="day ${cls} ${ds === t ? 'today' : ''}" data-day="${ds}" ${ds === selected ? 'style="outline:2px solid var(--primary);outline-offset:1px"' : ''} title="${esc(fmtDay(ds))}">
        <b>${d}</b><span>${c ? moneyShort(c.total_sales).replace(cur(), '') : ds <= t && ds !== t ? 'open' : ''}</span></div>`;
    }
    return `<div class="cal">${cells}</div>
      <div class="legend-inline" style="margin-top:12px"><span><i style="background:var(--success-50);border:1px solid var(--success)"></i>Closed</span><span><i style="background:var(--warning-50);border:1px solid var(--warning)"></i>Not closed</span><span><i style="border:2px solid var(--primary)"></i>Today</span></div>`;
  }

  function render(list, day) {
    const c = day.closing;
    const v = c || { opening_cash: day.suggested_opening, cash_sales: '', online_sales: '', cash_counted: '', cash_handover: 0, notes: '' };
    const ed = day.editable;
    el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-icon" data-mprev aria-label="Previous month">${icon('chevLeft')}</button>
      <b style="min-width:140px;text-align:center">${esc(fmtMonth(month))}</b>
      <button class="btn btn-icon" data-mnext aria-label="Next month" ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <div class="spacer"></div>
      ${list ? `<button class="btn" data-csv>${icon('download')} Export CSV</button><button class="btn" onclick="window.print()">${icon('printer')} Print</button>` : ''}
    </div>

    ${list ? `<div class="grid g4 mb">
      <div class="card stat"><div class="label">${icon('cash')} Cash sales</div><div class="value">${money(list.totals.cash_sales, { dec: false })}</div><div class="foot">${esc(fmtMonth(month))}</div></div>
      <div class="card stat"><div class="label">${icon('phone')} Online sales</div><div class="value">${money(list.totals.online_sales, { dec: false })}</div><div class="foot">${list.totals.total_sales ? Math.round(list.totals.online_sales / list.totals.total_sales * 100) : 0}% of sales</div></div>
      <div class="card stat"><div class="label">${icon('receipt')} Expenses (closed days)</div><div class="value">${money(list.totals.expenses_total, { dec: false })}</div><div class="foot">${list.closings.length} days closed</div></div>
      <div class="card stat hero"><div class="label">Net</div><div class="value">${money(list.totals.net, { dec: false })}</div><div class="foot">Sales − expenses</div></div>
    </div>` : ''}

    <div class="grid g-1-2 mb">
      <div class="card">
        <div class="card-head"><h3>${icon('calendar')} Calendar</h3></div>
        <div class="card-body">${calendar(list)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${c ? 'Closing' : 'Close the day'} · ${esc(relDay(selected))}</h3><div class="spacer"></div>
          ${c ? `<span class="badge green dot">Closed by ${esc(c.closed_by_name || '—')}</span>` : '<span class="badge amber dot">Open</span>'}</div>
        <form class="card-body" data-form novalidate>
          <div class="form-error hidden"></div>
          <div class="form-grid">
            ${moneyField('cash_sales', 'Cash sales', v.cash_sales, ed, true, 'All cash received at the counter today')}
            ${moneyField('online_sales', 'Online sales', v.online_sales, ed, true, 'UPI, card, Paytm, Swiggy/Zomato payouts, etc.')}
            ${moneyField('opening_cash', 'Opening cash in drawer', v.opening_cash, ed, false, c ? '' : 'Carried from last closing')}
            ${moneyField('cash_counted', 'Cash counted at close', v.cash_counted ?? '', ed, false, 'Physically counted cash in drawer')}
            ${moneyField('cash_handover', 'Cash handed to owner / bank', v.cash_handover, ed, false, 'Removed from drawer after counting')}
            <div class="field"><label>Notes</label><input class="input" name="notes" value="${esc(v.notes || '')}" ${ed ? '' : 'disabled'} placeholder="Anything unusual today?"></div>
          </div>
          <div class="grid g2 mt">
            <div>
              <div class="row between" style="margin-bottom:6px"><b>Expenses on this day</b>${can('expenses.create') && ed ? `<a class="small" href="#/expenses?new=1&date=${selected}">${icon('plus')} Add</a>` : ''}</div>
              ${day.expenses.length ? day.expenses.map(e => `<div class="summary-line small"><span>${esc(e.category)}${e.vendor_name ? ' · ' + esc(e.vendor_name) : ''} <span class="badge">${esc(MODE_LABEL[e.payment_mode] || e.payment_mode)}</span></span><b class="num">${money(e.amount)}</b></div>`).join('')
                : '<div class="muted small">No expenses recorded for this day.</div>'}
            </div>
            <div class="card" style="padding:14px 16px;background:var(--surface-2);box-shadow:none" data-summary></div>
          </div>
        </form>
        ${ed || (c && can('closing.manage')) ? `<div class="card-foot">
          ${c ? `<span class="muted small">Last updated ${esc(fmtDateTime(c.updated_at))}</span>` : ''}<div style="flex:1"></div>
          ${c && can('closing.manage') ? `<button class="btn btn-danger" data-delete>${icon('trash')} Delete</button>` : ''}
          ${ed ? `<button class="btn btn-primary" data-save>${icon('check')} ${c ? 'Update closing' : 'Save closing'}</button>` : ''}
        </div>` : `<div class="card-foot small muted">${icon('lock')} ${c ? 'This closing is locked for your role.' : 'You can only close today or yesterday.'}</div>`}
      </div>
    </div>

    ${list ? `<div class="card">
      <div class="card-head"><h3>Closings in ${esc(fmtMonth(month))}</h3></div>
      ${list.closings.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th class="right">Cash</th><th class="right">Online</th><th class="right">Total sales</th><th class="right">Expenses</th><th class="right">Net</th><th class="right">Cash diff.</th><th>Closed by</th></tr></thead>
        <tbody>${list.closings.map(r => `<tr class="clickable" data-day="${r.date}"><td class="strong">${esc(fmtDay(r.date))}</td>
          <td class="right num">${money(r.cash_sales)}</td><td class="right num">${money(r.online_sales)}</td><td class="right num strong">${money(r.total_sales)}</td>
          <td class="right num">${money(r.expenses_total)}</td><td class="right num ${r.net < 0 ? 'neg' : 'pos'}">${money(r.net)}</td>
          <td class="right">${diff(r.cash_difference)}</td><td class="small">${esc(r.closed_by_name || '—')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="right num">${money(list.totals.cash_sales)}</td><td class="right num">${money(list.totals.online_sales)}</td><td class="right num">${money(list.totals.total_sales)}</td><td class="right num">${money(list.totals.expenses_total)}</td><td class="right num">${money(list.totals.net)}</td><td></td><td></td></tr></tfoot>
      </table></div>` : empty('No closings this month', 'Close each day to keep a record of cash and online sales.', 'cash')}
    </div>` : ''}`;

    const form = el.querySelector('[data-form]');
    const summary = el.querySelector('[data-summary]');
    const n = name => Number(form.elements[name].value) || 0;
    const updateSummary = () => {
      const cashExp = day.expense_totals.cash;
      const expected = n('opening_cash') + n('cash_sales') - cashExp;
      const counted = form.elements.cash_counted.value;
      const d = counted === '' ? null : Number(counted) - expected;
      summary.innerHTML = `
        <div class="summary-line"><span>Total sales</span><b class="num">${money(n('cash_sales') + n('online_sales'))}</b></div>
        <div class="summary-line"><span>Total expenses</span><b class="num">${money(day.expense_totals.total)}</b></div>
        <div class="summary-line"><span class="muted">Opening + cash sales − cash expenses</span><b class="num">${money(expected)}</b></div>
        <div class="summary-line"><span>Cash difference</span><b>${diff(d)}</b></div>
        <div class="summary-line total"><span>Net for the day</span><b class="num ${n('cash_sales') + n('online_sales') - day.expense_totals.total < 0 ? 'neg' : ''}">${money(n('cash_sales') + n('online_sales') - day.expense_totals.total)}</b></div>
        ${n('cash_handover') ? `<div class="small muted" style="margin-top:6px">Drawer after handover: ${money((counted === '' ? expected : Number(counted)) - n('cash_handover'))}</div>` : ''}`;
    };
    form.addEventListener('input', updateSummary);
    updateSummary();

    el.querySelectorAll('[data-day]').forEach(d => d.onclick = () => {
      if (d.classList.contains('future') || d.classList.contains('blank')) return;
      selected = d.dataset.day; load();
      el.querySelector('[data-form]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); selected = pickDay(); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); selected = pickDay(); load(); };

    const save = el.querySelector('[data-save]');
    if (save) save.onclick = async () => {
      const err = form.querySelector('.form-error');
      if (form.elements.cash_sales.value === '' || form.elements.online_sales.value === '') {
        err.textContent = 'Enter both cash and online sales (use 0 if none).'; err.classList.remove('hidden'); return;
      }
      save.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(form));
        await api('/closings', { method: 'POST', body: { ...body, date: selected } });
        toast(c ? 'Closing updated' : 'Day closed successfully');
        load();
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); save.disabled = false; }
    };
    const del = el.querySelector('[data-delete]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Delete the closing for ${fmtDay(selected)}? Expenses are not affected.`))) return;
      try { await api(`/closings/${c.id}`, { method: 'DELETE' }); toast('Closing deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    };
    const csv = el.querySelector('[data-csv]');
    if (csv) csv.onclick = () => downloadCSV(`closings-${month}.csv`, [
      ['Date', 'Opening cash', 'Cash sales', 'Online sales', 'Total sales', 'Expenses', 'Cash expenses', 'Expected cash', 'Cash counted', 'Difference', 'Handover', 'Net', 'Closed by', 'Notes'],
      ...list.closings.slice().reverse().map(r => [r.date, r.opening_cash, r.cash_sales, r.online_sales, r.total_sales, r.expenses_total, r.expenses_cash, r.expected_cash, r.cash_counted ?? '', r.cash_difference ?? '', r.cash_handover, r.net, r.closed_by_name || '', r.notes || '']),
    ]);
  }

  function pickDay() { const t = todayStr(); return month === t.slice(0, 7) ? t : `${month}-01`; }
  await load();
}

function moneyField(name, label, value, editable, required, hint) {
  return `<div class="field"><label>${esc(label)}${required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
    <div class="input-prefix"><span>${esc(cur())}</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.01" name="${name}" value="${esc(value)}" ${editable ? '' : 'disabled'} ${required ? 'required' : ''}></div>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}
function diff(v) {
  if (v == null) return '<span class="muted">—</span>';
  if (Math.abs(v) < 0.01) return '<span class="badge green">Matched</span>';
  return `<span class="badge ${v < 0 ? 'red' : 'amber'}">${v > 0 ? 'Extra ' : 'Short '}${money(Math.abs(v))}</span>`;
}
