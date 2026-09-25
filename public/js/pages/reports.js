import { api, qs } from '../state.js';
import { esc, icon, money, num, fmtDay, fmtMonth, todayStr, shiftMonth, makeChart, cssVar, PALETTE, moneyTick, delta, empty, downloadCSV, pct, MODE_LABEL } from '../ui.js';

export default async function reports(el, { query }) {
  let month = query.month || todayStr().slice(0, 7);
  let range = 12;

  async function load() {
    const [hist, rep] = await Promise.all([api('/reports/history' + qs({ months: range })), api('/reports/monthly' + qs({ month }))]);
    render(hist, rep);
  }

  function render(hist, r) {
    const s = r.summary;
    const firstMonth = hist.first_record ? hist.first_record.slice(0, 7) : null;
    el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-icon" data-mprev aria-label="Previous month">${icon('chevLeft')}</button>
      <input class="input" type="month" data-month value="${month}" max="${todayStr().slice(0, 7)}" style="min-width:0;width:180px">
      <button class="btn btn-icon" data-mnext aria-label="Next month" ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <h2 class="serif" style="font-size:22px;font-weight:500;margin-left:6px">${esc(fmtMonth(month))}</h2>
      <div class="spacer"></div>
      <button class="btn" data-csv>${icon('download')} Export month</button>
      <button class="btn" onclick="window.print()">${icon('printer')} Print</button>
    </div>

    <div class="card mb">
      <div class="card-head"><h3>${icon('history')} Month-by-month history</h3><div class="spacer"></div>
        <div class="tabs">${[6, 12, 24, 36].map(n => `<button data-range="${n}" class="${n === range ? 'active' : ''}">${n}m</button>`).join('')}</div></div>
      <div class="card-body"><div class="chart-box"><canvas id="ch-hist"></canvas></div>
        <div class="small muted" style="margin-top:8px">Click a month to open its report.${firstMonth ? ` Records start from ${esc(fmtMonth(firstMonth))}.` : ''}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th class="right">Cash</th><th class="right">Online</th><th class="right">Sales</th><th class="right">Expenses</th><th class="right">Net</th><th class="right">Days closed</th></tr></thead>
        <tbody>${hist.months.slice().reverse().filter(m => m.sales || m.expenses || m.month === month).map(m => `<tr class="clickable" data-pick="${m.month}" ${m.month === month ? 'style="background:var(--primary-50)"' : ''}>
          <td class="strong">${esc(fmtMonth(m.month))}</td><td class="right num">${money(m.cash, { dec: false })}</td><td class="right num">${money(m.online, { dec: false })}</td>
          <td class="right num strong">${money(m.sales, { dec: false })}</td><td class="right num">${money(m.expenses, { dec: false })}</td>
          <td class="right num ${m.net < 0 ? 'neg' : 'pos'}">${money(m.net, { dec: false })}</td><td class="right">${m.days_closed}</td></tr>`).join('')}</tbody></table></div>
    </div>

    <div class="grid g4 mb">
      <div class="card stat hero"><div class="label">Total sales</div><div class="value">${money(s.sales.total, { dec: false })}</div><div class="foot">${delta(s.sales.total, s.prev.sales)} vs ${esc(fmtMonth(s.prev.month))}</div></div>
      <div class="card stat"><div class="label">Expenses</div><div class="value">${money(s.expenses.total, { dec: false })}</div><div class="foot">${delta(s.expenses.total, s.prev.expenses, { invert: true })} ${s.expenses.count} transactions</div></div>
      <div class="card stat"><div class="label">Net result</div><div class="value ${s.net < 0 ? 'neg' : 'pos'}">${money(s.net, { dec: false })}</div><div class="foot">${delta(s.net, s.prev.net)} margin ${pct(s.net, s.sales.total)}%</div></div>
      <div class="card stat"><div class="label">Average day</div><div class="value">${money(s.avg_daily_sales, { dec: false })}</div><div class="foot">${s.days_closed}/${s.days_in_month} days closed${s.best_day ? ` · best ${esc(fmtDay(s.best_day.date))}` : ''}</div></div>
    </div>

    <div class="grid g3 mb">
      <div class="card stat"><div class="label">${icon('cash')} Cash sales</div><div class="value">${money(s.sales.cash, { dec: false })}</div><div class="foot">${100 - Math.round(s.online_share)}% of sales</div></div>
      <div class="card stat"><div class="label">${icon('phone')} Online sales</div><div class="value">${money(s.sales.online, { dec: false })}</div><div class="foot">${Math.round(s.online_share)}% of sales</div></div>
      <div class="card stat"><div class="label">${icon('cake')} Cake orders</div><div class="value">${num(r.orders.total || 0)}</div><div class="foot">${num(r.orders.delivered || 0)} delivered · ${num(r.orders.cancelled || 0)} cancelled</div></div>
    </div>

    <div class="grid g-2-1 mb">
      <div class="card"><div class="card-head"><h3>Daily sales & expenses</h3></div><div class="card-body"><div class="chart-box"><canvas id="ch-daily"></canvas></div></div></div>
      <div class="card"><div class="card-head"><h3>Expenses by category</h3></div>
        <div class="card-body">${r.expense_categories.length ? `<div class="chart-box sm"><canvas id="ch-cat"></canvas></div>
          <div class="mt">${r.expense_categories.map((c, i) => `<div class="summary-line small"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-right:6px"></i>${esc(c.category)} <span class="muted">(${c.count})</span></span><b class="num">${money(c.total)}</b></div>`).join('')}
          ${r.expense_modes.map(m => `<div class="summary-line small muted"><span>Paid by ${esc(MODE_LABEL[m.payment_mode] || m.payment_mode)}</span><span class="num">${money(m.total)}</span></div>`).join('')}</div>`
          : empty('No expenses', '', 'receipt')}</div></div>
    </div>

    <div class="grid g2 mb">
      <div class="card"><div class="card-head"><h3>Vendors this month</h3></div>
        ${r.vendors.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Vendor</th><th class="right">Billed</th><th class="right">Paid</th><th class="right">Pending at month end</th></tr></thead>
          <tbody>${r.vendors.map(v => `<tr class="clickable" onclick="location.hash='#/vendors/${v.id}'"><td class="strong">${esc(v.name)}</td><td class="right num">${money(v.billed)}</td><td class="right num pos">${money(v.paid)}</td><td class="right num ${v.pending_at_month_end > 0 ? 'neg' : ''}">${money(v.pending_at_month_end)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="right num">${money(r.vendors.reduce((a, v) => a + v.billed, 0))}</td><td class="right num">${money(r.vendors.reduce((a, v) => a + v.paid, 0))}</td><td class="right num">${money(r.vendors.reduce((a, v) => a + v.pending_at_month_end, 0))}</td></tr></tfoot></table></div>`
        : empty('No vendor activity', '', 'truck')}</div>
      <div class="card"><div class="card-head"><h3>Production & sell-through</h3></div>
        ${r.production.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="right">Made</th><th class="right">Sold</th><th class="right">Wasted</th><th class="right">Sold %</th></tr></thead>
          <tbody>${r.production.map(p => `<tr><td class="strong">${esc(p.item_name)}</td><td class="right num">${num(p.made)}</td><td class="right num pos">${num(p.sold)}</td><td class="right num neg">${num(p.wasted)}</td><td class="right">${pct(p.sold, p.made)}%</td></tr>`).join('')}</tbody></table></div>`
        : empty('No production logged', '', 'chef')}
        ${r.staff_production.length ? `<div class="card-foot" style="flex-wrap:wrap;gap:8px"><b class="small">By staff:</b>${r.staff_production.map(sp => `<span class="badge">${esc(sp.name)} · ${num(sp.made)} made</span>`).join('')}</div>` : ''}
      </div>
    </div>

    <div class="card"><div class="card-head"><h3>Day-by-day</h3></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th class="right">Cash</th><th class="right">Online</th><th class="right">Total sales</th><th class="right">Expenses</th><th class="right">Net</th><th></th></tr></thead>
        <tbody>${r.daily.filter(d => d.date <= todayStr()).map(d => `<tr><td class="nowrap">${esc(fmtDay(d.date))}</td>
          <td class="right num">${d.closed ? money(d.cash) : ''}</td><td class="right num">${d.closed ? money(d.online) : ''}</td><td class="right num strong">${d.closed ? money(d.total) : ''}</td>
          <td class="right num">${d.expenses ? money(d.expenses) : ''}</td><td class="right num ${d.net < 0 ? 'neg' : ''}">${d.closed || d.expenses ? money(d.net) : ''}</td>
          <td>${d.closed ? '' : '<span class="badge amber">not closed</span>'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="right num">${money(s.sales.cash)}</td><td class="right num">${money(s.sales.online)}</td><td class="right num">${money(s.sales.total)}</td><td class="right num">${money(s.expenses.total)}</td><td class="right num">${money(s.net)}</td><td></td></tr></tfoot></table></div>
    </div>`;

    const h = hist.months;
    makeChart(el.querySelector('#ch-hist'), {
      data: {
        labels: h.map(m => fmtMonthShort(m.month)),
        datasets: [
          { type: 'bar', label: 'Cash', data: h.map(m => m.cash), backgroundColor: h.map(m => m.month === month ? PALETTE[0] : PALETTE[0] + 'b3'), stack: 's', borderRadius: 5, maxBarThickness: 34 },
          { type: 'bar', label: 'Online', data: h.map(m => m.online), backgroundColor: h.map(m => m.month === month ? PALETTE[1] : PALETTE[1] + 'b3'), stack: 's', borderRadius: 5, maxBarThickness: 34 },
          { type: 'line', label: 'Expenses', data: h.map(m => m.expenses), borderColor: cssVar('--text-2'), borderDash: [5, 4], pointRadius: 2, tension: .3 },
          { type: 'line', label: 'Net', data: h.map(m => m.net), borderColor: PALETTE[2], backgroundColor: PALETTE[2], pointRadius: 3, tension: .3 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onClick: (_e, els) => { if (els.length) { month = h[els[0].index].month; load(); } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: false, ticks: { callback: moneyTick } } },
      },
    });
    const days = r.daily;
    makeChart(el.querySelector('#ch-daily'), {
      data: {
        labels: days.map(d => Number(d.date.slice(8))),
        datasets: [
          { type: 'bar', label: 'Cash', data: days.map(d => d.cash), backgroundColor: PALETTE[0], stack: 's', borderRadius: 3 },
          { type: 'bar', label: 'Online', data: days.map(d => d.online), backgroundColor: PALETTE[1], stack: 's', borderRadius: 3 },
          { type: 'line', label: 'Expenses', data: days.map(d => d.expenses), borderColor: cssVar('--text-2'), borderDash: [5, 4], pointRadius: 0, tension: .3 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: c => fmtDay(days[c[0].dataIndex].date), label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: moneyTick } } },
      },
    });
    if (r.expense_categories.length) {
      makeChart(el.querySelector('#ch-cat'), {
        type: 'doughnut',
        data: { labels: r.expense_categories.map(c => c.category), datasets: [{ data: r.expense_categories.map(c => c.total), backgroundColor: PALETTE, borderWidth: 2, borderColor: cssVar('--surface') }] },
        options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)}` } } } },
      });
    }

    el.querySelector('[data-month]').onchange = e => { if (e.target.value) { month = e.target.value; load(); } };
    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); load(); };
    el.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { range = Number(b.dataset.range); load(); });
    el.querySelectorAll('[data-pick]').forEach(t => t.onclick = () => { month = t.dataset.pick; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.querySelector('[data-csv]').onclick = () => downloadCSV(`report-${month}.csv`, [
      [`Report for ${fmtMonth(month)}`], [],
      ['Summary'], ['Cash sales', s.sales.cash], ['Online sales', s.sales.online], ['Total sales', s.sales.total], ['Expenses', s.expenses.total], ['Net', s.net], [],
      ['Date', 'Closed', 'Cash', 'Online', 'Total sales', 'Expenses', 'Net'], ...r.daily.map(d => [d.date, d.closed ? 'yes' : 'no', d.cash, d.online, d.total, d.expenses, d.net]), [],
      ['Expense category', 'Transactions', 'Total'], ...r.expense_categories.map(c => [c.category, c.count, c.total]), [],
      ['Vendor', 'Billed', 'Paid', 'Pending at month end'], ...r.vendors.map(v => [v.name, v.billed, v.paid, v.pending_at_month_end]), [],
      ['Product', 'Made', 'Sold', 'Wasted'], ...r.production.map(p => [p.item_name, p.made, p.sold, p.wasted]),
    ]);
  }

  await load();
}

const fmtMonthShort = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
