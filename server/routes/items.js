'use strict';
const express = require('express');
const { db, audit, tx } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, round2 } = require('../util');

const router = express.Router();
const TYPES = ['product', 'ingredient', 'packaging', 'other'];
const REASONS = ['purchase', 'usage', 'wastage', 'adjustment', 'return', 'production'];

function stripCost(req, item) {
  if (can(req, 'items.manage') || can(req, 'dashboard.financials')) return item;
  const { cost_price, ...rest } = item;
  return rest;
}

router.get('/', requirePerm('items.view'), (req, res) => {
  const { q, type, category, low, include_inactive } = req.query;
  const where = [];
  const args = [];
  if (!include_inactive) where.push('active = 1');
  if (q) { where.push('(name LIKE ? OR sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (type && TYPES.includes(type)) { where.push('type = ?'); args.push(type); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (low === '1') where.push('stock_qty <= reorder_level AND reorder_level > 0');
  const items = db.prepare(`SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                            ORDER BY type, category, name`).all(...args);
  const summary = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN stock_qty <= reorder_level AND reorder_level > 0 THEN 1 ELSE 0 END) AS low,
      SUM(stock_qty * cost_price) AS stock_value
      FROM items WHERE active = 1`).get();
  if (!can(req, 'items.manage') && !can(req, 'dashboard.financials')) delete summary.stock_value;
  res.json({ items: items.map(i => stripCost(req, i)), summary });
});

function readItem(body) {
  const v = validator(body);
  return {
    name: v.str('name', { required: true, max: 120, label: 'Name' }),
    sku: v.str('sku', { max: 40 }),
    type: v.oneOf('type', TYPES, { def: 'product', label: 'Type' }),
    category: v.str('category', { max: 60 }),
    unit: v.str('unit', { max: 20 }) || 'pcs',
    cost_price: v.num('cost_price', { min: 0, def: 0, label: 'Cost price' }),
    sell_price: v.num('sell_price', { min: 0, def: 0, label: 'Selling price' }),
    reorder_level: v.num('reorder_level', { min: 0, def: 0, label: 'Reorder level' }),
    notes: v.str('notes', { max: 1000 }),
    active: v.bool('active', true) ? 1 : 0,
  };
}

router.post('/', requirePerm('items.manage'), h((req, res) => {
  const it = readItem(req.body);
  const opening = validator(req.body).num('stock_qty', { min: 0, def: 0, label: 'Opening stock' });
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO items (name, sku, type, category, unit, cost_price, sell_price, stock_qty, reorder_level, notes, active)
      VALUES (@name, @sku, @type, @category, @unit, @cost_price, @sell_price, @stock_qty, @reorder_level, @notes, @active)`)
      .run({ ...it, stock_qty: opening });
    if (opening) {
      db.prepare(`INSERT INTO stock_movements (item_id, change, balance, reason, note, user_id) VALUES (?, ?, ?, 'adjustment', 'Opening stock', ?)`)
        .run(r.lastInsertRowid, opening, opening, req.user.id);
    }
    return r.lastInsertRowid;
  });
  audit(req.user.id, 'item_created', 'item', id, { name: it.name });
  res.status(201).json({ id });
}));

router.put('/:id', requirePerm('items.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Item not found');
  const it = readItem(req.body);
  db.prepare(`UPDATE items SET name=@name, sku=@sku, type=@type, category=@category, unit=@unit, cost_price=@cost_price,
    sell_price=@sell_price, reorder_level=@reorder_level, notes=@notes, active=@active, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...it, id });
  const changes = {};
  for (const k of ['name', 'cost_price', 'sell_price', 'reorder_level', 'active']) {
    if (existing[k] !== it[k]) changes[k] = [existing[k], it[k]];
  }
  audit(req.user.id, 'item_updated', 'item', id, { name: it.name, changes });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('items.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Item not found');
  const used = db.prepare('SELECT 1 FROM production_logs WHERE item_id = ? LIMIT 1').get(id);
  if (used) {
    db.prepare("UPDATE items SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    audit(req.user.id, 'item_archived', 'item', id, { name: existing.name });
    return res.json({ ok: true, archived: true });
  }
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  audit(req.user.id, 'item_deleted', 'item', id, { name: existing.name });
  res.json({ ok: true });
}));

router.post('/:id/stock', requirePerm('stock.adjust', 'items.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) throw new HttpError(404, 'Item not found');
  const v = validator(req.body);
  const direction = v.oneOf('direction', ['in', 'out', 'set'], { def: 'in' });
  const qty = v.num('qty', { required: true, min: 0, label: 'Quantity' });
  const reason = v.oneOf('reason', REASONS, { def: direction === 'in' ? 'purchase' : 'usage', label: 'Reason' });
  const note = v.str('note', { max: 300 });
  let change;
  if (direction === 'set') change = round2(qty - item.stock_qty);
  else change = direction === 'in' ? qty : -qty;
  if (!change) throw new HttpError(400, 'Nothing to change');
  const balance = round2(item.stock_qty + change);
  tx(() => {
    db.prepare("UPDATE items SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?").run(balance, id);
    db.prepare('INSERT INTO stock_movements (item_id, change, balance, reason, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, change, balance, direction === 'set' ? 'adjustment' : reason, note, req.user.id);
  });
  audit(req.user.id, 'stock_changed', 'item', id, { name: item.name, change, balance, reason });
  res.json({ ok: true, balance });
}));

router.get('/:id/movements', requirePerm('items.view'), (req, res) => {
  const rows = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m
    LEFT JOIN users u ON u.id = m.user_id WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 200`).all(Number(req.params.id));
  res.json({ movements: rows });
});

module.exports = router;
