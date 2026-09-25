import { api, can, qs } from '../state.js';
import { esc, icon, money, relDay, fmtDay, todayStr, toast, formModal, confirmDialog, empty, statusBadge, debounce } from '../ui.js';

export const ORDER_STATUS = {
  pending: ['Pending', 'amber'], in_kitchen: ['In kitchen', 'blue'], ready: ['Ready', 'rose'],
  delivered: ['Delivered', 'green'], cancelled: ['Cancelled', ''],
};
const NEXT = { pending: 'in_kitchen', in_kitchen: 'ready', ready: 'delivered' };

export default async function orders(el, { query }) {
  let view = 'board';
  const f = { q: '', status: '', from: '', to: '' };
  const manage = can('orders.manage');
  const showMoney = manage || can('dashboard.financials');

  async function load() {
    const params = view === 'board' ? { view: 'active' } : { ...f };
    const [{ orders: rows }, overdue] = await Promise.all([
      api('/orders' + qs(view === 'board' ? { from: addDaysSafe(-30) } : params)),
      api('/orders' + qs({ view: 'overdue' })),
    ]);
    render(view === 'board' ? rows.filter(o => !['delivered', 'cancelled'].includes(o.status)) : rows, overdue.orders);
  }

  function card(o) {
    const late = o.delivery_date < todayStr();
    return `<div class="ocard">
      <div class="row between"><span class="when ${late ? 'late' : ''}">${icon('calendar')} ${esc(relDay(o.delivery_date))}${o.delivery_time ? ' · ' + esc(o.delivery_time) : ''}</span><span class="small muted">${esc(o.order_no)}</span></div>
      <p><b>${esc(o.item_desc)}</b>${o.weight ? ` <span class="badge">${esc(o.weight)}</span>` : ''}${o.flavour ? ` <span class="small muted">· ${esc(o.flavour)}</span>` : ''}</p>
      ${o.message ? `<p class="small" style="font-style:italic">“${esc(o.message)}”</p>` : ''}
      <div class="small muted">${icon('user')} ${esc(o.customer_name)}${o.phone ? ` · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : ''}</div>
      ${showMoney && o.total_amount ? `<div class="small" style="margin-top:4px">${money(o.total_amount)} · advance ${money(o.advance_paid)} · <b>due ${money(o.total_amount - o.advance_paid)}</b></div>` : ''}
      ${o.notes ? `<div class="small muted" style="margin-top:4px">${esc(o.notes)}</div>` : ''}
      <div class="row" style="margin-top:10px;gap:6px">
        ${NEXT[o.status] && can('orders.status', 'orders.manage') ? `<button class="btn btn-sm btn-primary" data-next="${o.id}">${esc(ORDER_STATUS[NEXT[o.status]][0])} ${icon('chevRight')}</button>` : ''}
        ${manage ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${o.id}" title="Edit">${icon('edit')}</button>` : ''}
      </div></div>`;
  }

  function render(rows, overdue) {
    el.innerHTML = `
    <div class="toolbar">
      <div class="tabs"><button data-view="board" class="${view === 'board' ? 'active' : ''}">Board</button><button data-view="list" class="${view === 'list' ? 'active' : ''}">All orders</button></div>
      ${view === 'list' ? `
        <div class="search">${icon('search')}<input class="input" data-q placeholder="Customer, phone, order no…" value="${esc(f.q)}"></div>
        <select class="select" data-status><option value="">Any status</option>${Object.entries(ORDER_STATUS).map(([k, [l]]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="input" type="date" data-from value="${f.from}" title="Delivery from" style="min-width:0;width:160px">
        <input class="input" type="date" data-to value="${f.to}" title="Delivery to" style="min-width:0;width:160px">` : ''}
      <div class="spacer"></div>
      ${overdue.length ? `<span class="badge red">${overdue.length} overdue</span>` : ''}
      ${manage ? `<button class="btn btn-primary" data-add>${icon('plus')} New order</button>` : ''}
    </div>
    ${view === 'board' ? `<div class="kanban">${['pending', 'in_kitchen', 'ready'].map(s => {
        const list = rows.filter(o => o.status === s).sort((a, b) => (a.delivery_date + (a.delivery_time || '')).localeCompare(b.delivery_date + (b.delivery_time || '')));
        return `<div class="lane"><h4>${statusBadge(s, ORDER_STATUS)} <span class="muted">${list.length}</span></h4>${list.map(card).join('') || '<div class="small muted" style="padding:8px">Nothing here</div>'}</div>`;
      }).join('')}
      <div class="lane"><h4>${icon('calendar')} Due today</h4>${rows.filter(o => o.delivery_date === todayStr()).map(o => `<div class="ocard"><b>${esc(o.customer_name)}</b><div class="small">${esc(o.item_desc)}${o.delivery_time ? ' · ' + esc(o.delivery_time) : ''}</div><div style="margin-top:6px">${statusBadge(o.status, ORDER_STATUS)}</div></div>`).join('') || '<div class="small muted" style="padding:8px">No deliveries today</div>'}</div>
    </div>`
    : `<div class="card">${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Delivery</th><th>Customer</th><th>Cake / item</th>${showMoney ? '<th class="right">Total</th><th class="right">Balance</th>' : ''}<th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(o => `<tr><td class="small strong">${esc(o.order_no)}</td><td class="nowrap">${esc(fmtDay(o.delivery_date))}${o.delivery_time ? `<div class="small muted">${esc(o.delivery_time)}</div>` : ''}</td>
        <td>${esc(o.customer_name)}<div class="small muted">${esc(o.phone || '')}</div></td><td>${esc(o.item_desc)}${o.weight ? ` <span class="badge">${esc(o.weight)}</span>` : ''}</td>
        ${showMoney ? `<td class="right num">${money(o.total_amount)}</td><td class="right num strong">${money(o.total_amount - o.advance_paid)}</td>` : ''}
        <td>${statusBadge(o.status, ORDER_STATUS)}</td>
        <td><div class="actions">${manage ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${o.id}">${icon('edit')}</button><button class="btn btn-sm btn-ghost btn-icon" data-del="${o.id}">${icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`
      : empty('No orders found', '', 'cake')}</div>`}`;

    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; load(); });
    const bind = (sel, key, ev = 'onchange') => { const i = el.querySelector(sel); if (i) i[ev] = e => { f[key] = e.target.value; load(); }; };
    bind('[data-status]', 'status'); bind('[data-from]', 'from'); bind('[data-to]', 'to');
    const q = el.querySelector('[data-q]');
    if (q) q.oninput = debounce(e => { f.q = e.target.value; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = () => edit();
    const all = [...rows, ...overdue];
    const byId = id => all.find(o => o.id === Number(id));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(byId(b.dataset.edit)));
    el.querySelectorAll('[data-next]').forEach(b => b.onclick = async () => {
      const o = byId(b.dataset.next);
      try { await api(`/orders/${o.id}/status`, { method: 'PATCH', body: { status: NEXT[o.status] } }); toast(`${o.order_no} → ${ORDER_STATUS[NEXT[o.status]][0]}`); load(); } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const o = byId(b.dataset.del);
      if (!(await confirmDialog(`Delete order ${o.order_no} for ${o.customer_name}?`))) return;
      try { await api(`/orders/${o.id}`, { method: 'DELETE' }); toast('Order deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function edit(o) {
    const r = await formModal({
      title: o ? `Edit ${o.order_no}` : 'New cake order', size: 'wide',
      fields: [
        { name: 'customer_name', label: 'Customer name', value: o?.customer_name, required: true },
        { name: 'phone', label: 'Phone', type: 'tel', value: o?.phone || '' },
        { name: 'item_desc', label: 'Cake / item', value: o?.item_desc, required: true, placeholder: 'e.g. Chocolate truffle, 2-tier' },
        { name: 'weight', label: 'Weight / size', value: o?.weight || '', placeholder: 'e.g. 1 kg' },
        { name: 'flavour', label: 'Flavour', value: o?.flavour || '' },
        { name: 'message', label: 'Message on cake', value: o?.message || '' },
        { name: 'delivery_date', label: 'Delivery date', type: 'date', value: o?.delivery_date || todayStr(), required: true },
        { name: 'delivery_time', label: 'Delivery time', type: 'time', value: o?.delivery_time || '' },
        { name: 'total_amount', label: 'Total amount', type: 'money', value: o?.total_amount ?? '' },
        { name: 'advance_paid', label: 'Advance paid', type: 'money', value: o?.advance_paid ?? '' },
        { name: 'status', label: 'Status', type: 'select', options: Object.entries(ORDER_STATUS).map(([k, [l]]) => [k, l]), value: o?.status || 'pending' },
        { name: 'notes', label: 'Notes', type: 'textarea', value: o?.notes || '', full: true, placeholder: 'Design, decorations, delivery address…' },
      ],
      onSubmit: body => api(o ? `/orders/${o.id}` : '/orders', { method: o ? 'PUT' : 'POST', body }),
    });
    if (r) { toast(o ? 'Order updated' : `Order ${r.order_no} created`); load(); }
  }

  await load();
  if (query.new && manage) { history.replaceState(null, '', '#/orders'); edit(); }
}

function addDaysSafe(n) { const d = new Date(todayStr() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
