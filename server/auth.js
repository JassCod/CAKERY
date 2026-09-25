'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');
const { ROLES, ALL_PERMISSIONS } = require('./permissions');

const SESSION_DAYS = 7;
const COOKIE = 'cakery_session';

function permissionsFor(role) {
  if (role === 'owner') return [...ALL_PERMISSIONS, 'roles.manage'];
  return db.prepare("SELECT permission FROM role_permissions WHERE role = ? AND permission <> '_none'").all(role).map(r => r.permission);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(token, userId, `+${SESSION_DAYS} days`);
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.CAKERY_INSECURE_COOKIE !== '1',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  });
}

function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.name, u.username, u.role, u.phone, u.active, u.must_change_password
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token);
    if (row && row.active) {
      req.user = { ...row, permissions: new Set(permissionsFor(row.role)) };
      req.sessionToken = token;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

// requirePerm('a', 'b') => user needs ANY of the listed permissions.
function requirePerm(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (perms.some(p => req.user.permissions.has(p))) return next();
    res.status(403).json({ error: 'You do not have access to this action.' });
  };
}

const can = (req, perm) => !!(req.user && req.user.permissions.has(perm));
const rankOf = role => (ROLES[role] ? ROLES[role].rank : 0);

module.exports = {
  COOKIE, permissionsFor, createSession, setSessionCookie,
  loadUser, requireAuth, requirePerm, can, rankOf,
};
