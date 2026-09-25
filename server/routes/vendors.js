'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { db, audit, tx, UPLOAD_DIR } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, today, round2 } = require('../util');

const router = express.Router();
const MODES = ['cash', 'online', 'card', 'bank', 'cheque'];
const DOC_TYPES = ['invoice', 'receipt', 'quotation', 'contract', 'credit_note', 'other'];
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'vendor';
const vendorDir = v => path.join(UPLOAD_DIR, 'vendors', `${v.id}-${slug(v.name)}`);

const BALANCE_SQL = `
  SELECT v.*,
    COALESCE((SELECT SUM(amount) FROM vendor_bills b WHERE b.vendor_id = v.id), 0) AS total_billed,
    COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.vendor_id = v.id), 0) AS total_paid,
    (SELECT COUNT(*) FROM documents d WHERE d.vendor_id = v.id) AS doc_count,
    (SELECT MAX(bill_date) FROM vendor_bills b WHERE b.vendor_id = v.id) AS last_bill_date
  FROM vendors v`;

const withPending = v => ({ ...v, pending: round2(v.opening_balance + v.total_billed - v.total_paid) });

function getVendor(id) {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(Number(id));
  if (!v) throw new HttpError(404, 'Vendor not found');
  return v;
}

router.get('/', requirePerm('vendors.view', 'expenses.create', 'documents.view'), (req, res) => {
  const all = req.query.include_inactive === '1';
  const vendors = db.prepare(`${BALANCE_SQL} ${all ? '' : 'WHERE v.active = 1'} ORDER BY v.name`).all().map(withPending);
  const showMoney = can(req, 'vendors.view');
  res.json({
    vendors: showMoney ? vendors : vendors.map(({ id, name, category, active }) => ({ id, name, category, active })),
    total_pending: showMoney ? round2(vendors.reduce((s, v) => s + v.pending, 0)) : undefined,
  });
});

// Bills with paid/balance. Payments tied to a bill count against it; "on account" payments
// (and any overpayment) settle the opening balance first, then the oldest bills (FIFO).
function billsWithStatus(vendorId) {
  const vendor = db.prepare('SELECT opening_balance FROM vendors WHERE id = ?').get(vendorId);
  const bills = db.prepare(`SELECT b.*, COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.bill_id = b.id), 0) AS direct_paid,
      (SELECT COUNT(*) FROM documents d WHERE d.bill_id = b.id) AS doc_count, u.name AS created_by_name
    FROM vendor_bills b LEFT JOIN users u ON u.id = b.created_by WHERE b.vendor_id = ? ORDER BY b.bill_date, b.id`).all(vendorId);
  let pool = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM vendor_payments WHERE vendor_id = ? AND bill_id IS NULL').get(vendorId).s;
  for (const b of bills) { if (b.direct_paid > b.amount) { pool += b.direct_paid - b.amount; b.direct_paid = b.amount; } }
  pool -= Math.max(0, (vendor && vendor.opening_balance) || 0);
  const t = today();
  return bills.map(b => {
    let paid = b.direct_paid;
    if (pool > 0 && paid < b.amount) { const take = Math.min(pool, b.amount - paid); paid += take; pool -= take; }
    paid = round2(paid);
    const balance = round2(b.amount - paid);
    const status = balance <= 0.009 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const { direct_paid, ...rest } = b;
    return { ...rest, paid, balance, status, overdue: status !== 'paid' && !!b.due_date && b.due_date < t };
  }).reverse();
}

