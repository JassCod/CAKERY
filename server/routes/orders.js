'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, HttpError, validator, today, DATE_RE } = require('../util');

const router = express.Router();
const STATUSES = ['pending', 'in_kitchen', 'ready', 'delivered', 'cancelled'];

router.get('/', requirePerm('orders.view'), (req, res) => {
  const where = [];
  const args = [];
  const { status, q, from, to, view } = req.query;
  if (view === 'upcoming') { where.push("o.delivery_date >= ? AND o.status NOT IN ('delivered','cancelled')"); args.push(today()); }
  if (view === 'overdue') { where.push("o.delivery_date < ? AND o.status NOT IN ('delivered','cancelled')"); args.push(today()); }
  if (status && STATUSES.includes(status)) { where.push('o.status = ?'); args.push(status); }
  if (DATE_RE.test(from || '')) { where.push('o.delivery_date >= ?'); args.push(from); }
  if (DATE_RE.test(to || '')) { where.push('o.delivery_date <= ?'); args.push(to); }
  if (q) { where.push('(o.customer_name LIKE ? OR o.phone LIKE ? OR o.order_no LIKE ? OR o.item_desc LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  const orders = db.prepare(`SELECT o.*, u.name AS created_by_name FROM orders o LEFT JOIN users u ON u.id = o.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.delivery_date ${view === 'upcoming' ? 'ASC' : 'DESC'}, o.delivery_time LIMIT 500`).all(...args);
  const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE delivery_date >= ? GROUP BY status`).all(today());
  const hideMoney = !can(req, 'orders.manage') && !can(req, 'dashboard.financials');
  if (hideMoney) for (const o of orders) { delete o.total_amount; delete o.advance_paid; }
  res.json({ orders, counts });
});

function nextOrderNo() {
  const prefix = 'ORD-' + today().replace(/-/g, '').slice(2) + '-';
  const last = db.prepare('SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1').get(prefix + '%');
  const n = last ? Number(last.order_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(3, '0');
}

function readOrder(body) {
  const v = validator(body);
  const data = {
    customer_name: v.str('customer_name', { required: true, max: 100, label: 'Customer name' }),
    phone: v.str('phone', { max: 30 }),
    item_desc: v.str('item_desc', { required: true, max: 300, label: 'Cake / item' }),
    weight: v.str('weight', { max: 40 }),
    flavour: v.str('flavour', { max: 80 }),
    message: v.str('message', { max: 200 }),
    delivery_date: v.date('delivery_date', { required: true, label: 'Delivery date' }),
    delivery_time: v.str('delivery_time', { max: 20 }),
    total_amount: v.num('total_amount', { min: 0, def: 0, label: 'Total amount' }),
    advance_paid: v.num('advance_paid', { min: 0, def: 0, label: 'Advance paid' }),
    status: v.oneOf('status', STATUSES, { def: 'pending', label: 'Status' }),
    notes: v.str('notes', { max: 1000 }),
  };
  if (data.advance_paid > data.total_amount && data.total_amount > 0) throw new HttpError(400, 'Advance cannot exceed total amount');
  return data;
}

router.post('/', requirePerm('orders.manage'), h((req, res) => {
  const data = readOrder(req.body);
  const order_no = nextOrderNo();
  const r = db.prepare(`INSERT INTO orders (order_no, customer_name, phone, item_desc, weight, flavour, message, delivery_date, delivery_time,
    total_amount, advance_paid, status, notes, created_by) VALUES (@order_no, @customer_name, @phone, @item_desc, @weight, @flavour, @message,
    @delivery_date, @delivery_time, @total_amount, @advance_paid, @status, @notes, @created_by)`).run({ ...data, order_no, created_by: req.user.id });
  audit(req.user.id, 'order_created', 'order', r.lastInsertRowid, { order_no, customer: data.customer_name });
  res.status(201).json({ id: r.lastInsertRowid, order_no });
}));

router.put('/:id', requirePerm('orders.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Order not found');
  const data = readOrder(req.body);
  db.prepare(`UPDATE orders SET customer_name=@customer_name, phone=@phone, item_desc=@item_desc, weight=@weight, flavour=@flavour,
    message=@message, delivery_date=@delivery_date, delivery_time=@delivery_time, total_amount=@total_amount, advance_paid=@advance_paid,
    status=@status, notes=@notes, updated_at=datetime('now') WHERE id=@id`).run({ ...data, id: row.id });
  audit(req.user.id, 'order_updated', 'order', row.id, { order_no: row.order_no });
  res.json({ ok: true });
}));

router.patch('/:id/status', requirePerm('orders.status', 'orders.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Order not found');
  const status = validator(req.body).oneOf('status', STATUSES, { label: 'Status' });
  if (!can(req, 'orders.manage') && status === 'cancelled') {
    throw new HttpError(403, 'Only order managers can cancel orders');
  }
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
  audit(req.user.id, 'order_status', 'order', row.id, { order_no: row.order_no, from: row.status, to: status });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('orders.manage'), h((req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Order not found');
  db.prepare('DELETE FROM orders WHERE id = ?').run(row.id);
  audit(req.user.id, 'order_deleted', 'order', row.id, row);
  res.json({ ok: true });
}));

module.exports = router;
