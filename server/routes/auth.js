'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, getSettings } = require('../db');
const { ROLES, PERMISSION_GROUPS } = require('../permissions');
const { COOKIE, createSession, setSessionCookie, requireAuth } = require('../auth');
const { h, HttpError, validator } = require('../util');

const router = express.Router();

// Simple in-memory brute-force protection: 8 failed attempts per username+IP => 10 min lock.
const failures = new Map();
const LOCK_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;

router.get('/public-info', (_req, res) => {
  const s = getSettings();
  res.json({ shop_name: s.shop_name, tagline: s.tagline });
});

router.post('/login', h((req, res) => {
  const v = validator(req.body);
  const username = v.str('username', { required: true, max: 60, label: 'Username' });
  const password = v.str('password', { required: true, max: 200, label: 'Password' });
  const key = `${username.toLowerCase()}|${req.ip}`;
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILS && Date.now() - f.last < LOCK_MS) {
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    failures.set(key, { count: (f && Date.now() - f.last < LOCK_MS ? f.count : 0) + 1, last: Date.now() });
    if (user) audit(user.id, 'login_failed', 'user', user.id);
    throw new HttpError(401, 'Incorrect username or password.');
  }
  if (!user.active) throw new HttpError(403, 'This account is disabled. Contact the owner.');
  failures.delete(key);

  const token = createSession(user.id);
  setSessionCookie(res, token);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  audit(user.id, 'login', 'user', user.id);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id, name: u.name, username: u.username, role: u.role, phone: u.phone,
      role_label: ROLES[u.role] ? ROLES[u.role].label : u.role,
      must_change_password: !!u.must_change_password,
    },
    permissions: [...u.permissions],
    access: PERMISSION_GROUPS
      .map(g => ({ group: g.group, items: g.items.filter(([k]) => u.permissions.has(k)).map(([, label]) => label) }))
      .filter(g => g.items.length),
    settings: getSettings(),
  });
});

router.post('/change-password', requireAuth, h((req, res) => {
  const v = validator(req.body);
  const current = v.str('current_password', { required: true, label: 'Current password' });
  const next = v.str('new_password', { required: true, max: 200, label: 'New password' });
  if (next.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(next, 10), req.user.id);
  // Sign out other devices.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
  audit(req.user.id, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
