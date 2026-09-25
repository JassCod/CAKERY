// Global client state + API client.
export const state = { user: null, permissions: new Set(), settings: {}, access: [] };

export const can = (...perms) => perms.some(p => state.permissions.has(p));

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'cakery' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, opts); }
  catch { throw new ApiError(0, 'Cannot reach the server. Check your connection.'); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('cakery:unauthorized'));
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export const qs = obj => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};