router.get('/:id', requirePerm('vendors.view', 'documents.view'), h((req, res) => {
  const vendor = withPending(db.prepare(`${BALANCE_SQL} WHERE v.id = ?`).get(Number(req.params.id)) || (() => { throw new HttpError(404, 'Vendor not found'); })());
  const documents = can(req, 'documents.view') ? db.prepare(`SELECT d.*, u.name AS uploaded_by_name, b.bill_no FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN vendor_bills b ON b.id = d.bill_id
    WHERE d.vendor_id = ? ORDER BY COALESCE(d.doc_date, d.created_at) DESC, d.id DESC`).all(vendor.id) : [];
  if (!can(req, 'vendors.view')) {
    return res.json({ vendor: { id: vendor.id, name: vendor.name, category: vendor.category }, documents, bills: [], payments: [], ledger: [] });
  }
  const bills = billsWithStatus(vendor.id);
  const payments = db.prepare(`SELECT p.*, b.bill_no, u.name AS created_by_name FROM vendor_payments p
    LEFT JOIN vendor_bills b ON b.id = p.bill_id LEFT JOIN users u ON u.id = p.created_by
    WHERE p.vendor_id = ? ORDER BY p.date DESC, p.id DESC`).all(vendor.id);

  // Running ledger, oldest first.
  const entries = [
    ...bills.map(b => ({ date: b.bill_date, type: 'bill', ref: b.bill_no, description: b.description, debit: b.amount, credit: 0, id: b.id })),
    ...payments.map(p => ({ date: p.date, type: 'payment', ref: p.reference, description: `${p.payment_mode}${p.note ? ' — ' + p.note : ''}`, debit: 0, credit: p.amount, id: p.id })),
  ].sort((a, b) => (a.date === b.date ? (a.type === 'bill' ? -1 : 1) : a.date < b.date ? -1 : 1));
  let bal = vendor.opening_balance;
  const ledger = [{ date: null, type: 'opening', description: 'Opening balance', debit: 0, credit: 0, balance: round2(bal) }];
  for (const e of entries) { bal += e.debit - e.credit; ledger.push({ ...e, balance: round2(bal) }); }

  res.json({ vendor, bills, payments, documents, ledger });
}));

function readVendor(body) {
  const v = validator(body);
  return {
    name: v.str('name', { required: true, max: 120, label: 'Vendor name' }),
    contact_person: v.str('contact_person', { max: 80 }),
    phone: v.str('phone', { max: 30 }),
    email: v.str('email', { max: 120 }),
    address: v.str('address', { max: 400 }),
    gstin: v.str('gstin', { max: 30 }),
    category: v.str('category', { max: 60 }),
    opening_balance: v.num('opening_balance', { def: 0, label: 'Opening balance' }),
    notes: v.str('notes', { max: 1000 }),
    active: v.bool('active', true) ? 1 : 0,
  };
}

