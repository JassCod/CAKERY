'use strict';
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { db, audit, getSettings } = require('../db');
const { requirePerm } = require('../auth');
const { h, HttpError, validator, today } = require('../util');

const router = express.Router();

router.get('/settings', requirePerm('settings.manage'), (_req, res) => res.json({ settings: getSettings() }));

router.put('/settings', requirePerm('settings.manage'), h((req, res) => {
  const v = validator(req.body);
  const data = {
    shop_name: v.str('shop_name', { required: true, max: 80, label: 'Shop name' }),
    tagline: v.str('tagline', { max: 120 }) || '',
    currency: v.str('currency', { required: true, max: 5, label: 'Currency symbol' }),
    timezone: v.str('timezone', { max: 60 }) || 'Asia/Kolkata',
    address: v.str('address', { max: 300 }) || '',
    phone: v.str('phone', { max: 40 }) || '',
  };
  try { new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone }); } catch { throw new HttpError(400, 'Unknown timezone'); }
  const lists = {};
  for (const k of ['expense_categories', 'item_categories']) {
    if (req.body[k] != null) {
      if (!Array.isArray(req.body[k])) throw new HttpError(400, `${k} must be a list`);
      lists[k] = JSON.stringify([...new Set(req.body[k].map(s => String(s).trim()).filter(Boolean).map(s => s.slice(0, 60)))]);
    }
  }
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, val] of Object.entries({ ...data, ...lists })) up.run(k, val);
  audit(req.user.id, 'settings_updated', 'settings', null, data);
  res.json({ settings: getSettings() });
}));

router.get('/audit', requirePerm('audit.view'), (req, res) => {
  const where = [];
  const args = [];
  if (req.query.user_id) { where.push('a.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.entity) { where.push('a.entity = ?'); args.push(req.query.entity); }
  if (req.query.q) { where.push('(a.action LIKE ? OR a.details LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const page = Math.max(Number(req.query.page) || 1, 1);
  const logs = db.prepare(`SELECT a.*, u.name AS user_name, u.role AS user_role FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 100 OFFSET ?`).all(...args, (page - 1) * 100);
  res.json({ logs, page });
});

// All documents, grouped by vendor on the client.
router.get('/documents', requirePerm('documents.view'), (req, res) => {
  const where = [];
  const args = [];
  if (req.query.q) { where.push('(d.title LIKE ? OR d.original_name LIKE ? OR v.name LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
  if (req.query.type) { where.push('d.doc_type = ?'); args.push(req.query.type); }
  if (/^\d{4}-\d{2}$/.test(req.query.month || '')) { where.push("substr(COALESCE(d.doc_date, d.created_at),1,7) = ?"); args.push(req.query.month); }
  const docs = db.prepare(`SELECT d.*, v.name AS vendor_name, u.name AS uploaded_by_name, b.bill_no FROM documents d
    JOIN vendors v ON v.id = d.vendor_id LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN vendor_bills b ON b.id = d.bill_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.name, COALESCE(d.doc_date, d.created_at) DESC`).all(...args);
  res.json({ documents: docs });
});

// Consistent snapshot of the whole database for safekeeping (owner-level).
router.get('/backup', requirePerm('settings.manage'), h((req, res) => {
  const file = path.join(os.tmpdir(), `cakery-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req.user.id, 'backup_downloaded', 'settings', null);
  res.download(file, `cakery-backup-${today()}.db`, () => fs.rm(file, { force: true }, () => {}));
}));

module.exports = router;
