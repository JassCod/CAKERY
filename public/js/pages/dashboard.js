import { state, api, can } from '../state.js';
import { esc, icon, money, moneyShort, num, fmtDay, relDay, makeChart, cssVar, PALETTE, moneyTick, delta, empty, statusBadge, pct, fmtMonth } from '../ui.js';
import { ORDER_STATUS } from './orders.js';

export default async function dashboard(el) {
  const d = await api('/dashboard');
  const u = state.user;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const f = d.financials;
  const parts = [];

  parts.push(`
  <div class="card welcome mb">
    <div style="flex:1;min-width:0">
      <h2>${greet}, <em>${esc(u.name.split(' ')[0])}</em></h2>
      <div class="muted" style="margin-top:4px">${esc(roleLine(d))}</div>
      <div class="row" style="margin-top:14px">${quickActions(d)}</div>
    </div>
    <svg class="art" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="34" width="44" height="18" rx="5" fill="#8a5a44"/><rect x="14" y="22" width="36" height="15" rx="5" fill="#ec6b96"/><path d="M14 29c3.5 0 3.5 4.5 7 4.5s3.5-4.5 7-4.5 3.5 4.5 7 4.5 3.5-4.5 7-4.5 3.5 3.5 8 3.5v-6a5 5 0 0 0-5-5H19a5 5 0 0 0-5 5z" fill="#fde6ee"/><rect x="30.5" y="11" width="3" height="10" rx="1.5" fill="#f5d08a"/><path d="M32 4c3 3 3 6 0 7.5-3-1.5-3-4.5 0-7.5z" fill="#ffb347"/></svg>
  </div>`);

  if (f) {
    const m = f.month;
    const today = f.today.closing;
    const pending = f.vendor_pending;
    parts.push(`
    <div class="grid g4 mb">
      <div class="card stat hero">
        <div class="label">Sales this month</div>
        <div class="value">${money(m.sales.total, { dec: false })}</div>
        <div class="foot">${delta(m.sales.total, m.prev.sales.total)} vs same days last month</div>
        <div class="ico">${icon('trend')}</div>
      </div>
      <div class="card stat">
        <div class="label">Expenses this month</div>
        <div class="value">${money(m.expenses.total, { dec: false })}</div>
        <div class="foot">${delta(m.expenses.total, m.prev.expenses.total, { invert: true })} ${num(m.expenses.count)} transactions</div>
        <div class="ico tone-amber">${icon('receipt')}</div>
      </div>
      <div class="card stat">
        <div class="label">Net (sales − expenses)</div>
        <div class="value ${m.net < 0 ? 'neg' : ''}">${money(m.net, { dec: false })}</div>
        <div class="foot">${delta(m.net, m.prev.net)} ${m.sales.days} days closed</div>
        <div class="ico tone-green">${icon('wallet')}</div>
      </div>
      <a class="card stat" href="#/vendors" style="color:inherit;text-decoration:none">
        <div class="label">Vendor pending</div>
        <div class="value ${pending.total > 0 ? 'neg' : ''}">${money(pending.total, { dec: false })}</div>
        <div class="foot">${pending.count} vendor${pending.count === 1 ? '' : 's'} to pay${f.overdue_bills.length ? ` · <span class="badge red">${f.overdue_bills.length} overdue</span>` : ''}</div>
        <div class="ico tone-red">${icon('truck')}</div>
      </a>
    </div>

    <div class="grid g3 mb">
      <div class="card stat">
        <div class="label">${icon('cash')} Today · Cash</div>
        <div class="value">${today ? money(today.cash_sales) : '<span class="muted" style="font-size:18px">Not closed yet</span>'}</div>
        <div class="foot">${today ? `Counted ${today.cash_counted != null ? money(today.cash_counted) : '—'} · Diff ${diffBadge(today.cash_difference)}` : `Yesterday: ${f.yesterday ? money(f.yesterday.cash_sales) : '—'}`}</div>
      </div>
      <div class="card stat">
        <div class="label">${icon('phone')} Today · Online</div>
        <div class="value">${today ? money(today.online_sales) : '<span class="muted" style="font-size:18px">Not closed yet</span>'}</div>
        <div class="foot">${today ? `Total sales ${money(today.total_sales)}` : `Yesterday: ${f.yesterday ? money(f.yesterday.online_sales) : '—'}`}</div>
      </div>
      <div class="card stat">
        <div class="label">${icon('receipt')} Today · Expenses</div>
        <div class="value">${money(f.today.expenses.total)}</div>
        <div class="foot">Cash ${money(f.today.expenses.cash)} · Online ${money(f.today.expenses.online)}</div>
      </div>
    </div>

    <div class="grid g-2-1 mb">
      <div class="card">
        <div class="card-head"><h3>Last 30 days</h3><div class="spacer"></div>
          <div class="legend-inline"><span><i style="background:${PALETTE[0]}"></i>Cash</span><span><i style="background:${PALETTE[1]}"></i>Online</span><span><i style="background:${cssVar('--text-2')}"></i>Expenses</span></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="ch-30"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Where money went</h3><div class="spacer"></div><span class="muted small">${esc(fmtMonth(d.month))}</span></div>
        <div class="card-body">${f.expense_categories.length ? '<div class="chart-box sm"><canvas id="ch-cat"></canvas></div>' : empty('No expenses yet', '', 'receipt')}</div>
      </div>
    </div>

    <div class="grid g2 mb">
      <div class="card">
        <div class="card-head"><h3>Vendors to pay</h3><div class="spacer"></div><a href="#/vendors" class="small">All vendors →</a></div>
        ${pending.top.length ? `<ul class="list">${pending.top.map(v => `
          <li><a href="#/vendors/${v.id}" style="display:contents;color:inherit">${iconBox('truck', 'tone-amber')}
            <div class="grow"><b>${esc(v.name)}</b><small>${esc(v.phone || '')}</small></div>
            <b class="num neg">${money(v.pending)}</b></a></li>`).join('')}</ul>` : empty('All vendors are paid up', '', 'check')}
        ${f.overdue_bills.length ? `<div class="card-foot" style="flex-direction:column;align-items:stretch;gap:6px">
          <b class="small" style="color:var(--danger)">${icon('alert')} Overdue bills</b>
          ${f.overdue_bills.map(b => `<a href="#/vendors/${b.vendor_id}" class="row between small" style="color:inherit"><span>${esc(b.vendor_name)} ${b.bill_no ? '· #' + esc(b.bill_no) : ''} <span class="muted">due ${esc(fmtDay(b.due_date))}</span></span><b class="neg">${money(b.balance)}</b></a>`).join('')}
        </div>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Recent expenses</h3><div class="spacer"></div>
          ${f.pending_expenses && f.pending_expenses.count ? `<a href="#/expenses" class="badge amber" title="Bills recorded but not paid yet">${f.pending_expenses.count} unpaid · ${money(f.pending_expenses.total, { dec: false })}</a>` : ''}
          <a href="#/expenses" class="small">All expenses →</a></div>
        ${f.recent_expenses.length ? `<ul class="list">${f.recent_expenses.map(e => `
          <li>${iconBox('receipt', 'tone-rose')}<div class="grow"><b>${esc(e.category)}${e.vendor_name ? ' · ' + esc(e.vendor_name) : ''}</b><small>${esc(relDay(e.date))} · ${esc(e.description || e.payment_mode)}</small></div>
          <b class="num">${money(e.amount)}</b></li>`).join('')}</ul>` : empty('No expenses recorded', '', 'receipt')}
      </div>
    </div>`);
  }

  // Operational section (all roles that have it)
  const ops = [];
  if (d.production) {
    const p = d.production.today;
    const totals = p.reduce((t, r) => ({ made: t.made + r.made, sold: t.sold + r.sold, wasted: t.wasted + r.wasted }), { made: 0, sold: 0, wasted: 0 });
    ops.push(`
    <div class="card">
      <div class="card-head"><h3>Today's production</h3><div class="spacer"></div><a href="#/production" class="small">Open →</a></div>
      ${p.length ? `
      <div class="card-body" style="padding-bottom:6px"><div class="money-grid">
        <div class="money"><small>Made</small><b>${num(totals.made)}</b></div>
        <div class="money"><small>Sold</small><b class="pos">${num(totals.sold)}</b></div>
        <div class="money"><small>Wasted</small><b class="neg">${num(totals.wasted)}</b></div>
      </div></div>
      <ul class="list">${p.slice(0, 7).map(r => `<li><div class="grow"><b>${esc(r.item_name)}</b>
        <div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, pct(r.sold, r.made))}%"></i></div></div>
        <span class="small muted nowrap">${num(r.sold)} / ${num(r.made)} ${esc(r.unit)}</span>${r.pending ? '<span class="badge amber">count pending</span>' : ''}</li>`).join('')}</ul>`
      : empty('Nothing logged today', can('production.log') ? 'Log what you made so it is on record.' : '', 'chef',
        can('production.log') ? '<a class="btn btn-primary btn-sm" href="#/production">Log production</a>' : '')}
    </div>`);
  }
  if (d.orders) {
    const o = d.orders;
    ops.push(`
    <div class="card">
      <div class="card-head"><h3>Upcoming cake orders</h3><div class="spacer"></div>
        ${o.overdue ? `<span class="badge red">${o.overdue} overdue</span>` : ''}${o.due_today ? `<span class="badge amber">${o.due_today} due today</span>` : ''}
        <a href="#/orders" class="small">Open →</a></div>
      ${o.upcoming.length ? `<ul class="list">${o.upcoming.map(x => `<li>${iconBox('cake', 'tone-rose')}
        <div class="grow"><b>${esc(x.customer_name)} · ${esc(x.item_desc)}${x.weight ? ' (' + esc(x.weight) + ')' : ''}</b><small>${esc(relDay(x.delivery_date))}${x.delivery_time ? ' · ' + esc(x.delivery_time) : ''} · ${esc(x.order_no)}</small></div>
        ${statusBadge(x.status, ORDER_STATUS)}</li>`).join('')}</ul>` : empty('No orders in the next 7 days', '', 'cake')}
    </div>`);
  }
  if (d.stock) {
    ops.push(`
    <div class="card">
      <div class="card-head"><h3>Low stock</h3><div class="spacer"></div>${d.stock.counts.low ? `<span class="badge red">${d.stock.counts.low} items</span>` : ''}<a href="#/items?low=1" class="small">Open →</a></div>
      ${d.stock.low.length ? `<ul class="list">${d.stock.low.map(i => `<li>${iconBox('box', 'tone-red')}<div class="grow"><b>${esc(i.name)}</b>
        <small>Reorder at ${num(i.reorder_level)} ${esc(i.unit)}</small></div><b class="num neg">${num(i.stock_qty)} ${esc(i.unit)}</b></li>`).join('')}</ul>`
      : empty('Stock levels look healthy', '', 'check')}
    </div>`);
  }
  if (ops.length) parts.push(`<div class="grid ${ops.length >= 3 ? 'g3' : ops.length === 2 ? 'g2' : ''}">${ops.join('')}</div>`);

  el.innerHTML = parts.join('');

  if (f) {
    const s = f.series;
    makeChart(el.querySelector('#ch-30'), {
      data: {
        labels: s.map(x => fmtDay(x.date)),
        datasets: [
          { type: 'bar', label: 'Cash', data: s.map(x => x.cash), backgroundColor: PALETTE[0], borderRadius: 4, stack: 's', maxBarThickness: 18 },
          { type: 'bar', label: 'Online', data: s.map(x => x.online), backgroundColor: PALETTE[1], borderRadius: 4, stack: 's', maxBarThickness: 18 },
          { type: 'line', label: 'Expenses', data: s.map(x => x.expenses), borderColor: cssVar('--text-2'), backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: .35, borderDash: [5, 4] },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { stacked: true, ticks: { callback: moneyTick }, grid: { color: cssVar('--border') } } },
      },
    });
    if (f.expense_categories.length) {
      makeChart(el.querySelector('#ch-cat'), {
        type: 'doughnut',
        data: { labels: f.expense_categories.map(c => c.category), datasets: [{ data: f.expense_categories.map(c => c.total), backgroundColor: PALETTE, borderWidth: 2, borderColor: cssVar('--surface') }] },
        options: {
          maintainAspectRatio: false, cutout: '64%',
          plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)}` } } },
        },
      });
    }
  }
}

