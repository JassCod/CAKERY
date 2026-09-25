import { api, can, qs } from '../state.js';
import { esc, icon, money, fmtDate, fmtDay, todayStr, toast, formModal, confirmDialog, empty, avatar, MODE_LABEL, downloadCSV, debounce } from '../ui.js';
import { uploadModal, docCard, bindDocCards } from './documents.js';

const BILL_STATUS = { paid: ['Paid', 'green'], partial: ['Partly paid', 'amber'], unpaid: ['Unpaid', 'red'] };

export default async function vendors(el, ctx) {
  if (ctx.params[0]) return vendorDetail(el, Number(ctx.params[0]), ctx);
  let q = '';
  let showInactive = false;

  async function load() {
    const { vendors: rows, total_pending } = await api('/vendors' + qs({ include_inactive: showInactive ? 1 : '' }));
    const list = rows.filter(v => !q || [v.name, v.contact_person, v.phone, v.category].join(' ').toLowerCase().includes(q.toLowerCase()));
    const withDue = rows.filter(v => v.pending > 0.009).length;
    el.innerHTML = `
    <div class="grid g3 mb">
      <div class="card stat hero"><div class="label">Total pending to vendors</div><div class="value">${money(total_pending, { dec: false })}</div><div class="foot">${withDue} vendor${withDue === 1 ? '' : 's'} with dues</div><div class="ico">${icon('wallet')}</div></div>
      <div class="card stat"><div class="label">Vendors</div><div class="value">${rows.filter(v => v.active).length}</div><div class="foot">active suppliers</div><div class="ico tone-amber">${icon('truck')}</div></div>
      <div class="card stat"><div class="label">Documents stored</div><div class="value">${rows.reduce((s, v) => s + v.doc_count, 0)}</div><div class="foot"><a href="#/documents">Browse invoices →</a></div><div class="ico tone-blue">${icon('folder')}</div></div>
    </div>
    <div class="toolbar">
      <div class="search">${icon('search')}<input class="input" data-q placeholder="Search vendors…" value="${esc(q)}"></div>
      <label class="check small"><input type="checkbox" data-inactive ${showInactive ? 'checked' : ''}> Show archived</label>
      <div class="spacer"></div>
      <button class="btn" data-csv>${icon('download')} CSV</button>
      ${can('vendors.manage') ? `<button class="btn btn-primary" data-add>${icon('plus')} Add vendor</button>` : ''}
    </div>
    ${list.length ? `<div class="grid g3">${list.map(v => `
      <a class="card vendor-card" href="#/vendors/${v.id}" style="color:inherit;text-decoration:none;${v.active ? '' : 'opacity:.6'}">
        <div class="top">${avatar(v.name)}<div style="min-width:0;flex:1"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.name)}</b>
          <small class="muted">${esc(v.category || 'Supplier')}${v.phone ? ' · ' + esc(v.phone) : ''}</small></div>${v.active ? '' : '<span class="badge">Archived</span>'}</div>
        <div class="row between" style="align-items:flex-end">
          <div><small class="muted">Pending</small><div class="pending ${v.pending > 0.009 ? 'neg' : 'pos'}">${money(v.pending)}</div></div>
          <div class="right small muted">Billed ${money(v.total_billed, { dec: false })}<br>Paid ${money(v.total_paid, { dec: false })}</div>
        </div>
        <div class="row small muted" style="gap:14px">${icon('file')} ${v.doc_count} docs <span>${v.last_bill_date ? 'Last bill ' + esc(fmtDate(v.last_bill_date)) : 'No bills yet'}</span></div>
      </a>`).join('')}</div>`
    : `<div class="card">${empty('No vendors yet', 'Add the suppliers you buy flour, dairy, packaging etc. from.', 'truck')}</div>`}`;

    el.querySelector('[data-q]').oninput = debounce(e => { q = e.target.value; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 200);
    el.querySelector('[data-inactive]').onchange = e => { showInactive = e.target.checked; load(); };
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = async () => { const r = await vendorForm(); if (r) { toast('Vendor added'); ctx.navigate(`#/vendors/${r.id}`); } };
    el.querySelector('[data-csv]').onclick = () => downloadCSV('vendors.csv', [
      ['Name', 'Category', 'Contact', 'Phone', 'Email', 'GSTIN', 'Opening balance', 'Total billed', 'Total paid', 'Pending'],
      ...rows.map(v => [v.name, v.category || '', v.contact_person || '', v.phone || '', v.email || '', v.gstin || '', v.opening_balance, v.total_billed, v.total_paid, v.pending]),
    ]);
  }
  await load();
}

export function vendorForm(v) {
  return formModal({
    title: v ? `Edit ${v.name}` : 'Add vendor',
    fields: [
      { name: 'name', label: 'Vendor / business name', value: v?.name, required: true, full: true },
      { name: 'category', label: 'Supplies', type: 'datalist', options: ['Dairy', 'Flour & Grains', 'Packaging', 'Chocolate & Cocoa', 'Fruits', 'Gas', 'Equipment', 'Services'], value: v?.category || '' },
      { name: 'contact_person', label: 'Contact person', value: v?.contact_person || '' },
      { name: 'phone', label: 'Phone', type: 'tel', value: v?.phone || '' },
      { name: 'email', label: 'Email', type: 'email', value: v?.email || '' },
      { name: 'gstin', label: 'GSTIN / Tax ID', value: v?.gstin || '' },
      { name: 'opening_balance', label: 'Opening balance (already owed)', type: 'money', value: v?.opening_balance ?? 0, min: -1e9, hint: 'Amount you owed before using this system' },
      { name: 'address', label: 'Address', type: 'textarea', value: v?.address || '', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', value: v?.notes || '', full: true },
      ...(v ? [{ name: 'active', label: 'Active', type: 'checkbox', value: !!v.active, full: true }] : []),
    ],
    onSubmit: body => api(v ? `/vendors/${v.id}` : '/vendors', { method: v ? 'PUT' : 'POST', body }),
  });
}

async function vendorDetail(el, id, ctx) {
  let tab = ctx.query.tab || (can('vendors.view') ? 'ledger' : 'documents');

  async function load() {
    const d = await api(`/vendors/${id}`);
    ctx.setTitle(d.vendor.name);
    render(d);
  }

  function render({ vendor: v, bills, payments, documents, ledger }) {
    const money_ = can('vendors.view');
    const tabs = [
      ...(money_ ? [['ledger', 'Ledger'], ['bills', `Bills (${bills.length})`], ['payments', `Payments (${payments.length})`]] : []),
      ...(can('documents.view') ? [['documents', `Documents (${documents.length})`]] : []),
    ];
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0] ? tabs[0][0] : 'ledger';
    el.innerHTML = `
    <div class="toolbar"><a class="btn btn-ghost" href="#/vendors">${icon('chevLeft')} All vendors</a><div class="spacer"></div>
      ${can('vendors.bills') ? `<button class="btn" data-bill>${icon('file')} Add bill</button>` : ''}
      ${can('documents.upload') ? `<button class="btn" data-upload>${icon('upload')} Upload invoice</button>` : ''}
      ${can('vendors.payments') ? `<button class="btn btn-primary" data-pay>${icon('cash')} Record payment</button>` : ''}
    </div>
    <div class="grid g-1-2 mb">
      <div class="card card-pad">
        <div class="row" style="gap:14px;flex-wrap:nowrap">${avatar(v.name)}<div style="min-width:0"><h2 style="font-size:20px">${esc(v.name)}</h2><div class="muted small">${esc(v.category || 'Supplier')}</div></div>
          ${can('vendors.manage') ? `<div style="margin-left:auto" class="row"><button class="btn btn-sm btn-ghost btn-icon" data-edit title="Edit">${icon('edit')}</button><button class="btn btn-sm btn-ghost btn-icon" data-del title="Delete">${icon('trash')}</button></div>` : ''}</div>
        ${money_ ? `<div class="mt small" style="display:grid;gap:6px">
          ${v.contact_person ? `<div>${icon('user')} ${esc(v.contact_person)}</div>` : ''}
          ${v.phone ? `<div>${icon('phone')} <a href="tel:${esc(v.phone)}">${esc(v.phone)}</a></div>` : ''}
          ${v.email ? `<div>✉ <a href="mailto:${esc(v.email)}">${esc(v.email)}</a></div>` : ''}
          ${v.gstin ? `<div class="muted">GSTIN ${esc(v.gstin)}</div>` : ''}
          ${v.address ? `<div class="muted">${esc(v.address)}</div>` : ''}
          ${v.notes ? `<div class="muted">${esc(v.notes)}</div>` : ''}
        </div>` : ''}
      </div>
      ${money_ ? `<div class="grid g3">
        <div class="card stat ${v.pending > 0.009 ? 'hero' : ''}"><div class="label">Pending amount</div><div class="value">${money(v.pending)}</div><div class="foot">${v.pending > 0.009 ? 'to be paid' : 'All clear'}</div></div>
        <div class="card stat"><div class="label">Total billed</div><div class="value">${money(v.total_billed, { dec: false })}</div><div class="foot">${bills.length} bills${v.opening_balance ? ` + opening ${money(v.opening_balance)}` : ''}</div></div>
        <div class="card stat"><div class="label">Total paid</div><div class="value">${money(v.total_paid, { dec: false })}</div><div class="foot">${payments.length} payments</div></div>
      </div>` : ''}
    </div>
    <div class="toolbar"><div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${esc(l)}</button>`).join('')}</div></div>
    <div class="card" data-panel></div>`;

    const panel = el.querySelector('[data-panel]');
    if (tab === 'ledger') {
      panel.innerHTML = ledger.length > 1 ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Entry</th><th>Details</th><th class="right">Bill (+)</th><th class="right">Paid (−)</th><th class="right">Balance</th></tr></thead>
        <tbody>${ledger.map(l => `<tr><td class="nowrap">${l.date ? esc(fmtDay(l.date)) : ''}</td>
          <td>${l.type === 'bill' ? '<span class="badge red">Bill</span>' : l.type === 'payment' ? '<span class="badge green">Payment</span>' : '<span class="badge">Opening</span>'} ${l.ref ? `<span class="small muted">#${esc(l.ref)}</span>` : ''}</td>
          <td class="small muted">${esc(l.description || '')}</td>
          <td class="right num">${l.debit ? money(l.debit) : ''}</td><td class="right num pos">${l.credit ? money(l.credit) : ''}</td>
          <td class="right num strong">${money(l.balance)}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No transactions yet', 'Add a bill when you buy on credit, and record payments when you pay.', 'receipt');
    } else if (tab === 'bills') {
      panel.innerHTML = bills.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Bill date</th><th>Bill no.</th><th>Description</th><th>Due</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>${bills.map(b => `<tr><td class="nowrap">${esc(fmtDay(b.bill_date))}</td><td class="strong">${esc(b.bill_no || '—')}</td><td class="small muted">${esc(b.description || '')}${b.doc_count ? ` <span class="badge blue">${icon('file')} ${b.doc_count}</span>` : ''}</td>
          <td class="nowrap small ${b.overdue ? 'neg' : ''}">${b.due_date ? esc(fmtDay(b.due_date)) + (b.overdue ? ' · overdue' : '') : '—'}</td>
          <td class="right num">${money(b.amount)}</td><td class="right num">${money(b.paid)}</td><td class="right num strong">${money(b.balance)}</td>
          <td><span class="badge dot ${BILL_STATUS[b.status][1]}">${BILL_STATUS[b.status][0]}</span></td>
          <td><div class="actions">${b.balance > 0 && can('vendors.payments') ? `<button class="btn btn-sm" data-paybill="${b.id}">Pay</button>` : ''}
            ${can('vendors.bills') ? `<button class="btn btn-sm btn-ghost btn-icon" data-editbill="${b.id}">${icon('edit')}</button>` : ''}
            ${can('vendors.manage') ? `<button class="btn btn-sm btn-ghost btn-icon" data-delbill="${b.id}">${icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`
        : empty('No bills', 'Record supplier bills here so pending amounts stay accurate.', 'file');
    } else if (tab === 'payments') {
      panel.innerHTML = payments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Mode</th><th>Against bill</th><th>Reference / note</th><th class="right">Amount</th><th>By</th><th></th></tr></thead>
        <tbody>${payments.map(p => `<tr><td class="nowrap">${esc(fmtDay(p.date))}</td><td>${esc(MODE_LABEL[p.payment_mode] || p.payment_mode)}</td><td>${p.bill_no ? '#' + esc(p.bill_no) : '<span class="muted">On account</span>'}</td>
          <td class="small muted">${esc([p.reference, p.note].filter(Boolean).join(' · '))}</td><td class="right num strong pos">${money(p.amount)}</td><td class="small">${esc(p.created_by_name || '')}</td>
          <td><div class="actions">${can('vendors.manage') ? `<button class="btn btn-sm btn-ghost btn-icon" data-delpay="${p.id}">${icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>
          <div class="card-foot small muted">${icon('receipt')} Every payment is also recorded in Expenses automatically (category “Vendor Payment”).</div>`
        : empty('No payments yet', '', 'cash');
    } else {
      panel.innerHTML = documents.length ? `<div class="doc-grid" style="padding-top:18px">${documents.map(d => docCard(d, v.id)).join('')}</div>`
        : empty('No documents stored', `Upload invoices and receipts — they are kept in ${v.name}'s folder.`, 'folder', can('documents.upload') ? `<button class="btn btn-primary" data-upload2>${icon('upload')} Upload</button>` : '');
      bindDocCards(panel, load);
    }

    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/vendors/${id}?tab=${tab}`); render({ vendor: v, bills, payments, documents, ledger }); });
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(b => b.onclick = () => fn(b));
    on('[data-edit]', async () => { if (await vendorForm(v)) { toast('Vendor updated'); load(); } });
    on('[data-del]', async () => {
      if (!(await confirmDialog(`Delete ${v.name}? Vendors with history are archived instead.`))) return;
      try { const r = await api(`/vendors/${v.id}`, { method: 'DELETE' }); toast(r.archived ? 'Vendor archived' : 'Vendor deleted'); ctx.navigate('#/vendors'); } catch (e) { toast(e.message, 'error'); }
    });
    on('[data-bill]', () => billForm(v));
    on('[data-editbill]', b => billForm(v, bills.find(x => x.id === Number(b.dataset.editbill))));
    on('[data-delbill]', async b => {
      const bill = bills.find(x => x.id === Number(b.dataset.delbill));
      if (!(await confirmDialog(`Delete bill ${bill.bill_no ? '#' + bill.bill_no : ''} of ${money(bill.amount)}?`))) return;
      try { await api(`/vendors/${v.id}/bills/${bill.id}`, { method: 'DELETE' }); toast('Bill deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
    on('[data-pay]', () => payForm(v, bills));
    on('[data-paybill]', b => payForm(v, bills, bills.find(x => x.id === Number(b.dataset.paybill))));
    on('[data-delpay]', async b => {
      const p = payments.find(x => x.id === Number(b.dataset.delpay));
      if (!(await confirmDialog(`Delete payment of ${money(p.amount)} on ${fmtDay(p.date)}? The linked expense will also be removed.`))) return;
      try { await api(`/vendors/${v.id}/payments/${p.id}`, { method: 'DELETE' }); toast('Payment deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
    on('[data-upload], [data-upload2]', async () => { if (await uploadModal(v, bills)) { tab = 'documents'; load(); } });
  }

  async function billForm(v, b) {
    const r = await formModal({
      title: b ? 'Edit bill' : `New bill · ${v.name}`,
      fields: [
        { name: 'bill_no', label: 'Bill / invoice no.', value: b?.bill_no || '' },
        { name: 'amount', label: 'Bill amount', type: 'money', value: b?.amount ?? '', required: true },
        { name: 'bill_date', label: 'Bill date', type: 'date', value: b?.bill_date || todayStr(), required: true },
        { name: 'due_date', label: 'Payment due date', type: 'date', value: b?.due_date || '' },
        { name: 'description', label: 'What was bought', type: 'textarea', value: b?.description || '', full: true, placeholder: 'e.g. 50kg maida, 20kg sugar' },
      ],
      onSubmit: body => api(b ? `/vendors/${v.id}/bills/${b.id}` : `/vendors/${v.id}/bills`, { method: b ? 'PUT' : 'POST', body }),
    });
    if (r) {
      toast(b ? 'Bill updated' : 'Bill added — pending amount updated');
      if (!b && can('documents.upload') && (await confirmDialog('Upload the invoice copy for this bill now?', { title: 'Attach invoice', okText: 'Upload', danger: false }))) {
        await uploadModal(v, [{ id: r.id, bill_no: 'new bill' }], r.id);
      }
      tab = 'bills'; load();
    }
  }

  async function payForm(v, bills, bill) {
    const open = bills.filter(b => b.balance > 0);
    const r = await formModal({
      title: `Pay ${v.name}`,
      intro: `<div class="money" style="margin-bottom:14px"><small>Currently pending</small><b class="neg">${money(v.pending)}</b></div>`,
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'money', value: bill ? bill.balance : '', required: true },
        { name: 'date', label: 'Payment date', type: 'date', value: todayStr(), required: true, attrs: `max="${todayStr()}"` },
        { name: 'payment_mode', label: 'Paid by', type: 'select', options: Object.entries(MODE_LABEL), value: 'cash' },
        { name: 'bill_id', label: 'Against bill', type: 'select', placeholder: 'On account (no specific bill)', options: open.map(b => [b.id, `${b.bill_no ? '#' + b.bill_no : fmtDay(b.bill_date)} — balance ${money(b.balance)}`]), value: bill ? bill.id : '' },
        { name: 'reference', label: 'Reference (UTR / cheque no.)', value: '', full: true },
        { name: 'note', label: 'Note', value: '', full: true },
      ],
      onSubmit: body => api(`/vendors/${v.id}/payments`, { method: 'POST', body }),
    });
    if (r) { toast('Payment recorded (also added to expenses)'); tab = 'payments'; load(); }
  }

  await load();
}
