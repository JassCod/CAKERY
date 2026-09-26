import { api, can, qs } from '../state.js';
import { esc, icon, avatar, money, fmtDay, fmtMonth, todayStr, shiftMonth, toast, formModal, confirmDialog, empty, downloadCSV, MODE_LABEL } from '../ui.js';
import { attCalendar, countsLine, cssOnce } from './att-ui.js';

const KIND = { advance: ['Advance', 'amber'], salary: ['Salary paid', 'green'], bonus: ['Bonus (+)', 'blue'], deduction: ['Deduction (−)', 'red'] };

export default async function salary(el, ctx) {
  cssOnce();
  if (ctx.params[0]) return salaryDetail(el, ctx.params[0], ctx);
  let month = ctx.query.month || todayStr().slice(0, 7);
  const manage = can('salary.manage');

  async function load() {
    const d = await api('/salary' + qs({ month }));
    const t = d.totals;
    el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-icon" data-mprev>${icon('chevLeft')}</button><b style="min-width:150px;text-align:center">${esc(fmtMonth(month))}</b>
      <button class="btn btn-icon" data-mnext ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <div class="spacer"></div><button class="btn" data-csv>${icon('download')} CSV</button>
    </div>
    <div class="grid g4 mb">
      <div class="card stat"><div class="label">Recommended (by attendance)</div><div class="value">${money(t.recommended, { dec: false })}</div><div class="foot">${d.staff.length} staff</div></div>
      <div class="card stat"><div class="label">Final payable</div><div class="value">${money(t.payable, { dec: false })}</div><div class="foot">after bonus / deductions</div></div>
      <div class="card stat"><div class="label">Paid so far</div><div class="value pos">${money(t.paid, { dec: false })}</div><div class="foot">incl. advances ${money(t.advance, { dec: false })}</div></div>
      <div class="card stat hero"><div class="label">Still to pay</div><div class="value">${money(Number(t.pending) + Number(t.earlier_pending), { dec: false })}</div>
        <div class="foot">${Number(t.earlier_pending) ? `incl. ${money(t.earlier_pending, { dec: false })} from earlier months` : 'this month'}</div></div>
    </div>
    <div class="card">${d.staff.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Staff</th><th>Salary</th><th>Paid days</th><th class="right">Recommended</th><th class="right">Final</th><th class="right">Paid</th><th class="right">To pay</th><th></th></tr></thead>
      <tbody>${d.staff.map(s => {
        const owe = Number(s.pending) + Number(s.earlier_pending);
        return `<tr class="clickable" data-open="${s.user_id}">
        <td><span class="row" style="gap:10px;flex-wrap:nowrap">${avatar(s.name, 'sm')}<span><b>${esc(s.name)}</b><div class="small muted">${esc(s.designation || s.role.replace('_', ' '))}</div></span></span></td>
        <td class="small nowrap">${Number(s.monthly_salary) ? `${money(s.monthly_salary, { dec: false })} / ${s.salary_type === 'daily' ? 'day' : 'month'}` : '<span class="badge amber">not set</span>'}</td>
        <td class="small nowrap"><b>${Number(s.paid_days)}</b> <span class="muted">· P${s.counts.present} ½${s.counts.half_day} A${s.counts.absent}</span></td>
        <td class="right num">${money(s.recommended, { dec: false })}</td>
        <td class="right num">${s.final_amount != null ? `<b>${money(s.final, { dec: false })}</b>` : '<span class="muted">= recommended</span>'}</td>
        <td class="right num pos">${money(s.paid_total, { dec: false })}${Number(s.advance) ? `<div class="small muted">adv. ${money(s.advance, { dec: false })}</div>` : ''}</td>
        <td class="right num">${owe >= 0 ? `<b class="${owe > 0 ? 'neg' : 'pos'}">${money(owe, { dec: false })}</b>` : `<b class="pos">${money(-owe, { dec: false })}</b><div class="small muted">paid extra</div>`}${Number(s.earlier_pending) ? `<div class="small" style="color:var(--warning)">${money(s.earlier_pending, { dec: false })} earlier</div>` : ''}</td>
        <td><div class="actions">${manage && owe > 0 ? `<button class="btn btn-sm btn-primary" data-pay="${s.user_id}">${icon('cash')} Pay now</button>` : ''}
          ${manage ? `<button class="btn btn-sm" data-adv="${s.user_id}">Advance</button>` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>`
      : empty('No staff with salary yet', 'Set each person\'s salary in Staff & Access → open the person → Edit record.', 'wallet')}</div>
    <p class="small muted mt">${icon('alert')} The recommended amount is only a suggestion based on attendance (present, half days, paid leave, week offs). You decide the final amount.</p>`;

    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); load(); };
    el.querySelectorAll('[data-open]').forEach(r => r.onclick = e => { if (!e.target.closest('button')) ctx.navigate(`#/salary/${r.dataset.open}?month=${month}`); });
    el.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => { if (await payDialog(d.staff.find(s => s.user_id === b.dataset.pay), month, 'salary')) load(); });
    el.querySelectorAll('[data-adv]').forEach(b => b.onclick = async () => { if (await payDialog(d.staff.find(s => s.user_id === b.dataset.adv), month, 'advance')) load(); });
    el.querySelector('[data-csv]').onclick = () => downloadCSV(`salary-${month}.csv`, [
      ['Name', 'Salary', 'Type', 'Paid days', 'Present', 'Half days', 'Absent', 'Recommended', 'Final', 'Bonus', 'Deduction', 'Advance', 'Salary paid', 'Pending this month', 'Pending earlier'],
      ...d.staff.map(s => [s.name, s.monthly_salary, s.salary_type, s.paid_days, s.counts.present, s.counts.half_day, s.counts.absent, s.recommended, s.final, s.bonus, s.deduction, s.advance, s.salary_paid, s.pending, s.earlier_pending]),
    ]);
  }
  await load();
}

// Pay dialog: lists each month that still has money owed; defaults to the oldest.
export async function payDialog(s, month, kind = 'salary') {
  const owed = [...(s.earlier || []).filter(e => Number(e.pending) > 0), ...(Number(s.pending) > 0 ? [{ month, pending: s.pending }] : [])];
  const first = owed[0] || { month, pending: 0 };
  const monthOpts = owed.length && kind === 'salary'
    ? owed.map(o => [o.month, `${fmtMonth(o.month)} — ${money(o.pending, { dec: false })} to pay`])
    : [[month, fmtMonth(month)]];
  const r = await formModal({
    title: `${kind === 'advance' ? 'Give advance to' : 'Pay'} ${s.name}`,
    intro: kind === 'salary' && owed.length ? `<div class="money" style="margin-bottom:14px"><small>Total still to pay</small><b class="neg">${money(owed.reduce((a, o) => a + Number(o.pending), 0))}</b></div>` : '',
    fields: [
      { name: 'kind', label: 'Type', type: 'select', value: kind, options: Object.entries(KIND).map(([k, v]) => [k, v[0]]) },
      { name: 'month', label: 'For month', type: 'select', value: first.month, options: monthOpts },
      { name: 'amount', label: 'Amount', type: 'money', required: true, value: kind === 'salary' && Number(first.pending) > 0 ? first.pending : '' },
      { name: 'date', label: 'Date', type: 'date', value: todayStr(), attrs: `max="${todayStr()}"` },
      { name: 'payment_mode', label: 'Paid by', type: 'select', value: 'cash', options: Object.entries(MODE_LABEL) },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ],
    onMount: (_m, form) => {
      form.elements.month.onchange = () => {
        const o = owed.find(x => x.month === form.elements.month.value);
        if (o && form.elements.kind.value === 'salary') form.elements.amount.value = o.pending;
      };
    },
    submitText: kind === 'advance' ? 'Give advance' : 'Record payment',
    onSubmit: v => api(`/salary/${s.user_id}/payments`, { method: 'POST', body: v }),
  });
  if (r) toast('Saved — also added to Expenses when money was paid');
  return r;
}

async function salaryDetail(el, userId, ctx) {
  let month = ctx.query.month || todayStr().slice(0, 7);
  const manage = can('salary.manage');

  async function load() {
    const d = await api(`/salary/${userId}` + qs({ month }));
    const c = d.calc;
    ctx.setTitle(`Salary · ${c.name}`);
    const earlier = (d.earlier || []).filter(e => Number(e.pending) > 0);
    el.innerHTML = `
    <div class="toolbar"><a class="btn btn-ghost" href="#/salary?month=${month}">${icon('chevLeft')} All salaries</a>
      <button class="btn btn-icon" data-mprev>${icon('chevLeft')}</button><b style="min-width:150px;text-align:center">${esc(fmtMonth(month))}</b>
      <button class="btn btn-icon" data-mnext ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <div class="spacer"></div>
      ${manage ? `<button class="btn" data-adv>${icon('plus')} Advance / bonus / deduction</button><button class="btn btn-primary" data-pay>${icon('cash')} Pay now</button>` : ''}
    </div>
    ${earlier.length ? `<div class="card card-pad mb" style="border-color:var(--warning);background:var(--warning-50)">
      <b>${icon('alert')} Unpaid from earlier months: ${money(earlier.reduce((a, e) => a + Number(e.pending), 0))}</b>
      <div class="row" style="gap:6px;margin-top:6px">${earlier.map(e => `<a class="chip st-half" href="#/salary/${userId}?month=${e.month}">${esc(fmtMonth(e.month))}: ${money(e.pending, { dec: false })}</a>`).join('')}</div></div>` : ''}
    <div class="grid g-1-2 mb">
      <div class="card card-pad">
        <div class="row" style="gap:12px;flex-wrap:nowrap">${avatar(c.name)}<div><h2 style="font-size:20px">${esc(c.name)}</h2><div class="muted small">${esc(c.designation || c.role.replace('_', ' '))}${c.kitchen ? ' · ' + esc(c.kitchen) : ''}</div></div></div>
        <div class="mt">
          <div class="summary-line"><span>Salary</span><b>${Number(c.monthly_salary) ? `${money(c.monthly_salary)} / ${c.salary_type === 'daily' ? 'day' : 'month'}` : 'not set'}</b></div>
          <div class="summary-line"><span>Per day</span><b>${money(c.per_day)}${c.salary_type === 'daily' ? '' : ` <span class="muted small">(÷ ${c.days_in_month} days)</span>`}</b></div>
          <div class="summary-line"><span>Paid days so far</span><b>${Number(c.paid_days)}</b></div>
          <div class="summary-line total"><span>Recommended</span><b>${money(c.recommended)}</b></div>
        </div>
        <div class="small muted" style="margin-top:6px">${c.salary_type === 'daily' ? 'Daily wage: present = 1 day, half day = ½.' : 'Monthly: present, week off, holiday and paid leave count as paid days; half day = ½; absent and unpaid leave are not paid.'}
          Counted until ${esc(fmtDay(c.counted_until))}.</div>
      </div>
      <div class="card card-pad">
        <div class="grid g3">
          <div class="money"><small>Final salary</small><b>${money(c.final)}</b>${c.final_amount == null ? '<div class="small muted">using recommended</div>' : ''}</div>
          <div class="money"><small>Paid (advance + salary)</small><b class="pos">${money(c.paid_total)}</b></div>
          ${Number(c.pending) >= 0 ? `<div class="money"><small>Still to pay</small><b class="${Number(c.pending) > 0 ? 'neg' : 'pos'}">${money(c.pending)}</b></div>`
            : `<div class="money"><small>Paid extra</small><b class="pos">${money(-c.pending)}</b><div class="small muted">taken off next month</div></div>`}
        </div>
        <div class="mt">
          <div class="summary-line"><span>Final salary</span><b>${money(c.final)}</b></div>
          ${Number(c.bonus) ? `<div class="summary-line"><span>+ Bonus</span><b>${money(c.bonus)}</b></div>` : ''}
          ${Number(c.deduction) ? `<div class="summary-line"><span>− Deductions</span><b>${money(c.deduction)}</b></div>` : ''}
          <div class="summary-line"><span>− Advance given</span><b>${money(c.advance)}</b></div>
          <div class="summary-line"><span>− Salary paid</span><b>${money(c.salary_paid)}</b></div>
          <div class="summary-line total"><span>${Number(c.pending) >= 0 ? 'Balance to pay' : 'Paid extra (adjust next month)'}</span><b class="${Number(c.pending) > 0 ? 'neg' : 'pos'}">${money(Math.abs(c.pending))}</b></div>
        </div>
        ${c.final_note ? `<div class="small muted">Note: ${esc(c.final_note)}</div>` : ''}
        ${manage ? `<div class="row mt"><button class="btn btn-sm" data-final>${icon('edit')} Set final salary</button></div>` : ''}
      </div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Attendance</h3></div><div class="card-body">${attCalendar(d.days)}<div class="row mt" style="gap:6px">${countsLine(c.counts)}</div></div></div>
      <div class="card"><div class="card-head"><h3>Payments & adjustments</h3></div>
        ${d.payments.length ? `<ul class="list">${d.payments.map(p => `<li><div class="grow"><b>${esc(KIND[p.kind][0])} · ${money(p.amount)}</b>
          <small>${esc(fmtDay(p.date))}${['advance', 'salary'].includes(p.kind) ? ' · ' + esc(MODE_LABEL[p.payment_mode] || p.payment_mode) : ''}${p.note ? ' · ' + esc(p.note) : ''}</small></div>
          <span class="badge ${KIND[p.kind][1]}">${esc(p.kind)}</span>${manage ? `<button class="btn btn-sm btn-ghost btn-icon" data-del="${p.id}">${icon('trash')}</button>` : ''}</li>`).join('')}</ul>`
          : empty('Nothing paid yet this month', '', 'wallet')}
        ${d.history && d.history.length > 1 ? `<div class="card-foot" style="flex-direction:column;align-items:stretch;gap:4px"><b class="small">Last months</b>
          ${d.history.map(h => `<a class="row between small" style="color:inherit" href="#/salary/${userId}?month=${h.month}"><span>${esc(fmtMonth(h.month))}</span>
            <span>payable ${money(h.payable, { dec: false })} · paid ${money(h.paid_total, { dec: false })} · <b class="${Number(h.pending) > 0 ? 'neg' : 'pos'}">${Number(h.pending) > 0 ? 'owe ' + money(h.pending, { dec: false }) : 'settled'}</b></span></a>`).join('')}</div>` : ''}
      </div>
    </div>`;

    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); history.replaceState(null, '', `#/salary/${userId}?month=${month}`); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); history.replaceState(null, '', `#/salary/${userId}?month=${month}`); load(); };
    const staffRow = { ...c, earlier: d.earlier };
    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    on('[data-pay]', async () => { if (await payDialog(staffRow, month, 'salary')) load(); });
    on('[data-adv]', async () => { if (await payDialog(staffRow, month, 'advance')) load(); });
    on('[data-final]', async () => {
      const r = await formModal({
        title: `Final salary · ${fmtMonth(month)}`, size: 'narrow',
        intro: `<p class="muted" style="margin-top:0">Recommended from attendance: <b>${money(c.recommended)}</b>. Leave empty to use the recommended amount.</p>`,
        fields: [
          { name: 'amount', label: 'Final salary', type: 'money', value: c.final_amount ?? '', full: true },
          { name: 'note', label: 'Note', value: c.final_note || '', full: true, placeholder: 'e.g. extra hours in festival week' },
        ],
        onSubmit: v => api(`/salary/${userId}/final`, { method: 'PUT', body: { ...v, month } }),
      });
      if (r) { toast('Final salary saved'); load(); }
    });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('Delete this entry? Its expense record is removed too.'))) return;
      try { await api(`/salary/payments/${b.dataset.del}`, { method: 'DELETE' }); toast('Entry deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }
  await load();
}
