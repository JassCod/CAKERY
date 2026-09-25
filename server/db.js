'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { ROLES, DEFAULT_ROLE_PERMISSIONS } = require('./permissions');

const DATA_DIR = process.env.CAKERY_DATA_DIR
  ? path.resolve(process.env.CAKERY_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'cakery.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  type TEXT NOT NULL DEFAULT 'product',
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  change REAL NOT NULL,
  balance REAL NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS production_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty_made REAL NOT NULL DEFAULT 0,
  qty_sold REAL,
  qty_wasted REAL NOT NULL DEFAULT 0,
  notes TEXT,
  made_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sold_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_logs(date);

CREATE TABLE IF NOT EXISTS daily_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  opening_cash REAL NOT NULL DEFAULT 0,
  cash_sales REAL NOT NULL DEFAULT 0,
  online_sales REAL NOT NULL DEFAULT 0,
  cash_counted REAL,
  cash_handover REAL NOT NULL DEFAULT 0,
  notes TEXT,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  gstin TEXT,
  category TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bill_no TEXT,
  bill_date TEXT NOT NULL,
  due_date TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON vendor_bills(vendor_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  paid_to TEXT,
  description TEXT,
  reference TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS vendor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bill_id INTEGER REFERENCES vendor_bills(id) ON DELETE SET NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_vendor ON vendor_payments(vendor_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bill_id INTEGER REFERENCES vendor_bills(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'invoice',
  doc_date TEXT,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT,
  item_desc TEXT NOT NULL,
  weight TEXT,
  flavour TEXT,
  message TEXT,
  delivery_date TEXT NOT NULL,
  delivery_time TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  advance_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

const DEFAULT_SETTINGS = {
  shop_name: 'Cakery',
  tagline: 'Baked with love',
  currency: '₹',
  timezone: 'Asia/Kolkata',
  address: '',
  phone: '',
  expense_categories: JSON.stringify([
    'Raw Materials', 'Vendor Payment', 'Salary & Wages', 'Rent', 'Electricity',
    'Gas / Fuel', 'Packaging', 'Transport', 'Repairs & Maintenance', 'Marketing',
    'Staff Food', 'Miscellaneous',
  ]),
  item_categories: JSON.stringify([
    'Cakes', 'Pastries', 'Cookies', 'Breads', 'Snacks', 'Beverages',
    'Flour & Grains', 'Dairy', 'Sugar & Sweeteners', 'Chocolate & Cocoa',
    'Fruits & Nuts', 'Flavours & Colours', 'Packaging',
  ]),
};

function init() {
  db.exec(SCHEMA);

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  // Seed default permissions only for roles that have never been configured.
  const hasRole = db.prepare('SELECT 1 FROM role_permissions WHERE role = ? LIMIT 1');
  const insPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)');
  for (const role of Object.keys(ROLES)) {
    if (role === 'owner') continue; // owner always has everything
    if (!hasRole.get(role)) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role] || []) insPerm.run(role, p);
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const pw = process.env.CAKERY_OWNER_PASSWORD || 'owner123';
    db.prepare(`INSERT INTO users (name, username, password_hash, role, must_change_password)
                VALUES (?, ?, ?, 'owner', 1)`)
      .run('Shop Owner', 'owner', bcrypt.hashSync(pw, 10));
    console.log('[cakery] Created default owner account -> username: owner  password: ' + pw);
  }

  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  for (const k of ['expense_categories', 'item_categories']) {
    try { out[k] = JSON.parse(out[k] || '[]'); } catch { out[k] = []; }
  }
  return out;
}

function audit(userId, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, entity ?? null, entityId ?? null,
      details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)));
}

init();

module.exports = { db, tx, audit, getSetting, getSettings, DATA_DIR, UPLOAD_DIR };