const iconBox = (name, tone) => `<span class="avatar sm ${tone}">${icon(name)}</span>`;

function diffBadge(v) {
  if (v == null) return '—';
  if (Math.abs(v) < 0.01) return '<span class="badge green">Matched</span>';
  return `<span class="badge ${v < 0 ? 'red' : 'amber'}">${v > 0 ? '+' : ''}${moneyShort(v)}</span>`;
}

function roleLine(d) {
  const r = state.user.role;
  if (d.closing_status && !d.closing_status.today_closed && new Date().getHours() >= 17) return "Don't forget today's closing — cash, online and expenses.";
  if (r === 'cook' || r === 'kitchen_staff') return "Log what you bake today, and update how much sold at the end of the day.";
  if (r === 'customer_service') return 'Take cake orders and keep customers happy.';
  if (r === 'cashier') return 'Record expenses as they happen and close the day at night.';
  return "Here's how the shop is doing.";
}

function quickActions(d) {
  const a = [];
  if (can('attendance.self')) a.push(`<a class="btn btn-sm" href="#/attendance">${icon('calendar')} My attendance</a>`);
  if (can('production.log')) a.push(`<a class="btn btn-primary btn-sm" href="#/production">${icon('chef')} Log production</a>`);
  if (can('closing.create', 'closing.manage')) a.push(`<a class="btn ${d.closing_status && !d.closing_status.today_closed ? 'btn-primary' : ''} btn-sm" href="#/closing">${icon('cash')} ${d.closing_status && d.closing_status.today_closed ? 'Review today\'s closing' : 'Close today'}</a>`);
  if (can('expenses.create')) a.push(`<a class="btn btn-sm" href="#/expenses?new=1">${icon('receipt')} Add expense</a>`);
  if (can('orders.manage')) a.push(`<a class="btn btn-sm" href="#/orders?new=1">${icon('cake')} New order</a>`);
  if (can('reports.view')) a.push(`<a class="btn btn-sm btn-ghost" href="#/reports">${icon('chart')} Monthly history</a>`);
  return a.join('');
}
