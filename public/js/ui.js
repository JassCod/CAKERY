// Shared UI helpers: escaping, formatting, icons, modals, forms, toasts, charts.
import { state } from './state.js';

/* ---------- escaping & templating ---------- */
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- formatting ---------- */
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const cur = () => (state.settings && state.settings.currency) || '₹';
export const money = (n, { dec = true } = {}) => {
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + cur() + (dec ? nf : nf0).format(Math.abs(v));
};
export const moneyShort = n => {
  const v = Math.abs(Number(n) || 0);
  const s = v >= 1e7 ? (v / 1e7).toFixed(2) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(2) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : nf0.format(v);
  return (n < 0 ? '-' : '') + cur() + s;
};
export const num = n => nf.format(Number(n) || 0);
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function todayStr() {
  const tz = state.settings && state.settings.timezone;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
export const thisMonth = () => todayStr().slice(0, 7);
export function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
export function shiftMonth(m, n) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); }
export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!d) return '—';
  const x = new Date(d.length === 10 ? d + 'T00:00:00' : d.replace(' ', 'T') + (d.length === 19 ? 'Z' : ''));
  return isNaN(x) ? d : x.toLocaleDateString('en-IN', opts);
};
export const fmtDay = d => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtMonth = m => fmtDate(m + '-01', { month: 'long', year: 'numeric' });
export const fmtDateTime = d => {
  if (!d) return '—';
  const x = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(d) ? d : d.replace(' ', 'T') + 'Z');
  return isNaN(x) ? d : x.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export function relDay(d) {
  const t = todayStr();
  if (d === t) return 'Today';
  if (d === addDays(t, 1)) return 'Tomorrow';
  if (d === addDays(t, -1)) return 'Yesterday';
  return fmtDay(d);
}
export const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
const AV_COLORS = ['#c43c6b', '#7b4bb7', '#1f8a70', '#d9822b', '#2b7bd9', '#b8336a', '#8a5a44', '#3f7f3f'];
export const avatar = (name, cls = '') => {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${cls}" style="background:${AV_COLORS[h % AV_COLORS.length]}">${esc(initials(name))}</span>`;
};
export const MODE_LABEL = { cash: 'Cash', online: 'Online / UPI', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque' };

/* ---------- icons (lucide-style strokes) ---------- */
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chef: '<path d="M6 13.9A4 4 0 1 1 8.4 6.3a4.5 4.5 0 0 1 7.2 0A4 4 0 1 1 18 13.9V20H6z"/><path d="M6 17h12"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v13H5a2 2 0 0 1-2-2V5"/><circle cx="16" cy="13" r="1.3"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cake: '<path d="M4 21V13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M4 16c1.5 0 1.5 1.5 3 1.5s1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5M2 21h20M12 11V7"/><path d="M12 3c1 1 1 2.2 0 3-1-.8-1-2 0-3z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5-5.9M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  store: '<path d="M3 9 4.5 4h15L21 9M3 9v11h18V9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.box}</svg>`;

/* ---------- toasts ---------- */
export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- modal ---------- */
export function openModal({ title, body, foot = '', size = '', onMount }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(wrap);
  const prevFocus = document.activeElement;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) wrap.dataset.down = '1'; });
  wrap.addEventListener('mouseup', e => { if (e.target === wrap && wrap.dataset.down) close(); delete wrap.dataset.down; });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  const m = { el: wrap, close };
  onMount && onMount(m);
  const first = wrap.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return m;
}

export function confirmDialog(message, { title = 'Are you sure?', okText = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, size: 'narrow',
      body: `<p style="margin:0;color:var(--text-2)">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onMount: ({ el, close }) => {
        el.querySelector('[data-ok]').onclick = () => { done = true; close(); resolve(true); };
        new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } }).observe(document.getElementById('modal-root'), { childList: true });
      },
    });
    return m;
  });
}

/* ---------- form builder ----------
   fields: [{ name, label, type: text|number|money|date|select|textarea|checkbox|password|file|datalist|html,
              options: [[value,label]] | [value], required, value, full, hint, placeholder, step, min, attrs }] */
