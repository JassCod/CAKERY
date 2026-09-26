// Runs supabase/setup.sql inside an in-memory Postgres (PGlite) with a small
// stand-in for Supabase's auth + storage schemas, then exercises the app's
// database functions as different staff roles.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SUPABASE_STUB = `
create role anon; create role authenticated;
create schema extensions; create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text, banned_until timestamptz);
create table auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text not null,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
`;

let db;
const today = () => db.query('select public.app_today()::text d').then(r => r.rows[0].d);

async function as(uid) { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']); }

async function rpc(fn, args = {}) {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(sql, vals)).rows[0].r;
}
async function fails(fn, args, pattern) {
  await assert.rejects(() => rpc(fn, args), e => { assert.match(e.message, pattern); return true; });
}
// Mimics Supabase Auth's password sign-in.
async function login(username, password) {
  const r = await db.query(`select id from auth.users where email = public.staff_email($1)
    and encrypted_password = extensions.crypt($2, encrypted_password) and (banned_until is null or banned_until < now())`, [username, password]);
  if (!r.rows[0]) throw new Error('Invalid login credentials');
  await as(r.rows[0].id);
  await rpc('after_login');
  return r.rows[0].id;
}

const ids = {};

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const sql = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // must be safe to run twice
});

test('first-run setup creates the owner once', async () => {
  await as(null);
  assert.equal((await rpc('public_info')).needs_setup, true);
  await rpc('setup_owner', { p_username: 'owner', p_password: 'owner-pass', p_name: 'Shop Owner' });
  await fails('setup_owner', { p_username: 'evil', p_password: 'evil-pass', p_name: 'X' }, /already complete/);
  assert.equal((await rpc('public_info')).needs_setup, false);
  await assert.rejects(() => login('owner', 'wrong'));
  ids.owner = await login('owner', 'owner-pass');
  const me = await rpc('me');
  assert.equal(me.user.role, 'owner');
  assert.ok(me.permissions.includes('roles.manage'));
  assert.equal(me.settings.currency, '₹');
});

test('not signed in: everything is refused', async () => {
  await as(null);
  await fails('dashboard', {}, /sign in/);
  await fails('items_list', { p: {} }, /sign in/);
});

test('owner creates staff; manager cannot create a manager', async () => {
  await as(ids.owner);
  for (const role of ['manager', 'cashier', 'cook', 'kitchen_staff', 'customer_service']) {
    await as(ids.owner);
    await rpc('user_create', { p: { name: role, username: role, password: 'secret1', role } });
    ids[role] = await login(role, 'secret1');
  }
  await as(ids.manager);
  await fails('user_create', { p: { name: 'x', username: 'xx2', password: 'secret1', role: 'manager' } }, /cannot manage/);
  await rpc('user_create', { p: { name: 'y', username: 'yy2', password: 'secret1', role: 'cook' } });
  await fails('user_create', { p: { name: 'z', username: 'yy2', password: 'secret1', role: 'cook' } }, /already taken/);
  await as(ids.cook);
  const me = await rpc('me');
  assert.equal(me.user.must_change_password, true);
});

test('role permissions are enforced', async () => {
  await as(ids.cook);
  await fails('expenses_list', { p: {} }, /do not have access/);
  await fails('closings_month', {}, /do not have access/);
  await fails('report_monthly', {}, /do not have access/);
  const dash = await rpc('dashboard');
  assert.equal(dash.financials, undefined, 'cook must not see money figures');
  assert.ok(dash.production);
  await as(ids.cashier);
  await fails('users_list', {}, /do not have access/);
  await as(ids.customer_service);
  await fails('expense_save', { p_id: null, p: { category: 'x', amount: 5 } }, /do not have access/);
  await as(ids.manager);
  await fails('audit_list', { p: {} }, /do not have access/);
});

test('owner can change role permissions; manager cannot', async () => {
  await as(ids.owner);
  const roles = (await rpc('roles_list')).roles;
  const cook = roles.find(r => r.key === 'cook');
  await rpc('role_update', { p_role: 'cook', p_permissions: [...cook.permissions, 'reports.view'] });
  await as(ids.cook); await rpc('report_monthly');
  await as(ids.owner); await rpc('role_update', { p_role: 'cook', p_permissions: cook.permissions });
  await as(ids.cook); await fails('report_monthly', {}, /do not have access/);
  await as(ids.manager); await fails('role_update', { p_role: 'cook', p_permissions: [] }, /do not have access/);
});

test('staff can use an email address as their login', async () => {
  await as(ids.owner);
  await rpc('user_create', { p: { name: 'Priya', username: 'Priya.Manager@Gmail.com', password: 'secret1', role: 'manager' } });
  const uid = await login('priya.manager@gmail.com', 'secret1');
  assert.equal((await rpc('me')).user.username, 'priya.manager@gmail.com');
  assert.ok(uid);
  await as(ids.owner);
  await fails('user_create', { p: { name: 'Bad', username: 'not an email@', password: 'secret1', role: 'cook' } }, /Username/);
});

test('co-owners: full access, but cannot touch owners added before them', async () => {
  await as(ids.owner);
  const co = await rpc('user_create', { p: { name: 'Co Owner', username: 'coowner', password: 'secret1', role: 'owner' } });
  const coId = await login('coowner', 'secret1');
  assert.equal(coId, co.id);
  const me = await rpc('me');
  assert.ok(me.permissions.includes('roles.manage') && me.permissions.includes('settings.manage'));
  await rpc('backup_export');
  // co-owner can manage staff and add a newer owner…
  await rpc('user_update', { p_id: ids.cashier, p: { name: 'cashier', role: 'cashier', active: true } });
  const newer = await rpc('user_create', { p: { name: 'Newest Owner', username: 'newowner', password: 'secret1', role: 'owner' } });
  await rpc('user_update', { p_id: newer.id, p: { name: 'Newest Owner 2', role: 'owner', active: true } });
  // …but cannot edit, disable, demote or reset the original owner
  await fails('user_update', { p_id: ids.owner, p: { name: 'Hacked', role: 'owner', active: true } }, /before you/);
  await fails('user_update', { p_id: ids.owner, p: { name: 'Shop Owner', role: 'cook' } }, /before you/);
  await fails('user_update', { p_id: ids.owner, p: { name: 'Shop Owner', role: 'owner', password: 'newpass1' } }, /before you/);
  await fails('user_deactivate', { p_id: ids.owner }, /before you/);
  const users = (await rpc('users_list')).users;
  assert.equal(users.find(u => u.id === ids.owner).can_manage, false);
  assert.equal(users.find(u => u.id === newer.id).can_manage, true);
  // the original owner can manage the co-owner, including demoting them
  await as(ids.owner);
  assert.equal((await rpc('users_list')).users.find(u => u.id === co.id).can_manage, true);
  await rpc('user_update', { p_id: newer.id, p: { name: 'Newest Owner', role: 'manager', active: true } });
  assert.equal((await rpc('users_list')).users.find(u => u.id === newer.id).owner_since, null);
  // a manager still cannot create owners
  await as(ids.manager);
  await fails('user_create', { p: { name: 'x', username: 'mgrowner', password: 'secret1', role: 'owner' } }, /cannot manage/);
});

test('disabled staff cannot sign in or act', async () => {
  await as(ids.owner);
  const u = await rpc('user_create', { p: { name: 'Temp', username: 'temp1', password: 'secret1', role: 'cashier' } });
  await rpc('user_deactivate', { p_id: u.id });
  await assert.rejects(() => login('temp1', 'secret1'));
  await as(u.id);
  await fails('dashboard', {}, /sign in/);
});

test('password change checks the current password', async () => {
  await as(ids.cook);
  await fails('change_password', { p_current: 'nope', p_new: 'newpass1' }, /incorrect/);
  await rpc('change_password', { p_current: 'secret1', p_new: 'newpass1' });
  await login('cook', 'newpass1');
  assert.equal((await rpc('me')).user.must_change_password, false);
});

let productId;
test('items, stock and production', async () => {
  await as(ids.owner);
  productId = (await rpc('item_save', { p_id: null, p: { name: 'Choco Pastry', type: 'product', sell_price: 80, cost_price: 30, stock_qty: 5 } })).id;
  await as(ids.cook);
  await fails('item_save', { p_id: null, p: { name: 'Hack' } }, /do not have access/);
  const list = await rpc('items_list', { p: {} });
  assert.equal(list.items[0].cost_price, undefined, 'cook does not see cost');
  await as(ids.kitchen_staff);
  assert.equal(Number((await rpc('item_stock', { p_id: productId, p: { direction: 'out', qty: 2, reason: 'wastage' } })).balance), 3);

  await as(ids.cook);
  const p = await rpc('production_create', { p: { item_id: productId, qty_made: 40 } });
  await fails('production_create', { p: { item_id: productId, qty_made: 1, date: '2020-01-01' } }, /today or yesterday/);
  await as(ids.customer_service);
  await rpc('production_sales', { p_id: p.id, p: { qty_sold: 35, qty_wasted: 2 } });
  await as(ids.cook);
  const pl = await rpc('production_list', { p: {} });
  assert.equal(Number(pl.summary[0].sold), 35);
  assert.equal(pl.logs[0].sell_price, undefined, 'cook does not see prices');
  await as(ids.kitchen_staff);
  await fails('production_update', { p_id: p.id, p: { qty_made: 1 } }, /own recent entries/);
});

let vendorId;
test('vendor bills, payments (auto-expense) and pending amount', async () => {
  await as(ids.owner);
  vendorId = (await rpc('vendor_save', { p_id: null, p: { name: 'Sharma Flour', opening_balance: 1000 } })).id;
  await rpc('bill_save', { p_vendor: vendorId, p_bill: null, p: { bill_no: 'A1', amount: 5000, bill_date: '2026-01-05', due_date: '2026-01-20' } });
  await rpc('bill_save', { p_vendor: vendorId, p_bill: null, p: { bill_no: 'A2', amount: 3000, bill_date: '2026-01-10' } });
  await as(ids.cashier);
  const pay = await rpc('payment_create', { p_vendor: vendorId, p: { amount: 2500, payment_mode: 'cash' } });
  await as(ids.owner);
  let d = await rpc('vendor_detail', { p_id: vendorId });
  assert.equal(Number(d.vendor.pending), 6500);
  const a1 = d.bills.find(b => b.bill_no === 'A1');
  assert.equal(Number(a1.paid), 1500, 'on-account payment clears opening balance first, then oldest bill');
  assert.equal(a1.status, 'partial');
  assert.equal(d.ledger.at(-1).balance, 6500);
  const vp = await rpc('expenses_list', { p: { from: '2000-01-01', to: '2100-01-01', category: 'Vendor Payment' } });
  assert.equal(Number(vp.totals.total), 2500);
  await rpc('payment_delete', { p_vendor: vendorId, p_payment: pay.id });
  assert.equal(Number((await rpc('expenses_list', { p: { from: '2000-01-01', to: '2100-01-01', category: 'Vendor Payment' } })).totals.total), 0);
  d = await rpc('vendor_detail', { p_id: vendorId });
  assert.equal(Number(d.vendor.pending), 9000);
  const dash = await rpc('dashboard');
  assert.ok(dash.financials.overdue_bills.some(b => b.bill_no === 'A1'));
  await as(ids.cook);
  await fails('vendors_list', { p: {} }, /do not have access/);
});

test('documents: path must belong to the vendor folder', async () => {
  await as(ids.cashier);
  await fails('document_add', { p_vendor: vendorId, p: { files: [{ path: `vendors/999-x/a.pdf`, name: 'a.pdf' }] } }, /Invalid file path/);
  await rpc('document_add', { p_vendor: vendorId, p: { doc_type: 'invoice', files: [{ path: `vendors/${vendorId}-sharma-flour/2026_a.pdf`, name: 'a.pdf', mime: 'application/pdf', size: 10 }] } });
  const docs = (await rpc('documents_all', { p: {} })).documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].vendor_name, 'Sharma Flour');
  await fails('document_delete', { p_vendor: vendorId, p_doc: docs[0].id }, /do not have access/);
  await as(ids.owner);
  assert.match((await rpc('document_delete', { p_vendor: vendorId, p_doc: docs[0].id })).storage_path, /^vendors\//);
});

test('daily closing computes expected cash and difference', async () => {
  const t = await today();
  await as(ids.cashier);
  await rpc('expense_save', { p_id: null, p: { category: 'Staff Food', amount: 200, payment_mode: 'cash' } });
  await rpc('expense_save', { p_id: null, p: { category: 'Electricity', amount: 1000, payment_mode: 'online' } });
  await rpc('closing_save', { p: { opening_cash: 1000, cash_sales: 5000, online_sales: 7000, cash_counted: 5750 } });
  await fails('closing_save', { p: { date: '2020-01-01', cash_sales: 1, online_sales: 1 } }, /today or yesterday/);
  await fails('closing_delete', { p_id: 1 }, /do not have access/);
  await as(ids.owner);
  const c = (await rpc('closing_day', { p_date: t })).closing;
  assert.equal(Number(c.total_sales), 12000);
  assert.equal(Number(c.expenses_total), 1200);
  assert.equal(Number(c.expected_cash), 5800);
  assert.equal(Number(c.cash_difference), -50);
  assert.equal(Number(c.net), 10800);
  const month = await rpc('closings_month', { p_month: t.slice(0, 7) });
  assert.equal(Number(month.totals.total_sales), 12000);
  const rep = await rpc('report_monthly', { p_month: t.slice(0, 7) });
  assert.equal(Number(rep.summary.sales.total), 12000);
  assert.equal(rep.daily.length >= 28, true);
  const hist = await rpc('report_history', { p_months: 3 });
  assert.equal(Number(hist.months.at(-1).sales), 12000);
  const dash = await rpc('dashboard');
  assert.equal(Number(dash.financials.today.closing.cash_sales), 5000);
  assert.equal(dash.financials.series.length, 30);
});

test('expenses: staff can only edit their own recent entries', async () => {
  await as(ids.cashier);
  const e = await rpc('expense_save', { p_id: null, p: { category: 'Transport', amount: 50 } });
  await fails('expense_save', { p_id: null, p: { category: 'Old', amount: 5, date: '2020-01-01' } }, /today or yesterday/);
  await as(ids.manager);
  await rpc('expense_save', { p_id: e.id, p: { category: 'Transport', amount: 60 } });
  await fails('expense_save', { p_id: null, p: { category: 'Bad', amount: -1 } }, /at least/);
});

test('pending expenses are not counted until paid', async () => {
  const t = await today();
  await as(ids.owner);
  const before = Number((await rpc('expenses_list', { p: { month: t.slice(0, 7) } })).totals.total);
  const e = await rpc('expense_save', { p_id: null, p: { category: 'Electricity', amount: 3000, status: 'pending', due_date: t, description: 'Sept bill' } });
  let list = await rpc('expenses_list', { p: { month: t.slice(0, 7) } });
  assert.equal(Number(list.totals.total), before, 'pending not in totals');
  assert.equal(Number(list.pending.total), 3000);
  assert.equal(Number((await rpc('dashboard')).financials.pending_expenses.total), 3000);
  await rpc('expense_mark_paid', { p_id: e.id, p: { payment_mode: 'online', reference: 'UPI123' } });
  await fails('expense_mark_paid', { p_id: e.id, p: {} }, /already paid/);
  list = await rpc('expenses_list', { p: { month: t.slice(0, 7) } });
  assert.equal(Number(list.totals.total), before + 3000);
  assert.equal(list.pending.count, 0);
});

test('orders: customer service creates, cook moves status but cannot cancel', async () => {
  await as(ids.customer_service);
  const o = await rpc('order_save', { p_id: null, p: { customer_name: 'Ananya', item_desc: 'Truffle 1kg', delivery_date: '2030-01-01', total_amount: 900, advance_paid: 400 } });
  assert.match(o.order_no, /^ORD-\d{6}-001$/);
  const o2 = await rpc('order_save', { p_id: null, p: { customer_name: 'B', item_desc: 'X', delivery_date: '2030-01-02' } });
  assert.match(o2.order_no, /-002$/);
  await as(ids.cook);
  await rpc('order_status', { p_id: o.id, p_status: 'in_kitchen' });
  await fails('order_status', { p_id: o.id, p_status: 'cancelled' }, /Only order managers/);
  const list = (await rpc('orders_list', { p: {} })).orders;
  assert.equal(list[0].total_amount, undefined, 'cook does not see order money');
});

test('settings, activity log and backup', async () => {
  await as(ids.owner);
  const s = await rpc('settings_save', { p: { shop_name: 'Sweet Crumbs', currency: '₹', timezone: 'Asia/Kolkata', expense_categories: ['Rent', 'Rent', ' Gas '] } });
  assert.equal(s.settings.shop_name, 'Sweet Crumbs');
  assert.deepEqual(s.settings.expense_categories.sort(), ['Gas', 'Rent']);
  await fails('settings_save', { p: { shop_name: 'X', currency: '₹', timezone: 'Mars/Base' } }, /Unknown timezone/);
  const logs = (await rpc('audit_list', { p: {} })).logs;
  assert.ok(logs.some(l => l.action === 'closing_created'));
  assert.ok(logs.some(l => l.action === 'vendor_payment_deleted'));
  const b = await rpc('backup_export');
  assert.ok(b.expenses.length >= 3);
  await as(ids.manager);
  await fails('backup_export', {}, /do not have access/);
});

test('kitchens: staff type a new item name and it is saved to that kitchen', async () => {
  await as(ids.cook);
  const r = await rpc('production_create', { p: { item_name: 'Rasmalai Cake', kitchen: 'Cake Kitchen', qty_made: 3 } });
  assert.ok(r.id);
  await rpc('production_create', { p: { item_name: 'rasmalai cake', kitchen: 'Cake Kitchen', qty_made: 2 } }); // same item, any case
  await rpc('production_create', { p: { item_name: 'Veg Puff', kitchen: 'Snacks Kitchen', qty_made: 40 } });
  const cakes = await rpc('items_list', { p: { kitchen: 'Cake Kitchen' } });
  assert.deepEqual(cakes.items.map(i => i.name), ['Rasmalai Cake']);
  const logs = await rpc('production_list', { p: { kitchen: 'Snacks Kitchen' } });
  assert.equal(logs.logs.length, 1);
  assert.equal(logs.logs[0].kitchen, 'Snacks Kitchen');
});

test('leftovers carry to the next day and stay in sync', async () => {
  const t = await today();
  const d0 = new Date(t + 'T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() - 1);
  const y = d0.toISOString().slice(0, 10);
  await as(ids.owner);
  const e = await rpc('production_create', { p: { item_name: 'Truffle Pastry', kitchen: 'Cake Kitchen', qty_made: 20, date: y } });
  let r = await rpc('production_carry_forward', { p_date: t });
  assert.equal(r.pending_counts, 1, 'cannot carry until sold count is entered');
  await rpc('production_sales', { p_id: e.id, p: { qty_sold: 14, qty_wasted: 1 } });
  r = await rpc('production_carry_forward', { p_date: t });
  assert.equal(r.carried, 1);
  assert.equal((await rpc('production_carry_forward', { p_date: t })).carried, 0, 'only once');
  let row = (await rpc('production_list', { p: { date: t } })).logs.find(l => l.item_name === 'Truffle Pastry');
  assert.equal(Number(row.carried_in), 5);
  assert.equal(Number(row.qty_made), 0);
  await rpc('production_sales', { p_id: e.id, p: { qty_sold: 16, qty_wasted: 1 } }); // yesterday corrected
  row = (await rpc('production_list', { p: { date: t } })).logs.find(l => l.item_name === 'Truffle Pastry');
  assert.equal(Number(row.carried_in), 3);
});

test('attendance: clock in, break, clock out; staff see only their own', async () => {
  await as(ids.cashier);
  await rpc('attendance_action', { p_action: 'in' });
  await fails('attendance_action', { p_action: 'in' }, /already clocked in/);
  await rpc('attendance_action', { p_action: 'break_start' });
  const onBreak = (await rpc('attendance_me', {})).today;
  assert.equal(onBreak.on_break, true);
  await rpc('attendance_action', { p_action: 'break_end' });
  const done = await rpc('attendance_action', { p_action: 'out' });
  assert.ok(done.check_out);
  assert.equal(done.breaks.length, 1);
  await fails('attendance_action', { p_action: 'break_start' }, /already clocked out/);
  const me = await rpc('attendance_me', {});
  assert.equal(me.days.find(d => d.date === me.today_date).status, 'present');
  await fails('attendance_team', {}, /do not have access/);
  await fails('attendance_staff', { p_user: ids.cook }, /do not have access/);
  await as(ids.manager);
  const team = await rpc('attendance_team', {});
  assert.equal(team.staff.find(s => s.user_id === ids.cashier).day.status, 'present');
});

test('leave requests are approved by manager and mark attendance', async () => {
  const t = await today();
  const d1 = new Date(t + 'T00:00:00Z'); d1.setUTCDate(d1.getUTCDate() + 2);
  const d2 = new Date(d1); d2.setUTCDate(d2.getUTCDate() + 1);
  const from = d1.toISOString().slice(0, 10), to = d2.toISOString().slice(0, 10);
  await as(ids.cook);
  const l = await rpc('leave_request', { p: { from_date: from, to_date: to, leave_type: 'sick', reason: 'Fever' } });
  await fails('leave_decide', { p_id: l.id, p_approve: true, p_paid: true }, /do not have access/);
  await as(ids.manager);
  assert.equal((await rpc('leaves_list', { p: { status: 'pending' } })).leaves.length, 1);
  await rpc('leave_decide', { p_id: l.id, p_approve: true, p_paid: false });
  const reg = await rpc('attendance_staff', { p_user: ids.cook, p_month: from.slice(0, 7) });
  const day = reg.days.find(d => d.date === from);
  assert.equal(day.status, 'leave');
  assert.equal(day.leave_paid, false);
});

test('salary: recommended from attendance, advances and pending', async () => {
  const t = await today();
  const month = t.slice(0, 7);
  await as(ids.owner);
  await rpc('staff_save', { p_id: ids.kitchen_staff, p: { monthly_salary: 15000, salary_type: 'monthly', date_of_joining: month + '-01', designation: 'Helper' } });
  // Mark: 2 days present, 1 half day, rest absent so far
  await rpc('attendance_set', { p_user: ids.kitchen_staff, p_date: month + '-01', p: { status: 'present', check_in: '09:00', check_out: '18:00' } });
  await rpc('attendance_set', { p_user: ids.kitchen_staff, p_date: month + '-02', p: { status: 'present' } });
  await rpc('attendance_set', { p_user: ids.kitchen_staff, p_date: month + '-03', p: { status: 'half_day' } });
  const s = await rpc('salary_staff', { p_user: ids.kitchen_staff, p_month: month });
  const dim = s.calc.days_in_month;
  assert.equal(Number(s.calc.paid_days), 2.5);
  assert.equal(Number(s.calc.recommended), Math.round(15000 / dim * 2.5));
  await rpc('salary_pay', { p_user: ids.kitchen_staff, p: { month, amount: 1000, kind: 'advance', payment_mode: 'cash' } });
  await rpc('salary_finalize', { p_user: ids.kitchen_staff, p_month: month, p_amount: 5000, p_note: 'agreed' });
  await rpc('salary_pay', { p_user: ids.kitchen_staff, p: { month, amount: 200, kind: 'bonus' } });
  const s2 = (await rpc('salary_month', { p_month: month })).staff.find(x => x.user_id === ids.kitchen_staff);
  assert.equal(Number(s2.final), 5000);
  assert.equal(Number(s2.payable), 5200);
  assert.equal(Number(s2.pending), 4200);
  const exp = await rpc('expenses_list', { p: { month, category: 'Salary & Wages' } });
  assert.equal(Number(exp.totals.total), 1000, 'advance recorded as an expense, bonus is not');
  // unpaid salary from an earlier month shows up on the next month
  const [y, mo] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  const nx = (await rpc('salary_month', { p_month: next })).staff.find(x => x.user_id === ids.kitchen_staff);
  assert.equal(Number(nx.earlier_pending), 4200);
  assert.equal(nx.earlier[0].month, month);
  await rpc('salary_pay', { p_user: ids.kitchen_staff, p: { month, amount: 4200, kind: 'salary', payment_mode: 'online' } });
  const nx2 = (await rpc('salary_month', { p_month: next })).staff.find(x => x.user_id === ids.kitchen_staff);
  assert.equal(Number(nx2.earlier_pending), 0);
  await as(ids.manager);
  await fails('salary_month', {}, /do not have access/);
  const detail = await rpc('staff_detail', { p_id: ids.kitchen_staff });
  assert.equal(detail.staff.monthly_salary, undefined, 'manager does not see salary by default');
  assert.equal(detail.staff.designation, 'Helper');
});

test('staff without app login: record only, cannot sign in', async () => {
  await as(ids.owner);
  const u = await rpc('user_create', { p: { name: 'Raju Helper', role: 'kitchen_staff', app_access: false, kitchen: 'Snacks Kitchen', monthly_salary: 9000 } });
  const prof = (await db.query('select username, app_access, kitchen, monthly_salary from public.profiles where id = $1', [u.id])).rows[0];
  assert.equal(prof.app_access, false);
  assert.equal(prof.kitchen, 'Snacks Kitchen');
  assert.equal(Number(prof.monthly_salary), 9000);
  const banned = (await db.query('select banned_until > now() b from auth.users where id = $1', [u.id])).rows[0].b;
  assert.equal(banned, true);
  await rpc('staff_doc_add', { p_user: u.id, p: { doc_type: 'id_proof', files: [{ path: `staff/${u.id}-raju/aadhaar.pdf`, name: 'aadhaar.pdf' }] } });
  assert.equal((await rpc('staff_detail', { p_id: u.id })).documents.length, 1);
  await fails('staff_doc_add', { p_user: u.id, p: { files: [{ path: `staff/${ids.cook}-x/a.pdf`, name: 'a.pdf' }] } }, /Invalid file path/);
});

test('tables are locked against direct access', async () => {
  const r = await db.query(`select has_table_privilege('anon', 'public.expenses', 'select') a, has_table_privilege('authenticated', 'public.profiles', 'select') b,
    has_function_privilege('anon', 'public.dashboard()', 'execute') c, has_function_privilege('authenticated', 'public.create_login(text,text,text,text,text,boolean)', 'execute') d,
    has_function_privilege('anon', 'public.setup_owner(text,text,text)', 'execute') e`);
  assert.deepEqual(r.rows[0], { a: false, b: false, c: false, d: false, e: true });
});
