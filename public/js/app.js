import { state, api, can } from './state.js';
import { esc, icon, avatar, destroyCharts, toast, fmtDate, todayStr, $ } from './ui.js';
import { renderLogin } from './login.js';

// route -> { title, group, icon, perms (any), load() }
const ROUTES = {
  dashboard:  { title: 'Dashboard',        group: 'Overview',   icon: 'dashboard', perms: null, load: () => import('./pages/dashboard.js') },
  production: { title: 'Production',       group: 'Daily work', icon: 'chef',      perms: ['production.view', 'production.log'], load: () => import('./pages/production.js') },
  orders:     { title: 'Cake Orders',      group: 'Daily work', icon: 'cake',      perms: ['orders.view'], load: () => import('./pages/orders.js') },
  closing:    { title: 'Daily Closing',    group: 'Daily work', icon: 'cash',      perms: ['closing.view', 'closing.create'], load: () => import('./pages/closing.js') },
  expenses:   { title: 'Expenses',         group: 'Daily work', icon: 'receipt',   perms: ['expenses.view', 'expenses.create'], load: () => import('./pages/expenses.js') },
  items:      { title: 'Items & Stock',    group: 'Shop',       icon: 'box',       perms: ['items.view'], load: () => import('./pages/items.js') },
  vendors:    { title: 'Vendors',          group: 'Shop',       icon: 'truck',     perms: ['vendors.view'], load: () => import('./pages/vendors.js') },
  documents:  { title: 'Invoices & Docs',  group: 'Shop',       icon: 'folder',    perms: ['documents.view'], load: () => import('./pages/documents.js') },
  reports:    { title: 'Monthly History',  group: 'Insights',   icon: 'chart',     perms: ['reports.view'], load: () => import('./pages/reports.js') },
  staff:      { title: 'Staff & Access',   group: 'Admin',      icon: 'users',     perms: ['users.manage', 'roles.manage'], load: () => import('./pages/staff.js') },
  settings:   { title: 'Settings',         group: 'Admin',      icon: 'settings',  perms: ['settings.manage', 'audit.view'], load: () => import('./pages/settings.js') },
  account:    { title: 'My Account',       group: null,         icon: 'user',      perms: null, load: () => import('./pages/account.js') },
};

const allowed = key => { const r = ROUTES[key]; return r && (!r.perms || can(...r.perms)); };

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, ...rest] = path.split('/').filter(Boolean);
  return { page: page || 'dashboard', params: rest, query: Object.fromEntries(new URLSearchParams(query)) };
}

export function navigate(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

async function boot() {
  applyThemeIcon();
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-theme-toggle]');
    if (t) toggleTheme();
  });
  window.addEventListener('cakery:unauthorized', () => { state.user = null; showLogin(); });
  try {
    await loadMe();
    startApp();
  } catch {
    showLogin();
  }
}

async function loadMe() {
  const me = await api('/auth/me');
  state.user = me.user;
  state.permissions = new Set(me.permissions);
  state.settings = me.settings;
  state.access = me.access || [];
  document.title = `${me.settings.shop_name || 'Cakery'} — Bakery Management`;
}

async function showLogin() {
  destroyCharts();
  window.removeEventListener('hashchange', route);
  let info = {};
  try { info = await api('/auth/public-info'); } catch { /* offline */ }
  renderLogin($('#app'), {
    shopName: info.shop_name, tagline: info.tagline,
    onSuccess: async () => { await loadMe(); startApp(); },
  });
}

function startApp() {
  renderShell();
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  if (state.user.must_change_password) {
    toast('Please set a new password for your account', 'error');
    location.hash = '#/account';
  }
  route();
}