export function fieldHtml(f) {
  if (f.type === 'html') return `<div class="${f.full ? 'full' : ''}">${f.html}</div>`;
  const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
  const v = f.value ?? '';
  const req = f.required ? 'required' : '';
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
  const attrs = f.attrs || '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea class="textarea" id="${id}" name="${f.name}" ${req} ${ph} ${attrs}>${esc(v)}</textarea>`; break;
    case 'select': {
      const opts = (f.options || []).map(o => (Array.isArray(o) ? o : [o, o]))
        .map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('');
      input = `<select class="select" id="${id}" name="${f.name}" ${req} ${attrs}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts}</select>`; break;
    }
    case 'checkbox':
      return `<div class="${f.full ? 'full' : ''}"><label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''} ${attrs}> ${esc(f.label)}</label>${f.hint ? `<div class="hint small muted">${esc(f.hint)}</div>` : ''}</div>`;
    case 'money':
      input = `<div class="input-prefix"><span>${esc(cur())}</span><input class="input num" type="number" inputmode="decimal" step="0.01" min="${f.min ?? 0}" id="${id}" name="${f.name}" value="${esc(v)}" ${req} ${ph} ${attrs}></div>`; break;
    case 'datalist': {
      const listId = id + '_l';
      input = `<input class="input" id="${id}" name="${f.name}" value="${esc(v)}" list="${listId}" ${req} ${ph} ${attrs} autocomplete="off"><datalist id="${listId}">${(f.options || []).map(o => `<option value="${esc(o)}">`).join('')}</datalist>`; break;
    }
    case 'file':
      input = `<input class="input" type="file" id="${id}" name="${f.name}" ${f.multiple ? 'multiple' : ''} ${req} ${attrs}>`; break;
    default:
      input = `<input class="input ${f.type === 'number' ? 'num' : ''}" type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(v)}"
        ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${req} ${ph} ${attrs}>`;
  }
  return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'file') out[el.name] = el.files;
    else out[el.name] = el.value;
  }
  return out;
}

// Opens a modal with a form; onSubmit(values) may throw to show an error. Resolves with the result.
export function formModal({ title, fields, submitText = 'Save', size = '', intro = '', onSubmit, onMount }) {
  return new Promise(resolve => {
    let result;
    openModal({
      title, size,
      body: `<form novalidate>${intro}<div class="form-error hidden"></div><div class="form-grid">${fields.map(fieldHtml).join('')}</div><button type="submit" hidden></button></form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-submit>${esc(submitText)}</button>`,
      onMount: m => {
        const form = m.el.querySelector('form');
        const errBox = m.el.querySelector('.form-error');
        const btn = m.el.querySelector('[data-submit]');
        const submit = async e => {
          e && e.preventDefault();
          for (const el of form.elements) {
            if (el.required && !el.value && el.type !== 'checkbox') {
              errBox.textContent = `${el.closest('.field')?.querySelector('label')?.textContent.replace('*', '').trim() || el.name} is required`;
              errBox.classList.remove('hidden'); el.focus(); return;
            }
          }
          errBox.classList.add('hidden');
          btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Saving…';
          try { result = await onSubmit(readForm(form), form); m.close(); resolve(result); }
          catch (err) { errBox.textContent = err.message || String(err); errBox.classList.remove('hidden'); }
          finally { btn.disabled = false; btn.innerHTML = label; }
        };
        form.addEventListener('submit', submit);
        btn.addEventListener('click', submit);
        const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (result === undefined) resolve(null); } });
        obs.observe(document.getElementById('modal-root'), { childList: true });
        onMount && onMount(m, form);
      },
    });
  });
}

/* ---------- small render helpers ---------- */
export const empty = (title, text = '', ico = 'box', action = '') =>
  `<div class="empty"><div class="em-ico">${icon(ico)}</div><b>${esc(title)}</b>${text ? `<div>${esc(text)}</div>` : ''}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;

export const statusBadge = (s, map) => {
  const [label, color] = map[s] || [s, ''];
  return `<span class="badge dot ${color}">${esc(label)}</span>`;
};

export const delta = (curr, prev, { invert = false } = {}) => {
  if (!prev) return '';
  const d = Math.round(((curr - prev) / Math.abs(prev)) * 100);
  if (!Number.isFinite(d)) return '';
  const good = invert ? d <= 0 : d >= 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
};

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- charts ---------- */
const charts = new Set();
export function destroyCharts() { for (const c of charts) c.destroy(); charts.clear(); }
export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
export const PALETTE = ['#c43c6b', '#d98e3d', '#2f9e7a', '#5b6ee1', '#9b59b6', '#e0607e', '#3aa0c9', '#b0833b', '#7d8b3a', '#8a5a44', '#c0392b', '#6c7a89'];

export function makeChart(canvas, config) {
  if (!window.Chart || !canvas) return null;
  const Chart = window.Chart;
  Chart.defaults.font.family = cssVar('--font') || 'sans-serif';
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--border');
  const c = new Chart(canvas, config);
  charts.add(c);
  return c;
}
export const moneyTick = v => moneyShort(v);
