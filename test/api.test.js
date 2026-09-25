'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakery-test-'));
process.env.CAKERY_DATA_DIR = dir;
process.env.CAKERY_OWNER_PASSWORD = 'owner-pass';
const { createApp } = require('../server/index');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = { 'X-Requested-With': 'cakery', cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return {
    get: u => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b),
    patch: (u, b) => call('PATCH', u, b), del: u => call('DELETE', u),
    login: (username, password) => call('POST', '/auth/login', { username, password }),
  };
}

const owner = client();
const staff = {};

test('login rejects bad password and accepts the default owner', async () => {
  assert.equal((await owner.login('owner', 'nope')).status, 401);
  assert.equal((await owner.login('owner', 'owner-pass')).status, 200);
  const me = await owner.get('/auth/me');
  assert.equal(me.data.user.role, 'owner');
  assert.ok(me.data.permissions.includes('roles.manage'));
});

test('requests without the CSRF header are rejected', async () => {
  const res = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('owner creates staff for every role; manager cannot create a manager', async () => {
  for (const role of ['manager', 'cashier', 'cook', 'kitchen_staff', 'customer_service']) {
    const r = await owner.post('/users', { name: role, username: role, password: 'secret1', role });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    staff[role] = client();
    assert.equal((await staff[role].login(role, 'secret1')).status, 200);
  }
  const r = await staff.manager.post('/users', { name: 'x', username: 'xx2', password: 'secret1', role: 'manager' });
  assert.equal(r.status, 403);
  assert.equal((await staff.manager.post('/users', { name: 'y', username: 'yy2', password: 'secret1', role: 'cook' })).status, 201);
});

test('role permissions are enforced', async () => {
  assert.equal((await staff.cook.get('/expenses')).status, 403);
  assert.equal((await staff.cook.get('/closings')).status, 403);
  assert.equal((await staff.cook.get('/reports/monthly')).status, 403);
  assert.equal((await staff.cashier.get('/users')).status, 403);
  assert.equal((await staff.customer_service.post('/expenses', { category: 'x', amount: 5 })).status, 403);
  assert.equal((await staff.manager.get('/admin/audit')).status, 403);
  const dash = await staff.cook.get('/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.data.financials, undefined, 'cook must not see money figures');
});

test('owner can change a role\'s permissions', async () => {
  const roles = (await owner.get('/users/roles')).data.roles;
  const cook = roles.find(r => r.key === 'cook');
  assert.equal((await owner.put('/users/roles/cook', { permissions: [...cook.permissions, 'reports.view'] })).status, 200);
  assert.equal((await staff.cook.get('/reports/monthly')).status, 200);
  await owner.put('/users/roles/cook', { permissions: cook.permissions });
  assert.equal((await staff.cook.get('/reports/monthly')).status, 403);
  assert.equal((await staff.manager.put('/users/roles/cook', { permissions: [] })).status, 403);
});

let productId;
test('items, stock movements and production logging', async () => {
  const r = await owner.post('/items', { name: 'Choco Pastry', type: 'product', unit: 'pcs', sell_price: 80, cost_price: 30, stock_qty: 5 });
  assert.equal(r.status, 201);
  productId = r.data.id;
  assert.equal((await staff.cook.post('/items', { name: 'Hack' })).status, 403);
  const s = await staff.kitchen_staff.post(`/items/${productId}/stock`, { direction: 'out', qty: 2, reason: 'wastage' });
  assert.equal(s.data.balance, 3);

  const p = await staff.cook.post('/production', { item_id: productId, qty_made: 40 });
  assert.equal(p.status, 201);
  assert.equal((await staff.cook.post('/production', { item_id: productId, qty_made: 1, date: '2020-01-01' })).status, 403);
  assert.equal((await staff.customer_service.put(`/production/${p.data.id}/sales`, { qty_sold: 35, qty_wasted: 2 })).status, 200);
  const list = await staff.cook.get('/production');
  assert.equal(list.data.summary[0].sold, 35);
  assert.equal(list.data.logs[0].sell_price, undefined, 'cook does not see prices');
  // kitchen staff cannot edit the cook's entry
  assert.equal((await staff.kitchen_staff.put(`/production/${p.data.id}`, { qty_made: 1 })).status, 403);
});

let vendorId;
test('vendor bills, payments (auto-expense) and pending amount', async () => {
  const v = await owner.post('/vendors', { name: 'Sharma Flour', opening_balance: 1000 });
  vendorId = v.data.id;
  const b1 = await owner.post(`/vendors/${vendorId}/bills`, { bill_no: 'A1', amount: 5000, bill_date: '2026-01-05', due_date: '2026-01-20' });
  await owner.post(`/vendors/${vendorId}/bills`, { bill_no: 'A2', amount: 3000, bill_date: '2026-01-10' });
  assert.equal(b1.status, 201);
  const pay = await staff.cashier.post(`/vendors/${vendorId}/payments`, { amount: 2500, payment_mode: 'cash' });
  assert.equal(pay.status, 201);
  let d = (await owner.get(`/vendors/${vendorId}`)).data;
  assert.equal(d.vendor.pending, 6500);
  // on-account payment settles the opening balance first, then the oldest bill
  const a1 = d.bills.find(b => b.bill_no === 'A1');
  assert.equal(a1.paid, 1500);
  assert.equal(a1.status, 'partial');
  const exp = (await owner.get('/expenses?category=Vendor%20Payment')).data;
  assert.equal(exp.totals.total, 2500);
  // deleting the payment removes its expense too
  await owner.del(`/vendors/${vendorId}/payments/${pay.data.id}`);
  assert.equal((await owner.get('/expenses?category=Vendor%20Payment')).data.totals.total, 0);
  d = (await owner.get(`/vendors/${vendorId}`)).data;
  assert.equal(d.vendor.pending, 9000);
});

test('vendor documents are stored in the vendor folder and downloadable', async () => {
  const fd = new FormData();
  fd.append('files', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'invoice-A1.pdf');
  fd.append('doc_type', 'invoice');
  const up = await staff.cashier.post(`/vendors/${vendorId}/documents`, fd);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const docs = (await owner.get('/admin/documents')).data.documents;
  assert.equal(docs.length, 1);
  assert.match(docs[0].stored_path, /vendors[\\/]\d+-sharma-flour[\\/]/);
  const file = await owner.get(`/vendors/${vendorId}/documents/${docs[0].id}/file`);
  assert.equal(file.data, '%PDF-1.4 test');
  const bad = new FormData();
  bad.append('files', new Blob(['x']), 'evil.exe');
  assert.equal((await owner.post(`/vendors/${vendorId}/documents`, bad)).status, 400);
  assert.equal((await staff.cook.get(`/vendors/${vendorId}/documents/${docs[0].id}/file`)).status, 403);
});

test('daily closing computes expected cash and difference', async () => {
  const today = (await owner.get('/dashboard')).data.today;
  await staff.cashier.post('/expenses', { category: 'Staff Food', amount: 200, payment_mode: 'cash' });
  await staff.cashier.post('/expenses', { category: 'Electricity', amount: 1000, payment_mode: 'online' });
  const r = await staff.cashier.post('/closings', { opening_cash: 1000, cash_sales: 5000, online_sales: 7000, cash_counted: 5750 });
  assert.equal(r.status, 201);
  const day = (await owner.get(`/closings/day/${today}`)).data.closing;
  assert.equal(day.total_sales, 12000);
  assert.equal(day.expenses_total, 1200);
  assert.equal(day.expected_cash, 5800);
  assert.equal(day.cash_difference, -50);
  assert.equal(day.net, 10800);
  assert.equal((await staff.cashier.post('/closings', { date: '2020-01-01', cash_sales: 1, online_sales: 1 })).status, 403);
  const rep = (await owner.get(`/reports/monthly?month=${today.slice(0, 7)}`)).data;
  assert.equal(rep.summary.sales.total, 12000);
  const hist = (await owner.get('/reports/history?months=3')).data;
  assert.equal(hist.months.at(-1).sales, 12000);
});

test('orders: customer service creates, cook moves status but cannot cancel', async () => {
  const o = await staff.customer_service.post('/orders', { customer_name: 'Ananya', item_desc: 'Truffle 1kg', delivery_date: '2030-01-01', total_amount: 900, advance_paid: 400 });
  assert.equal(o.status, 201);
  assert.equal((await staff.cook.patch(`/orders/${o.data.id}/status`, { status: 'in_kitchen' })).status, 200);
  assert.equal((await staff.cook.patch(`/orders/${o.data.id}/status`, { status: 'cancelled' })).status, 403);
  const list = (await staff.cook.get('/orders')).data.orders;
  assert.equal(list[0].total_amount, undefined, 'cook does not see order money');
});

test('activity log records actions', async () => {
  const logs = (await owner.get('/admin/audit')).data.logs;
  assert.ok(logs.some(l => l.action === 'closing_created'));
  assert.ok(logs.some(l => l.action === 'vendor_payment_deleted'));
});