router.post('/', requirePerm('vendors.manage'), h((req, res) => {
  const data = readVendor(req.body);
  if (db.prepare('SELECT 1 FROM vendors WHERE name = ? COLLATE NOCASE').get(data.name)) throw new HttpError(409, 'A vendor with this name already exists');
  const r = db.prepare(`INSERT INTO vendors (name, contact_person, phone, email, address, gstin, category, opening_balance, notes, active)
    VALUES (@name, @contact_person, @phone, @email, @address, @gstin, @category, @opening_balance, @notes, @active)`).run(data);
  audit(req.user.id, 'vendor_created', 'vendor', r.lastInsertRowid, { name: data.name });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put('/:id', requirePerm('vendors.manage'), h((req, res) => {
  const existing = getVendor(req.params.id);
  const data = readVendor(req.body);
  db.prepare(`UPDATE vendors SET name=@name, contact_person=@contact_person, phone=@phone, email=@email, address=@address,
    gstin=@gstin, category=@category, opening_balance=@opening_balance, notes=@notes, active=@active WHERE id=@id`).run({ ...data, id: existing.id });
  if (slug(existing.name) !== slug(data.name)) {
    const oldDir = vendorDir(existing);
    const newDir = vendorDir({ ...existing, name: data.name });
    if (fs.existsSync(oldDir)) {
      fs.mkdirSync(path.dirname(newDir), { recursive: true });
      fs.renameSync(oldDir, newDir);
      db.prepare('UPDATE documents SET stored_path = replace(stored_path, ?, ?) WHERE vendor_id = ?')
        .run(path.relative(UPLOAD_DIR, oldDir), path.relative(UPLOAD_DIR, newDir), existing.id);
    }
  }
  audit(req.user.id, 'vendor_updated', 'vendor', existing.id, { name: data.name });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('vendors.manage'), h((req, res) => {
  const v = getVendor(req.params.id);
  const hasHistory = db.prepare(`SELECT (SELECT COUNT(*) FROM vendor_bills WHERE vendor_id = ?) + (SELECT COUNT(*) FROM vendor_payments WHERE vendor_id = ?)
    + (SELECT COUNT(*) FROM documents WHERE vendor_id = ?) AS n`).get(v.id, v.id, v.id).n;
  if (hasHistory) {
    db.prepare('UPDATE vendors SET active = 0 WHERE id = ?').run(v.id);
    audit(req.user.id, 'vendor_archived', 'vendor', v.id, { name: v.name });
    return res.json({ ok: true, archived: true });
  }
  db.prepare('DELETE FROM vendors WHERE id = ?').run(v.id);
  audit(req.user.id, 'vendor_deleted', 'vendor', v.id, { name: v.name });
  res.json({ ok: true });
}));

/* ---------- Bills (purchases on credit) ---------- */
function readBill(body) {
  const v = validator(body);
  return {
    bill_no: v.str('bill_no', { max: 60 }),
    bill_date: v.date('bill_date') || today(),
    due_date: v.date('due_date'),
    amount: v.num('amount', { required: true, min: 0.01, label: 'Amount' }),
    description: v.str('description', { max: 1000 }),
  };
}

router.post('/:id/bills', requirePerm('vendors.bills'), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const data = readBill(req.body);
  const r = db.prepare(`INSERT INTO vendor_bills (vendor_id, bill_no, bill_date, due_date, amount, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(vendor.id, data.bill_no, data.bill_date, data.due_date, data.amount, data.description, req.user.id);
  audit(req.user.id, 'bill_created', 'vendor_bill', r.lastInsertRowid, { vendor: vendor.name, ...data });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put('/:id/bills/:billId', requirePerm('vendors.bills'), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const bill = db.prepare('SELECT * FROM vendor_bills WHERE id = ? AND vendor_id = ?').get(Number(req.params.billId), vendor.id);
  if (!bill) throw new HttpError(404, 'Bill not found');
  const data = readBill(req.body);
  db.prepare('UPDATE vendor_bills SET bill_no=?, bill_date=?, due_date=?, amount=?, description=? WHERE id=?')
    .run(data.bill_no, data.bill_date, data.due_date, data.amount, data.description, bill.id);
  audit(req.user.id, 'bill_updated', 'vendor_bill', bill.id, { vendor: vendor.name, before: bill.amount, after: data.amount });
  res.json({ ok: true });
}));

router.delete('/:id/bills/:billId', requirePerm('vendors.manage'), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const bill = db.prepare('SELECT * FROM vendor_bills WHERE id = ? AND vendor_id = ?').get(Number(req.params.billId), vendor.id);
  if (!bill) throw new HttpError(404, 'Bill not found');
  db.prepare('DELETE FROM vendor_bills WHERE id = ?').run(bill.id);
  audit(req.user.id, 'bill_deleted', 'vendor_bill', bill.id, { vendor: vendor.name, ...bill });
  res.json({ ok: true });
}));

/* ---------- Payments (each one is also recorded as an expense) ---------- */
router.post('/:id/payments', requirePerm('vendors.payments'), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const v = validator(req.body);
  const data = {
    date: v.date('date') || today(),
    amount: v.num('amount', { required: true, min: 0.01, label: 'Amount' }),
    payment_mode: v.oneOf('payment_mode', MODES, { def: 'cash', label: 'Payment mode' }),
    bill_id: v.id('bill_id'),
    reference: v.str('reference', { max: 80 }),
    note: v.str('note', { max: 500 }),
  };
  if (data.date > today()) throw new HttpError(400, 'Payment date cannot be in the future');
  let bill = null;
  if (data.bill_id) {
    bill = db.prepare('SELECT * FROM vendor_bills WHERE id = ? AND vendor_id = ?').get(data.bill_id, vendor.id);
    if (!bill) throw new HttpError(400, 'Bill not found for this vendor');
  }
  const id = tx(() => {
    const e = db.prepare(`INSERT INTO expenses (date, category, amount, payment_mode, vendor_id, paid_to, description, reference, source, created_by)
      VALUES (?, 'Vendor Payment', ?, ?, ?, ?, ?, ?, 'vendor_payment', ?)`)
      .run(data.date, data.amount, data.payment_mode, vendor.id, vendor.name,
        `Payment to ${vendor.name}${bill && bill.bill_no ? ' against bill #' + bill.bill_no : ''}${data.note ? ' — ' + data.note : ''}`,
        data.reference, req.user.id);
    const p = db.prepare(`INSERT INTO vendor_payments (vendor_id, bill_id, expense_id, date, amount, payment_mode, reference, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(vendor.id, data.bill_id, e.lastInsertRowid, data.date, data.amount, data.payment_mode, data.reference, data.note, req.user.id);
    return p.lastInsertRowid;
  });
  audit(req.user.id, 'vendor_payment', 'vendor_payment', id, { vendor: vendor.name, amount: data.amount, mode: data.payment_mode });
  res.status(201).json({ id });
}));

router.delete('/:id/payments/:paymentId', requirePerm('vendors.manage'), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const p = db.prepare('SELECT * FROM vendor_payments WHERE id = ? AND vendor_id = ?').get(Number(req.params.paymentId), vendor.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  tx(() => {
    db.prepare('DELETE FROM vendor_payments WHERE id = ?').run(p.id);
    if (p.expense_id) db.prepare('DELETE FROM expenses WHERE id = ?').run(p.expense_id);
  });
  audit(req.user.id, 'vendor_payment_deleted', 'vendor_payment', p.id, { vendor: vendor.name, ...p });
  res.json({ ok: true });
}));

/* ---------- Documents (invoices etc., stored per vendor folder) ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      try {
        const dir = vendorDir(getVendor(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = slug(path.basename(file.originalname, ext)).slice(0, 40);
      cb(null, `${today()}_${crypto.randomBytes(4).toString('hex')}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, cb) {
    const ok = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, `File type not allowed: ${file.originalname}`), ok);
  },
});

router.post('/:id/documents', requirePerm('documents.upload'), upload.array('files', 10), h((req, res) => {
  const vendor = getVendor(req.params.id);
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'Choose at least one file');
  const v = validator(req.body);
  const doc_type = v.oneOf('doc_type', DOC_TYPES, { def: 'invoice', label: 'Document type' });
  const title = v.str('title', { max: 150 });
  const doc_date = v.date('doc_date') || today();
  const bill_id = v.id('bill_id');
  if (bill_id && !db.prepare('SELECT 1 FROM vendor_bills WHERE id = ? AND vendor_id = ?').get(bill_id, vendor.id)) {
    for (const f of files) fs.rmSync(f.path, { force: true });
    throw new HttpError(400, 'Bill not found for this vendor');
  }
  const ins = db.prepare(`INSERT INTO documents (vendor_id, bill_id, title, doc_type, doc_date, original_name, stored_path, mime, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ids = tx(() => files.map(f => ins.run(vendor.id, bill_id, title || f.originalname, doc_type, doc_date, f.originalname,
    path.relative(UPLOAD_DIR, f.path), f.mimetype, f.size, req.user.id).lastInsertRowid));
  audit(req.user.id, 'documents_uploaded', 'vendor', vendor.id, { vendor: vendor.name, files: files.map(f => f.originalname) });
  res.status(201).json({ ids });
}));

function getDoc(req) {
  const d = db.prepare('SELECT * FROM documents WHERE id = ? AND vendor_id = ?').get(Number(req.params.docId), Number(req.params.id));
  if (!d) throw new HttpError(404, 'Document not found');
  const abs = path.resolve(UPLOAD_DIR, d.stored_path);
  if (!abs.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new HttpError(400, 'Invalid document path');
  return { d, abs };
}

router.get('/:id/documents/:docId/file', requirePerm('documents.view'), h((req, res) => {
  const { d, abs } = getDoc(req);
  if (!fs.existsSync(abs)) throw new HttpError(404, 'File is missing from storage');
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(d.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(d.mime || path.extname(abs));
  res.sendFile(abs);
}));

router.delete('/:id/documents/:docId', requirePerm('vendors.manage'), h((req, res) => {
  const { d, abs } = getDoc(req);
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  fs.rmSync(abs, { force: true });
  audit(req.user.id, 'document_deleted', 'document', d.id, { name: d.original_name, vendor_id: d.vendor_id });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.billsWithStatus = billsWithStatus;
