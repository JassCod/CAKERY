'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, today, addDays, monthRange, round2, DATE_RE } = require('../util');

const router = express.Router();

function dayExpenses(date) {
  return db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN amount END), 0) AS cash,
      COALESCE(SUM(CASE WHEN payment_mode <> 'cash' THEN amount END), 0) AS online,
      COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE date = ?`).get(date);
}

function enrich(c) {
  const exp = dayExpenses(c.date);
  const expected = round2(c.opening_cash + c.cash_sales - exp.cash);
  return {
    ...c,
    total_sales: round2(c.cash_sales + c.online_sales),
    expenses_cash: exp.cash,
    expenses_online: exp.online,
    expenses_total: exp.total,
    expected_cash: expected,
    cash_difference: c.cash_counted == null ? null : round2(c.cash_counted - expected),
    net: round2(c.cash_sales + c.online_sales - exp.total),
  };
}

function suggestedOpening(date) {
  const prev = db.prepare('SELECT * FROM daily_closings WHERE date < ? ORDER BY date DESC LIMIT 1').get(date);
  if (!prev) return 0;
  const e = enrich(prev);
  const drawer = prev.cash_counted != null ? prev.cash_counted : e.expected_cash;
  return round2(Math.max(0, drawer - (prev.cash_handover || 0)));
}

router.get('/', requirePerm('closing.view'), h((req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const { from, to } = monthRange(month);
  const rows = db.prepare(`SELECT c.*, u.name AS closed_by_name FROM daily_closings c
    LEFT JOIN users u ON u.id = c.closed_by WHERE c.date BETWEEN ? AND ? ORDER BY c.date DESC`).all(from, to).map(enrich);
  const totals = rows.reduce((t, r) => {
    t.cash_sales += r.cash_sales; t.online_sales += r.online_sales; t.total_sales += r.total_sales;
    t.expenses_total += r.expenses_total; t.net += r.net; return t;
  }, { cash_sales: 0, online_sales: 0, total_sales: 0, expenses_total: 0, net: 0 });
  for (const k in totals) totals[k] = round2(totals[k]);
  // Days in range that have expenses but no closing yet.
  const missing = db.prepare(`SELECT DISTINCT date FROM expenses WHERE date BETWEEN ? AND ?
    AND date NOT IN (SELECT date FROM daily_closings) AND date < ? ORDER BY date DESC`).all(from, to, today()).map(r => r.date);
  res.json({ month, closings: rows, totals, missing });
}));

router.get('/day/:date', requirePerm('closing.view', 'closing.create'), h((req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) throw new HttpError(400, 'Invalid date');
  const row = db.prepare(`SELECT c.*, u.name AS closed_by_name FROM daily_closings c
    LEFT JOIN users u ON u.id = c.closed_by WHERE c.date = ?`).get(date);
  const expenses = db.prepare(`SELECT e.id, e.category, e.amount, e.payment_mode, e.description, e.paid_to, v.name AS vendor_name
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE e.date = ? ORDER BY e.id`).all(date);
  res.json({
    date,
    closing: row ? enrich(row) : null,
    expenses,
    expense_totals: dayExpenses(date),
    suggested_opening: suggestedOpening(date),
    editable: can(req, 'closing.manage') || (can(req, 'closing.create') && date >= addDays(today(), -1) && date <= today()),
  });
}));

router.post('/', requirePerm('closing.create', 'closing.manage'), h((req, res) => {
  const v = validator(req.body);
  const date = v.date('date') || today();
  if (!can(req, 'closing.manage') && (date > today() || date < addDays(today(), -1))) {
    throw new HttpError(403, 'You can only close today or yesterday. Ask a manager for older dates.');
  }
  if (date > today()) throw new HttpError(400, 'Cannot close a future date');
  const data = {
    date,
    opening_cash: v.num('opening_cash', { min: 0, def: 0, label: 'Opening cash' }),
    cash_sales: v.num('cash_sales', { required: true, min: 0, label: 'Cash sales' }),
    online_sales: v.num('online_sales', { required: true, min: 0, label: 'Online sales' }),
    cash_counted: v.num('cash_counted', { min: 0, label: 'Cash counted' }),
    cash_handover: v.num('cash_handover', { min: 0, def: 0, label: 'Cash handed over' }),
    notes: v.str('notes', { max: 1000 }),
    closed_by: req.user.id,
  };
  const existing = db.prepare('SELECT * FROM daily_closings WHERE date = ?').get(date);
  if (existing) {
    db.prepare(`UPDATE daily_closings SET opening_cash=@opening_cash, cash_sales=@cash_sales, online_sales=@online_sales,
      cash_counted=@cash_counted, cash_handover=@cash_handover, notes=@notes, closed_by=@closed_by, updated_at=datetime('now')
      WHERE date=@date`).run(data);
    audit(req.user.id, 'closing_updated', 'closing', existing.id, {
      date, before: { cash: existing.cash_sales, online: existing.online_sales }, after: { cash: data.cash_sales, online: data.online_sales },
    });
    return res.json({ id: existing.id, updated: true });
  }
  const r = db.prepare(`INSERT INTO daily_closings (date, opening_cash, cash_sales, online_sales, cash_counted, cash_handover, notes, closed_by)
    VALUES (@date, @opening_cash, @cash_sales, @online_sales, @cash_counted, @cash_handover, @notes, @closed_by)`).run(data);
  audit(req.user.id, 'closing_created', 'closing', r.lastInsertRowid, { date, cash: data.cash_sales, online: data.online_sales });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.delete('/:id', requirePerm('closing.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM daily_closings WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Closing not found');
  db.prepare('DELETE FROM daily_closings WHERE id = ?').run(row.id);
  audit(req.user.id, 'closing_deleted', 'closing', row.id, row);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.enrich = enrich;
