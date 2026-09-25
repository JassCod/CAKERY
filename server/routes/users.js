'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, tx } = require('../db');
const { ROLES, PERMISSION_GROUPS, ALL_PERMISSIONS } = require('../permissions');
const { requirePerm, rankOf, permissionsFor } = require('../auth');
const { h, HttpError, validator } = require('../util');

const router = express.Router();

router.get('/roles', requirePerm('users.manage', 'roles.manage'), (req, res) => {
  const roles = Object.entries(ROLES).map(([key, r]) => ({
    key, ...r,
    permissions: permissionsFor(key),
    manageable: rankOf(key) < rankOf(req.user.role),
    users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ? AND active = 1').get(key).n,
  }));
  res.json({ roles, groups: PERMISSION_GROUPS });
});

router.put('/roles/:role', requirePerm('roles.manage'), h((req, res) => {
  const role = req.params.role;
  if (!ROLES[role]) throw new HttpError(404, 'Unknown role');
  if (role === 'owner') throw new HttpError(400, 'Owner always has full access');
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  const clean = [...new Set(perms.filter(p => ALL_PERMISSIONS.includes(p)))];
  tx(() => {
    db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
    const ins = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
    for (const p of clean) ins.run(role, p);
    // Marker so an intentionally empty role is not re-seeded with defaults on restart.
    if (!clean.length) ins.run(role, '_none');
  });
  audit(req.user.id, 'role_permissions_updated', 'role', null, { role, permissions: clean });
  res.json({ ok: true, permissions: clean });
}));

router.get('/', requirePerm('users.manage'), (_req, res) => {
  const users = db.prepare(`SELECT id, name, username, role, phone, active, last_login, created_at
                            FROM users ORDER BY active DESC, name`).all();
  res.json({ users });
});

function assertCanManage(req, targetRole) {
  if (!ROLES[targetRole]) throw new HttpError(400, 'Invalid role');
  if (rankOf(targetRole) >= rankOf(req.user.role)) {
    throw new HttpError(403, `You cannot manage ${ROLES[targetRole].label} accounts`);
  }
}

router.post('/', requirePerm('users.manage'), h((req, res) => {
  const v = validator(req.body);
  const name = v.str('name', { required: true, max: 80, label: 'Name' });
  const username = v.str('username', { required: true, max: 40, label: 'Username' });
  const password = v.str('password', { required: true, max: 200, label: 'Password' });
  const role = v.oneOf('role', Object.keys(ROLES), { label: 'Role' });
  const phone = v.str('phone', { max: 30 });
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3-40 letters, numbers, dot, dash or underscore');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  assertCanManage(req, role);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Username already taken');
  const r = db.prepare(`INSERT INTO users (name, username, password_hash, role, phone, must_change_password)
                        VALUES (?, ?, ?, ?, ?, 1)`).run(name, username, bcrypt.hashSync(password, 10), role, phone);
  audit(req.user.id, 'user_created', 'user', r.lastInsertRowid, { username, role });
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put('/:id', requirePerm('users.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'User not found');
  if (id === req.user.id) throw new HttpError(400, 'Use "My Account" to edit your own profile');
  assertCanManage(req, existing.role);
  const v = validator(req.body);
  const name = v.str('name', { required: true, max: 80, label: 'Name' });
  const role = v.oneOf('role', Object.keys(ROLES), { def: existing.role, label: 'Role' });
  const phone = v.str('phone', { max: 30 });
  const active = v.bool('active', !!existing.active) ? 1 : 0;
  const password = v.str('password', { max: 200 });
  assertCanManage(req, role);
  tx(() => {
    db.prepare('UPDATE users SET name = ?, role = ?, phone = ?, active = ? WHERE id = ?').run(name, role, phone, active, id);
    if (password) {
      if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
    }
    if (!active || password || role !== existing.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  });
  audit(req.user.id, 'user_updated', 'user', id, { name, role, active: !!active, password_reset: !!password });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('users.manage'), h((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'User not found');
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
  assertCanManage(req, existing.role);
  // Keep history intact: deactivate instead of hard delete.
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(req.user.id, 'user_deactivated', 'user', id, { username: existing.username });
  res.json({ ok: true });
}));

module.exports = router;