function renderShell() {
  const groups = {};
  for (const [key, r] of Object.entries(ROUTES)) {
    if (!r.group || !allowed(key)) continue;
    (groups[r.group] ||= []).push([key, r]);
  }
  const u = state.user;
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="side-brand"><img src="/img/logo.svg" alt=""><div><b>${esc(state.settings.shop_name || 'Cakery')}</b><small>${esc(state.settings.tagline || 'Bakery management')}</small></div></div>
      <nav class="nav">
        ${Object.entries(groups).map(([g, items]) => `<div class="nav-group">${esc(g)}</div>` +
          items.map(([key, r]) => `<a href="#/${key}" data-route="${key}">${icon(r.icon)}<span>${esc(r.title)}</span><span class="badge hidden" data-badge="${key}"></span></a>`).join('')).join('')}
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <a href="#/account" style="display:contents">${avatar(u.name)}<div class="who"><b>${esc(u.name)}</b><small>${esc(u.role_label)}</small></div></a>
          <button data-logout title="Sign out" aria-label="Sign out">${icon('logout')}</button>
        </div>
      </div>
    </aside>
    <div class="scrim" data-scrim></div>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon menu-btn" data-menu aria-label="Open menu">${icon('menu')}</button>
        <div><h1 data-title>Dashboard</h1><div class="crumb">${esc(fmtDate(todayStr(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-icon" data-theme-toggle aria-label="Toggle theme">${icon(isDark() ? 'sun' : 'moon')}</button>
        <a class="btn btn-ghost" href="#/account" style="gap:10px">${avatar(u.name, 'sm')}<span class="hide-sm">${esc(u.name.split(' ')[0])}</span></a>
      </header>
      <main class="content" id="page"></main>
    </div>
  </div>`;
  const shell = $('.shell');
  $('[data-menu]').onclick = () => shell.classList.add('nav-open');
  $('[data-scrim]').onclick = () => shell.classList.remove('nav-open');
  $('.nav').addEventListener('click', () => shell.classList.remove('nav-open'));
  $('[data-logout]').onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.user = null; location.hash = ''; showLogin();
  };
  refreshBadges();
}

export async function refreshBadges() {
  if (!can('orders.view')) return;
  try {
    const d = await api('/dashboard');
    const n = (d.orders && (d.orders.due_today + d.orders.overdue)) || 0;
    const b = document.querySelector('[data-badge="orders"]');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  } catch { /* ignore */ }
}

let routeSeq = 0;
async function route() {
  if (!state.user) return;
  const { page, params, query } = parseHash();
  const key = ROUTES[page] ? page : 'dashboard';
  const seq = ++routeSeq;
  destroyCharts();
  document.getElementById('modal-root').replaceChildren(); // close dialogs left open by the previous page
  const el = $('#page');
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  $('[data-title]').textContent = ROUTES[key].title;
  if (state.user.must_change_password && key !== 'account') { location.hash = '#/account'; return; }
  if (!allowed(key)) {
    el.innerHTML = `<div class="card"><div class="empty"><div class="em-ico">${icon('lock')}</div><b>No access</b>Your role (${esc(state.user.role_label)}) cannot open this page. Ask the owner if you need access.</div></div>`;
    return;
  }
  el.innerHTML = '<div class="boot" style="min-height:40vh"><div class="boot-cake"></div></div>';
  try {
    const mod = await ROUTES[key].load();
    if (seq !== routeSeq) return;
    el.innerHTML = '';
    el.className = 'content page-enter';
    void el.offsetWidth;
    await mod.default(el, { params, query, navigate, setTitle: t => { $('[data-title]').textContent = t; } });
  } catch (e) {
    if (seq !== routeSeq) return;
    console.error(e);
    el.innerHTML = `<div class="card"><div class="empty"><div class="em-ico">${icon('alert')}</div><b>Could not load this page</b>${esc(e.message)}</div></div>`;
  }
}

/* ---------- theme ---------- */
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cakery-theme', next); } catch { /* ignore */ }
  applyThemeIcon();
  if (state.user && $('#page')) route(); // re-render charts with new colours
}
function applyThemeIcon() {
  document.querySelectorAll('[data-theme-toggle]').forEach(b => { b.innerHTML = icon(isDark() ? 'sun' : 'moon'); });
}

boot();
