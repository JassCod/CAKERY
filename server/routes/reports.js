'use strict';
const express = require('express');
const { db } = require('../db');
const { requirePerm, requireAuth, can } = require('../auth');
const { h, today, addDays, monthRange, round2, MONTH_RE } = require('../util');
const { enrich } = require('./closing');
const { billsWithStatus } = require('./vendors');

const router = express.Router();

function salesBetween(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(cash_sales),0) AS cash, COALESCE(SUM(online_sales),0) AS online,
    COALESCE(SUM(cash_sales + online_sales),0) AS total, COUNT(*) AS days FROM daily_closings WHERE date BETWEEN ? AND ?`).get(from, to);
}
function expensesBetween(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(amount),0) AS total,
    COALESCE(SUM(CASE WHEN payment_mode='cash' THEN amount END),0) AS cash,
    COALESCE(SUM(CASE WHEN payment_mode<>'cash' THEN amount END),0) AS online, COUNT(*) AS count
    FROM expenses WHERE date BETWEEN ? AND ?`).get(from, to);
}
function vendorPending() {
  return db.prepare(`SELECT v.id, v.name, v.phone,
      round(v.opening_balance + COALESCE((SELECT SUM(amount) FROM vendor_bills b WHERE b.vendor_id = v.id),0)
        - COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.vendor_id = v.id),0), 2) AS pending
    FROM vendors v WHERE v.active = 1 ORDER BY pending DESC`).all().filter(v => v.pending > 0.009);
}
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/* ---------------- Dashboard ---------------- */
router.get('/dashboard', requireAuth, h((req, res) => {
  const t = today();
  const month = t.slice(0, 7);
  const { from } = monthRange(month);
  const out = { today: t, month };

  if (can(req, 'dashboard.financials')) {
    const closing = db.prepare('SELECT * FROM daily_closings WHERE date = ?').get(t);
    const yesterdayClosing = db.prepare('SELECT * FROM daily_closings WHERE date = ?').get(addDays(t, -1));
    const pm = prevMonth(month);
    const pmRange = monthRange(pm);
    const dayOfMonth = Number(t.slice(8));
    const pmSameDay = `${pm}-${String(Math.min(dayOfMonth, pmRange.days)).padStart(2, '0')}`;
    const monthSales = salesBetween(from, t);
    const monthExp = expensesBetween(from, t);
    const pmSales = salesBetween(pmRange.from, pmSameDay);
    const pmExp = expensesBetween(pmRange.from, pmSameDay);

    const start = addDays(t, -29);
    const salesRows = db.prepare('SELECT date, cash_sales, online_sales FROM daily_closings WHERE date BETWEEN ? AND ?').all(start, t);
    const expRows = db.prepare('SELECT date, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date').all(start, t);
    const sMap = Object.fromEntries(salesRows.map(r => [r.date, r]));
    const eMap = Object.fromEntries(expRows.map(r => [r.date, r.total]));
    const series = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(start, i);
      series.push({ date: d, cash: sMap[d] ? sMap[d].cash_sales : 0, online: sMap[d] ? sMap[d].online_sales : 0, expenses: eMap[d] || 0, closed: !!sMap[d] });
    }
    const pending = vendorPending();
    out.financials = {
      today: { closing: closing ? enrich(closing) : null, expenses: expensesBetween(t, t) },
      yesterday: yesterdayClosing ? enrich(yesterdayClosing) : null,
      month: {
        sales: monthSales, expenses: monthExp, net: round2(monthSales.total - monthExp.total),
        prev: { sales: pmSales, expenses: pmExp, net: round2(pmSales.total - pmExp.total) },
      },
      series,
      expense_categories: db.prepare('SELECT category, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC').all(from, t),
      vendor_pending: { total: round2(pending.reduce((s, v) => s + v.pending, 0)), count: pending.length, top: pending.slice(0, 6) },
      overdue_bills: db.prepare('SELECT id, name FROM vendors WHERE active = 1').all()
        .flatMap(v => billsWithStatus(v.id).filter(b => b.overdue).map(b => ({ id: b.id, bill_no: b.bill_no, due_date: b.due_date, amount: b.amount, balance: b.balance, vendor_name: v.name, vendor_id: v.id })))
        .sort((x, y) => (x.due_date < y.due_date ? -1 : 1)).slice(0, 6),
      recent_expenses: db.prepare(`SELECT e.id, e.date, e.category, e.amount, e.payment_mode, e.description, v.name AS vendor_name
        FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id ORDER BY e.date DESC, e.id DESC LIMIT 6`).all(),
    };
  }

  if (can(req, 'items.view')) {
    out.stock = {
      low: db.prepare(`SELECT id, name, unit, stock_qty, reorder_level, type FROM items
        WHERE active = 1 AND reorder_level > 0 AND stock_qty <= reorder_level ORDER BY (stock_qty / reorder_level) LIMIT 8`).all(),
      counts: db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN type='product' THEN 1 ELSE 0 END) AS products,
        SUM(CASE WHEN reorder_level > 0 AND stock_qty <= reorder_level THEN 1 ELSE 0 END) AS low FROM items WHERE active = 1`).get(),
    };
  }

  if (can(req, 'production.view')) {
    out.production = {
      today: db.prepare(`SELECT i.name AS item_name, i.unit, SUM(p.qty_made) AS made, SUM(COALESCE(p.qty_sold,0)) AS sold,
          SUM(p.qty_wasted) AS wasted, SUM(CASE WHEN p.qty_sold IS NULL THEN 1 ELSE 0 END) AS pending
        FROM production_logs p JOIN items i ON i.id = p.item_id WHERE p.date = ? GROUP BY i.id ORDER BY made DESC`).all(t),
      mine_today: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(qty_made),0) AS qty FROM production_logs WHERE date = ? AND made_by = ?').get(t, req.user.id),
    };
  }

  if (can(req, 'orders.view')) {
    out.orders = {
      upcoming: db.prepare(`SELECT id, order_no, customer_name, item_desc, weight, delivery_date, delivery_time, status FROM orders
        WHERE delivery_date BETWEEN ? AND ? AND status NOT IN ('delivered','cancelled') ORDER BY delivery_date, delivery_time LIMIT 8`).all(t, addDays(t, 7)),
      due_today: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE delivery_date = ? AND status NOT IN ('delivered','cancelled')`).get(t).n,
      overdue: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE delivery_date < ? AND status NOT IN ('delivered','cancelled')`).get(t).n,
    };
  }

  if (can(req, 'closing.create') || can(req, 'closing.manage')) {
    out.closing_status = { today_closed: !!db.prepare('SELECT 1 FROM daily_closings WHERE date = ?').get(t) };
  }
  res.json(out);
}));

/* ---------------- Monthly report ---------------- */
router.get('/reports/monthly', requirePerm('reports.view'), h((req, res) => {
  const month = MONTH_RE.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const { from, to, days } = monthRange(month);

  const closings = db.prepare('SELECT * FROM daily_closings WHERE date BETWEEN ? AND ?').all(from, to);
  const cMap = Object.fromEntries(closings.map(c => [c.date, c]));
  const expByDay = Object.fromEntries(db.prepare(`SELECT date, SUM(amount) AS total,
      SUM(CASE WHEN payment_mode='cash' THEN amount ELSE 0 END) AS cash FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date`)
    .all(from, to).map(r => [r.date, r]));
  const daily = [];
  for (let i = 1; i <= days; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const c = cMap[d];
    const e = expByDay[d] || { total: 0, cash: 0 };
    const cash = c ? c.cash_sales : 0;
    const online = c ? c.online_sales : 0;
    daily.push({ date: d, closed: !!c, cash, online, total: round2(cash + online), expenses: round2(e.total), net: round2(cash + online - e.total) });
  }

  const sales = salesBetween(from, to);
  const expenses = expensesBetween(from, to);
  const closedDays = daily.filter(d => d.closed);
  const best = closedDays.reduce((b, d) => (!b || d.total > b.total ? d : b), null);

  const pm = prevMonth(month);
  const pmr = monthRange(pm);
  const prevSales = salesBetween(pmr.from, pmr.to);
  const prevExp = expensesBetween(pmr.from, pmr.to);

  res.json({
    month, from, to,
    summary: {
      sales, expenses, net: round2(sales.total - expenses.total),
      avg_daily_sales: closedDays.length ? round2(sales.total / closedDays.length) : 0,
      best_day: best, days_closed: closedDays.length, days_in_month: days,
      online_share: sales.total ? round2((sales.online / sales.total) * 100) : 0,
      prev: { month: pm, sales: prevSales.total, expenses: prevExp.total, net: round2(prevSales.total - prevExp.total) },
    },
    daily,
    expense_categories: db.prepare(`SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses
      WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`).all(from, to),
    expense_modes: db.prepare(`SELECT payment_mode, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY payment_mode ORDER BY total DESC`).all(from, to),
    vendors: db.prepare(`SELECT v.id, v.name,
        COALESCE((SELECT SUM(amount) FROM vendor_bills b WHERE b.vendor_id = v.id AND b.bill_date BETWEEN ? AND ?),0) AS billed,
        COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.vendor_id = v.id AND p.date BETWEEN ? AND ?),0) AS paid,
        round(v.opening_balance + COALESCE((SELECT SUM(amount) FROM vendor_bills b WHERE b.vendor_id = v.id AND b.bill_date <= ?),0)
          - COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.vendor_id = v.id AND p.date <= ?),0), 2) AS pending_at_month_end
      FROM vendors v ORDER BY billed DESC, v.name`).all(from, to, from, to, to, to)
      .filter(v => v.billed || v.paid || v.pending_at_month_end > 0.009),
    production: db.prepare(`SELECT i.id AS item_id, i.name AS item_name, i.unit, i.sell_price,
        SUM(p.qty_made) AS made, SUM(COALESCE(p.qty_sold,0)) AS sold, SUM(p.qty_wasted) AS wasted, COUNT(DISTINCT p.date) AS days
      FROM production_logs p JOIN items i ON i.id = p.item_id WHERE p.date BETWEEN ? AND ? GROUP BY i.id ORDER BY sold DESC`).all(from, to),
    staff_production: db.prepare(`SELECT u.name, u.role, COUNT(*) AS entries, SUM(p.qty_made) AS made
      FROM production_logs p JOIN users u ON u.id = p.made_by WHERE p.date BETWEEN ? AND ? GROUP BY u.id ORDER BY made DESC`).all(from, to),
    orders: db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled, COALESCE(SUM(CASE WHEN status<>'cancelled' THEN total_amount END),0) AS value
      FROM orders WHERE delivery_date BETWEEN ? AND ?`).get(from, to),
  });
}));

/* ---------------- Month-by-month history ---------------- */
router.get('/reports/history', requirePerm('reports.view'), h((req, res) => {
  const count = Math.min(Math.max(Number(req.query.months) || 12, 1), 60);
  let m = today().slice(0, 7);
  const months = [];
  for (let i = 0; i < count; i++) { months.unshift(m); m = prevMonth(m); }
  const rows = months.map(month => {
    const { from, to } = monthRange(month);
    const s = salesBetween(from, to);
    const e = expensesBetween(from, to);
    return { month, cash: s.cash, online: s.online, sales: s.total, expenses: e.total, net: round2(s.total - e.total), days_closed: s.days };
  });
  const first = db.prepare(`SELECT MIN(d) AS d FROM (SELECT MIN(date) AS d FROM daily_closings UNION ALL SELECT MIN(date) FROM expenses)`).get().d;
  res.json({ months: rows, first_record: first });
}));

module.exports = router;
