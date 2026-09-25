'use strict';
const { getSetting } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function today() {
  const tz = getSetting('timezone') || undefined;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  }
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthRange(month) {
  if (!MONTH_RE.test(month || '')) throw new HttpError(400, 'Month must be YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, days: last };
}

// Small input validator: v.str('name', {required:true, max:100})
function validator(body) {
  body = body || {};
  const str = (key, { required = false, max = 500, label = key } = {}) => {
    let v = body[key];
    if (v == null || v === '') {
      if (required) throw new HttpError(400, `${label} is required`);
      return null;
    }
    v = String(v).trim();
    if (required && !v) throw new HttpError(400, `${label} is required`);
    if (v.length > max) throw new HttpError(400, `${label} is too long`);
    return v || null;
  };
  const num = (key, { required = false, min = -Infinity, max = Infinity, label = key, def = null } = {}) => {
    const raw = body[key];
    if (raw == null || raw === '') {
      if (required) throw new HttpError(400, `${label} is required`);
      return def;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new HttpError(400, `${label} must be a number`);
    if (v < min) throw new HttpError(400, `${label} must be at least ${min}`);
    if (v > max) throw new HttpError(400, `${label} must be at most ${max}`);
    return Math.round(v * 100) / 100;
  };
  const date = (key, { required = false, label = key } = {}) => {
    const v = body[key];
    if (v == null || v === '') {
      if (required) throw new HttpError(400, `${label} is required`);
      return null;
    }
    if (!DATE_RE.test(String(v))) throw new HttpError(400, `${label} must be a valid date`);
    return String(v);
  };
  const oneOf = (key, options, { def, label = key } = {}) => {
    const v = body[key] == null || body[key] === '' ? def : body[key];
    if (!options.includes(v)) throw new HttpError(400, `${label} is invalid`);
    return v;
  };
  const id = (key, { required = false, label = key } = {}) => {
    const v = body[key];
    if (v == null || v === '') {
      if (required) throw new HttpError(400, `${label} is required`);
      return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} is invalid`);
    return n;
  };
  const bool = (key, def = false) => (body[key] == null ? def : body[key] === true || body[key] === 1 || body[key] === '1' || body[key] === 'true');
  return { str, num, date, oneOf, id, bool };
}

// Wrap route handlers so thrown errors reach the error middleware.
const h = fn => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { HttpError, today, addDays, monthRange, validator, h, round2, DATE_RE, MONTH_RE };
