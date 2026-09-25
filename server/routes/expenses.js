'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, today, addDays, monthRange, DATE_RE } = require('../util');

const router = express.Router();
const MODES = ['cash', 'online', 'card', 'bank', 'cheque'];

router.get('/', requirePerm('expenses.view'), h((req, res) => {
  let from, to;
  if (DATE_RE.test(req.query.from || '') && DATE_RE.test(req.query.to || '')) ({ from, to } = req.query);
  else ({ from, to } = monthRange(req.query.month || today().slice(0, 7)));
  const where = ['e.date BETWEEN ? AND ?'];
  const args = [from, to];
  if (req.query.category) { where.push('e.category = ?'); args.push(req.query.category); }
  if (req.query.mode && MODES.includes(req.query.mode)) { where.push('e.payment_mode = ?'); args.push(req.query.mode); }
  if (req.query.vendor_id) { where.push('e.vendor_id = ?'); args.push(Number(req.query.vendor_id)); }
  if (req.query.q) {
    where.push('(e.description LIKE ? OR e.paid_to LIKE ? OR e.reference LIKE ? OR v.name LIKE ?)');
    args.push(...Array(4).fill(`%${req.query.q}%`));
  }
  const W = where.join(' AND ');
  const expenses = db.prepare(`SELECT e.*, v.name AS vendor_name, u.name AS created_by_name
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN users u ON u.id = e.created_by
    WHERE ${W} ORDER BY e.date DESC, e.id DESC`).all(...args);
  const byCategory = db.prepare(`SELECT e.category, SUM(e.amount) AS total, COUNT(*) AS count
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE ${W} GROUP BY e.category ORDER BY total DESC`).all(...args);
  const totals = db.prepare(`SELECT COALESCE(SUM(e.amount),0) AS total,
      COALESCE(SUM(CASE WHEN e.payment_mode='cash' THEN e.amount END),0) AS cash,
      COALESCE(SUM(CASE WHEN e.payment_mode<>'cash' THEN e.amount END),0) AS online, COUNT(*) AS count
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE ${W}`).get(...args);
  res.json({ from, to, expenses, byCategory, totals });
}));

function canModify(req, row) {
  if (can(req, 'expenses.manage')) return true;
  return row.created_by === req.user.id && row.date >= addDays(today(), -1);
}

function readExpense(req) {
  const v = validator(req.body);
  const data = {
    date: v.date('date') || today(),
    category: v.str('category', { required: true, max: 60, label: 'Category' }),
    amount: v.num('amount', { required: true, min: 0.01, label: 'Amount' }),
    payment_mode: v.oneOf('payment_mode', MODES, { def: 'cash', label: 'Payment mode' }),
    vendor_id: v.id('vendor_id'),
    paid_to: v.str('paid_to', { max: 120 }),
    description: v.str('description', { max: 1000 }),
    reference: v.str('reference', { max: 80 }),
  };
  if (data.date > today()) throw new HttpError(400, 'Expense date cannot be in the future');
  if (!can(req, 'expenses.manage') && data.date < addDays(today(), -1)) {
    throw new HttpError(403, 'You can only record expenses for today or yesterday');
  }
  if (data.vendor_id && !db.prepare('SELECT 1 FROM vendors WHERE id = ?').get(data.vendor_id)) throw new HttpError(400, 'Vendor not found');
  return data;
}

router.post('/', requirePerm('expenses.create', 'expenses.manage'), h((req, res) => {
  const data = readExpense(req);
  const r = db.prepare(`INSERT INTO expenses (date, category, amount, payment_mode, vendor_id, paid_to, description, reference, created_by)
    VALUES (@date, @category, @amount, @payment_mode, @vendor_id, @paid_to, @description, @reference, @created_by)`)
    .run({ ...data, created_by: req.user.id });
  audit(req.user.id, 'expense_created', 'expense', r.lastInsertRowid, { amount: data.amount, category: data.category, date: data.date });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put('/:id', requirePerm('expenses.create', 'expenses.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Expense not found');
  if (!canModify(req, row)) throw new HttpError(403, 'You can only edit your own recent expenses');
  if (row.source === 'vendor_payment') throw new HttpError(400, 'This expense comes from a vendor payment. Edit it from the vendor page.');
  const data = readExpense(req);
  db.prepare(`UPDATE expenses SET date=@date, category=@category, amount=@amount, payment_mode=@payment_mode, vendor_id=@vendor_id,
    paid_to=@paid_to, description=@description, reference=@reference, updated_at=datetime('now') WHERE id=@id`).run({ ...data, id: row.id });
  audit(req.user.id, 'expense_updated', 'expense', row.id, { before: { amount: row.amount, date: row.date }, after: { amount: data.amount, date: data.date } });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('expenses.create', 'expenses.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Expense not found');
  if (!canModify(req, row)) throw new HttpError(403, 'You can only delete your own recent expenses');
  if (row.source === 'vendor_payment') throw new HttpError(400, 'This expense comes from a vendor payment. Delete the payment from the vendor page.');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(row.id);
  audit(req.user.id, 'expense_deleted', 'expense', row.id, row);
  res.json({ ok: true });
}));

module.exports = router;
