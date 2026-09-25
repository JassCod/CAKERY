import { call } from './backend.js';
// Global client state + API client.
export const state = { user: null, permissions: new Set(), settings: {}, access: [] };

export const can = (...perms) => perms.some(p => state.permissions.has(p));

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  try {
    return await call(path, { method, body, form });
  } catch (e) {
    const status = e.status || 0;
    if (status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('cakery:unauthorized'));
    const offline = !status && /fetch|network/i.test(e.message || '');
    throw new ApiError(status, offline ? 'Cannot reach the server. Check your internet connection.' : (e.message || 'Request failed'));
  }
}

export const qs = obj => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};
