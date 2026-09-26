// Maps the app's REST-style calls (api('/items', …)) onto Supabase:
// database functions (supabase/setup.sql) for data, Supabase Auth for logins,
// and Supabase Storage for vendor invoices.
const cfg = window.CAKERY_CONFIG || {};
// Accept any form of the project address people may paste (…supabase.co, …/rest/v1/, trailing slash, no https).
function projectUrl(raw) {
  let v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  if (/^[a-z0-9]{15,30}$/i.test(v)) v += '.supabase.co'; // just the project ID
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { return new URL(v).origin; } catch { return ''; }
}
const SUPABASE_URL = projectUrl(cfg.supabaseUrl);
const SUPABASE_KEY = String(cfg.supabaseAnonKey || '').trim().replace(/^["']|["']$/g, '');
export const configured = !!(SUPABASE_URL && SUPABASE_KEY && window.supabase);

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cakery-auth' } })
  : null;

const BUCKET = 'documents';
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];
const MAX_FILE = 15 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Staff sign in with a username (stored as username@cakery.local) or with a real email address.
const staffEmail = u => { const v = String(u).trim().toLowerCase(); return v.includes('@') ? v : v + '@cakery.local'; };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'vendor';
const nullIfEmpty = v => (v === '' || v === undefined ? null : v);

async function rpc(fn, args = {}) {
  let data, error;
  try { ({ data, error } = await sb.rpc(fn, args)); }
  catch { throw new HttpError(0, 'Cannot reach Supabase. Check SUPABASE_URL in GitHub → Settings → Variables, and that the Supabase project is not paused.'); }
  if (error) {
    if (/api key|apikey|No API key/i.test(error.message || '') || error.code === '401') {
      throw new HttpError(503, 'The Supabase key in the website settings is wrong. Check SUPABASE_ANON_KEY in GitHub → Settings → Variables.');
    }
    if (/fetch|network/i.test(error.message || '') && !error.code) {
      throw new HttpError(0, 'Cannot reach Supabase. Check SUPABASE_URL in GitHub → Settings → Variables, and that the Supabase project is not paused.');
    }
    const status = error.code === '28000' ? 401 : error.code === '42501' ? 403 : error.code === 'PGRST202' ? 500 : 400;
    const msg = error.code === 'PGRST202'
      ? 'The database is not set up yet (run supabase/setup.sql in Supabase).'
      : error.message || 'Request failed';
    throw new HttpError(status, msg);
  }
  return data;
}

async function withSignedUrls(docs) {
  if (!docs || !docs.length) return docs;
  const paths = docs.map(d => d.storage_path);
  const [view, dl] = await Promise.all([
    sb.storage.from(BUCKET).createSignedUrls(paths, 3600),
    sb.storage.from(BUCKET).createSignedUrls(paths, 3600, { download: true }),
  ]);
  const map = (res) => Object.fromEntries((res.data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  const v = map(view), d = map(dl);
  return docs.map(doc => ({ ...doc, url: v[doc.storage_path] || null, download_url: d[doc.storage_path] || null }));
}

async function uploadStaffDocuments(userId, form) {
  const files = await checkFiles(form);
  const folder = `staff/${userId}-${slug(form.get('staff_name') || 'staff')}`;
  const uploaded = await putFiles(folder, files);
  try {
    return await rpc('staff_doc_add', { p_user: userId, p: { files: uploaded, doc_type: form.get('doc_type') || 'id_proof', title: form.get('title') || '' } });
  } catch (e) {
    await sb.storage.from(BUCKET).remove(uploaded.map(u => u.path)).catch(() => {});
    throw e;
  }
}

async function checkFiles(form) {
  const files = form.getAll('files').filter(f => f && f.name);
  if (!files.length) throw new HttpError(400, 'Choose at least one file');
  for (const f of files) {
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) throw new HttpError(400, `File type not allowed: ${f.name}`);
    if (f.size > MAX_FILE) throw new HttpError(400, `${f.name} is too large (max 15 MB)`);
  }
  return files;
}

async function putFiles(folder, files) {
  const day = new Date().toISOString().slice(0, 10);
  const uploaded = [];
  for (const f of files) {
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const base = slug(f.name.replace(/\.[^.]+$/, '')).slice(0, 40);
    const path = `${folder}/${day}_${Math.random().toString(36).slice(2, 10)}_${base}${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (error) {
      if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(u => u.path)).catch(() => {});
      throw new HttpError(400, `Upload failed for ${f.name}: ${error.message}`);
    }
    uploaded.push({ path, name: f.name, mime: f.type || null, size: f.size });
  }
  return uploaded;
}

async function uploadDocuments(vendorId, form) {
  const files = form.getAll('files').filter(f => f && f.name);
  if (!files.length) throw new HttpError(400, 'Choose at least one file');
  for (const f of files) {
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) throw new HttpError(400, `File type not allowed: ${f.name}`);
    if (f.size > MAX_FILE) throw new HttpError(400, `${f.name} is too large (max 15 MB)`);
  }
  const folder = `vendors/${vendorId}-${slug(form.get('vendor_name'))}`;
  const day = new Date().toISOString().slice(0, 10);
  const uploaded = [];
  try {
    for (const f of files) {
      const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const base = slug(f.name.replace(/\.[^.]+$/, '')).slice(0, 40);
      const path = `${folder}/${day}_${Math.random().toString(36).slice(2, 10)}_${base}${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) throw new HttpError(400, `Upload failed for ${f.name}: ${error.message}`);
      uploaded.push({ path, name: f.name, mime: f.type || null, size: f.size });
    }
    return await rpc('document_add', { p_vendor: vendorId, p: {
      files: uploaded, doc_type: form.get('doc_type') || 'invoice', title: form.get('title') || '',
      doc_date: form.get('doc_date') || '', bill_id: form.get('bill_id') || '',
    } });
  } catch (e) {
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(u => u.path)).catch(() => {});
    throw e;
  }
}

