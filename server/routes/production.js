'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, today, addDays, DATE_RE } = require('../util');

const router = express.Router();

const SELECT = `SELECT p.*, i.name AS item_name, i.unit, i.category, i.sell_price,
  mu.name AS made_by_name, su.name AS sold_updated_by_name
  FROM production_logs p
  JOIN items i ON i.id = p.item_id
  LEFT JOIN users mu ON mu.id = p.made_by
  LEFT JOIN users su ON su.id = p.sold_updated_by`;

router.get('/', requirePerm('production.view'), (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : (DATE_RE.test(req.query.date || '') ? req.query.date : today());
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : from;
  const args = [from, to];
  let extra = '';
  if (req.query.mine === '1') { extra = ' AND p.made_by = ?'; args.push(req.user.id); }
  const logs = db.prepare(`${SELECT} WHERE p.date BETWEEN ? AND ?${extra} ORDER BY p.date DESC, i.name, p.id`).all(...args);
  const summary = db.prepare(`SELECT i.id AS item_id, i.name AS item_name, i.unit, i.sell_price,
      SUM(p.qty_made) AS made, SUM(COALESCE(p.qty_sold,0)) AS sold, SUM(p.qty_wasted) AS wasted,
      SUM(CASE WHEN p.qty_sold IS NULL THEN 1 ELSE 0 END) AS pending_counts
    FROM production_logs p JOIN items i ON i.id = p.item_id
    WHERE p.date BETWEEN ? AND ?${extra} GROUP BY i.id ORDER BY made DESC`).all(...args);
  if (!can(req, 'dashboard.financials')) for (const r of [...logs, ...summary]) delete r.sell_price;
  res.json({ from, to, logs, summary });
});

function canEditOwn(req, row) {
  if (can(req, 'production.manage')) return true;
  // Staff may edit their own entries for today and yesterday (for late-night closing).
  return row.made_by === req.user.id && row.date >= addDays(today(), -1);
}

router.post('/', requirePerm('production.log', 'production.manage'), h((req, res) => {
  const v = validator(req.body);
  const date = v.date('date') || today();
  if (!can(req, 'production.manage') && (date > today() || date < addDays(today(), -1))) {
    throw new HttpError(403, 'You can only log production for today or yesterday');
  }
  const item_id = v.id('item_id', { required: true, label: 'Item' });
  const item = db.prepare('SELECT id, name FROM items WHERE id = ? AND active = 1').get(item_id);
  if (!item) throw new HttpError(400, 'Item not found');
  const qty_made = v.num('qty_made', { required: true, min: 0, label: 'Quantity made' });
  const qty_sold = v.num('qty_sold', { min: 0, label: 'Quantity sold' });
  const qty_wasted = v.num('qty_wasted', { min: 0, def: 0, label: 'Quantity wasted' });
  const notes = v.str('notes', { max: 500 });
  const r = db.prepare(`INSERT INTO production_logs (date, item_id, qty_made, qty_sold, qty_wasted, notes, made_by, sold_updated_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(date, item_id, qty_made, qty_sold, qty_wasted, notes, req.user.id, qty_sold == null ? null : req.user.id);
  audit(req.user.id, 'production_logged', 'production', r.lastInsertRowid, { item: item.name, date, qty_made });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put('/:id', requirePerm('production.log', 'production.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM production_logs WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Entry not found');
  if (!canEditOwn(req, row)) throw new HttpError(403, 'You can only edit your own recent entries');
  const v = validator(req.body);
  const qty_made = v.num('qty_made', { required: true, min: 0, label: 'Quantity made' });
  const notes = v.str('notes', { max: 500 });
  const item_id = v.id('item_id') || row.item_id;
  const date = can(req, 'production.manage') ? (v.date('date') || row.date) : row.date;
  db.prepare("UPDATE production_logs SET qty_made = ?, notes = ?, item_id = ?, date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(qty_made, notes, item_id, date, id);
  audit(req.user.id, 'production_updated', 'production', id, { from: row.qty_made, to: qty_made });
  res.json({ ok: true });
}));

// End-of-day: how many were sold / wasted.
router.put('/:id/sales', requirePerm('production.sales', 'production.log', 'production.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM production_logs WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Entry not found');
  if (!can(req, 'production.sales') && !canEditOwn(req, row)) {
    throw new HttpError(403, 'You can only update your own recent entries');
  }
  if (!can(req, 'production.manage') && row.date < addDays(today(), -1)) {
    throw new HttpError(403, 'Only managers can change counts for older days');
  }
  const v = validator(req.body);
  const qty_sold = v.num('qty_sold', { required: true, min: 0, label: 'Quantity sold' });
  const qty_wasted = v.num('qty_wasted', { min: 0, def: 0, label: 'Quantity wasted' });
  db.prepare("UPDATE production_logs SET qty_sold = ?, qty_wasted = ?, sold_updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(qty_sold, qty_wasted, req.user.id, id);
  audit(req.user.id, 'production_sales_updated', 'production', id, { qty_sold, qty_wasted });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('production.log', 'production.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM production_logs WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Entry not found');
  if (!canEditOwn(req, row)) throw new HttpError(403, 'You can only delete your own recent entries');
  db.prepare('DELETE FROM production_logs WHERE id = ?').run(id);
  audit(req.user.id, 'production_deleted', 'production', id, { date: row.date, qty_made: row.qty_made });
  res.json({ ok: true });
}));

module.exports = router;