async function signIn(username, password) {
  const { error } = await sb.auth.signInWithPassword({ email: staffEmail(username), password });
  if (error) {
    const m = error.message || '';
    if (/invalid login|invalid credentials/i.test(m)) throw new HttpError(401, 'Incorrect username/email or password.');
    if (/api key|apikey|jwt/i.test(m)) throw new HttpError(401, 'The Supabase key in the website settings is wrong. Check SUPABASE_ANON_KEY in GitHub → Settings → Variables.');
    if (/fetch|network/i.test(m)) throw new HttpError(0, 'Cannot reach Supabase. Check SUPABASE_URL in GitHub → Settings → Variables, and that the Supabase project is not paused.');
    throw new HttpError(401, m);
  }
  try { await rpc('after_login'); }
  catch (e) { await sb.auth.signOut(); throw e; }
}

// [method, pattern, handler(params, body, query, form)]
const ROUTES = [
  ['GET', '/auth/public-info', () => rpc('public_info')],
  ['POST', '/auth/login', async (_, b) => { await signIn(b.username, b.password); return { ok: true }; }],
  ['POST', '/auth/setup', async (_, b) => {
    if ((b.password || '') !== (b.confirm || '')) throw new HttpError(400, 'Passwords do not match');
    await rpc('setup_owner', { p_username: b.username, p_password: b.password, p_name: b.name });
    await signIn(b.username, b.password);
    return { ok: true };
  }],
  ['POST', '/auth/logout', async () => { await sb.auth.signOut(); return { ok: true }; }],
  ['GET', '/auth/me', async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new HttpError(401, 'Please sign in.');
    return rpc('me');
  }],
  ['POST', '/auth/change-password', (_, b) => rpc('change_password', { p_current: b.current_password, p_new: b.new_password })],

  ['GET', '/users/roles', () => rpc('roles_list')],
  ['PUT', '/users/roles/:role', (p, b) => rpc('role_update', { p_role: p.role, p_permissions: b.permissions || [] })],
  ['GET', '/users', () => rpc('users_list')],
  ['POST', '/users', (_, b) => rpc('user_create', { p: b })],
  ['PUT', '/users/:id', (p, b) => rpc('user_update', { p_id: p.id, p: b })],
  ['DELETE', '/users/:id', p => rpc('user_deactivate', { p_id: p.id })],

  ['GET', '/items', (_, __, q) => rpc('items_list', { p: q })],
  ['POST', '/items', (_, b) => rpc('item_save', { p_id: null, p: b })],
  ['PUT', '/items/:id', (p, b) => rpc('item_save', { p_id: +p.id, p: b })],
  ['DELETE', '/items/:id', p => rpc('item_delete', { p_id: +p.id })],
  ['POST', '/items/:id/stock', (p, b) => rpc('item_stock', { p_id: +p.id, p: b })],
  ['GET', '/items/:id/movements', p => rpc('item_movements', { p_id: +p.id })],

  ['GET', '/production', (_, __, q) => rpc('production_list', { p: q })],
  ['POST', '/production', (_, b) => rpc('production_create', { p: b })],
  ['POST', '/production/carry', (_, b) => rpc('production_carry_forward', { p_date: nullIfEmpty(b.date) })],
  ['PUT', '/production/:id', (p, b) => rpc('production_update', { p_id: +p.id, p: b })],
  ['PUT', '/production/:id/sales', (p, b) => rpc('production_sales', { p_id: +p.id, p: b })],
  ['DELETE', '/production/:id', p => rpc('production_delete', { p_id: +p.id })],

  ['GET', '/closings', (_, __, q) => rpc('closings_month', { p_month: nullIfEmpty(q.month) })],
  ['GET', '/closings/day/:date', p => rpc('closing_day', { p_date: p.date })],
  ['POST', '/closings', (_, b) => rpc('closing_save', { p: b })],
  ['DELETE', '/closings/:id', p => rpc('closing_delete', { p_id: +p.id })],

  ['GET', '/expenses', (_, __, q) => rpc('expenses_list', { p: q })],
  ['POST', '/expenses', (_, b) => rpc('expense_save', { p_id: null, p: b })],
  ['PUT', '/expenses/:id', (p, b) => rpc('expense_save', { p_id: +p.id, p: b })],
  ['DELETE', '/expenses/:id', p => rpc('expense_delete', { p_id: +p.id })],

  ['GET', '/vendors', (_, __, q) => rpc('vendors_list', { p: q })],
  ['GET', '/vendors/:id', async p => { const d = await rpc('vendor_detail', { p_id: +p.id }); d.documents = await withSignedUrls(d.documents); return d; }],
  ['POST', '/vendors', (_, b) => rpc('vendor_save', { p_id: null, p: b })],
  ['PUT', '/vendors/:id', (p, b) => rpc('vendor_save', { p_id: +p.id, p: b })],
  ['DELETE', '/vendors/:id', p => rpc('vendor_delete', { p_id: +p.id })],
  ['POST', '/vendors/:id/bills', (p, b) => rpc('bill_save', { p_vendor: +p.id, p_bill: null, p: b })],
  ['PUT', '/vendors/:id/bills/:bill', (p, b) => rpc('bill_save', { p_vendor: +p.id, p_bill: +p.bill, p: b })],
  ['DELETE', '/vendors/:id/bills/:bill', p => rpc('bill_delete', { p_vendor: +p.id, p_bill: +p.bill })],
  ['POST', '/vendors/:id/payments', (p, b) => rpc('payment_create', { p_vendor: +p.id, p: b })],
  ['DELETE', '/vendors/:id/payments/:pay', p => rpc('payment_delete', { p_vendor: +p.id, p_payment: +p.pay })],
  ['POST', '/vendors/:id/documents', (p, _b, _q, form) => uploadDocuments(+p.id, form)],
  ['DELETE', '/vendors/:id/documents/:doc', async p => {
    const r = await rpc('document_delete', { p_vendor: +p.id, p_doc: +p.doc });
    if (r.storage_path) await sb.storage.from(BUCKET).remove([r.storage_path]);
    return { ok: true };
  }],

  ['GET', '/orders', (_, __, q) => rpc('orders_list', { p: q })],
  ['POST', '/orders', (_, b) => rpc('order_save', { p_id: null, p: b })],
  ['PUT', '/orders/:id', (p, b) => rpc('order_save', { p_id: +p.id, p: b })],
  ['PATCH', '/orders/:id/status', (p, b) => rpc('order_status', { p_id: +p.id, p_status: b.status })],
  ['DELETE', '/orders/:id', p => rpc('order_delete', { p_id: +p.id })],

  ['GET', '/attendance/me', (_, __, q) => rpc('attendance_me', { p_month: nullIfEmpty(q.month) })],
  ['POST', '/attendance/action', (_, b) => rpc('attendance_action', { p_action: b.action })],
  ['GET', '/attendance/team', (_, __, q) => rpc('attendance_team', { p_date: nullIfEmpty(q.date) })],
  ['GET', '/attendance/register', (_, __, q) => rpc('attendance_register', { p_month: nullIfEmpty(q.month) })],
  ['GET', '/attendance/staff/:id', (p, __, q) => rpc('attendance_staff', { p_user: p.id, p_month: nullIfEmpty(q.month) })],
  ['PUT', '/attendance/:id/:date', (p, b) => rpc('attendance_set', { p_user: p.id, p_date: p.date, p: b })],
  ['GET', '/leaves', (_, __, q) => rpc('leaves_list', { p: q })],
  ['POST', '/leaves', (_, b) => rpc('leave_request', { p: b })],
  ['DELETE', '/leaves/:id', p => rpc('leave_cancel', { p_id: +p.id })],
  ['POST', '/leaves/:id/decide', (p, b) => rpc('leave_decide', { p_id: +p.id, p_approve: !!b.approve, p_paid: b.paid !== false })],

  ['GET', '/staff/:id', async p => {
    const d = await rpc('staff_detail', { p_id: p.id });
    d.documents = await withSignedUrls(d.documents);
    return d;
  }],
  ['PUT', '/staff/:id', (p, b) => rpc('staff_save', { p_id: p.id, p: b })],
  ['POST', '/staff/:id/documents', (p, _b, _q, form) => uploadStaffDocuments(p.id, form)],
  ['DELETE', '/staff/:id/documents/:doc', async p => {
    const r = await rpc('staff_doc_delete', { p_user: p.id, p_doc: +p.doc });
    if (r.storage_path) await sb.storage.from(BUCKET).remove([r.storage_path]);
    return { ok: true };
  }],

  ['GET', '/salary', (_, __, q) => rpc('salary_month', { p_month: nullIfEmpty(q.month) })],
  ['GET', '/salary/:id', (p, __, q) => rpc('salary_staff', { p_user: p.id, p_month: nullIfEmpty(q.month) })],
  ['PUT', '/salary/:id/final', (p, b) => rpc('salary_finalize', { p_user: p.id, p_month: b.month, p_amount: b.amount === '' || b.amount == null ? null : Number(b.amount), p_note: b.note || null })],
  ['POST', '/salary/:id/payments', (p, b) => rpc('salary_pay', { p_user: p.id, p: b })],
  ['DELETE', '/salary/payments/:id', p => rpc('salary_payment_delete', { p_id: +p.id })],

  ['GET', '/dashboard', () => rpc('dashboard')],
  ['GET', '/reports/monthly', (_, __, q) => rpc('report_monthly', { p_month: nullIfEmpty(q.month) })],
  ['GET', '/reports/history', (_, __, q) => rpc('report_history', { p_months: Number(q.months) || 12 })],

  ['GET', '/admin/settings', () => rpc('settings_get')],
  ['PUT', '/admin/settings', (_, b) => rpc('settings_save', { p: b })],
  ['GET', '/admin/audit', (_, __, q) => rpc('audit_list', { p: q })],
  ['GET', '/admin/documents', async (_, __, q) => { const d = await rpc('documents_all', { p: q }); d.documents = await withSignedUrls(d.documents); return d; }],
  ['GET', '/admin/backup', () => rpc('backup_export')],
];

const compiled = ROUTES.map(([method, pattern, fn]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { method, re, keys, fn };
});

export async function call(path, { method = 'GET', body, form } = {}) {
  if (!configured) throw new HttpError(503, 'Supabase is not configured.');
  const [pathname, query = ''] = path.split('?');
  const q = Object.fromEntries(new URLSearchParams(query));
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.fn(params, body || {}, q, form);
  }
  throw new HttpError(404, `Unknown action: ${method} ${pathname}`);
}
