import { state, api, can, qs } from '../state.js';
import { esc, icon, fmtDateTime, toast, empty, fieldHtml, readForm, debounce } from '../ui.js';

export default async function settings(el) {
  let tab = can('settings.manage') ? 'general' : 'audit';
  let page = 1;
  let q = '';

  async function load() {
    const tabs = `<div class="toolbar"><div class="tabs">
      ${can('settings.manage') ? `<button data-tab="general" class="${tab === 'general' ? 'active' : ''}">${icon('store')} Shop</button>
      <button data-tab="categories" class="${tab === 'categories' ? 'active' : ''}">${icon('layers')} Categories</button>` : ''}
      ${can('audit.view') ? `<button data-tab="audit" class="${tab === 'audit' ? 'active' : ''}">${icon('history')} Activity log</button>` : ''}
      ${can('settings.manage') ? `<button data-tab="backup" class="${tab === 'backup' ? 'active' : ''}">${icon('database')} Backup</button>` : ''}
    </div></div>`;
    if (tab === 'general' || tab === 'categories') {
      const { settings: s } = await api('/admin/settings');
      el.innerHTML = tabs + (tab === 'general' ? `
      <div class="card" style="max-width:760px"><div class="card-head"><h3>Shop details</h3></div>
        <form class="card-body form-grid" data-form>
          ${fieldHtml({ name: 'shop_name', label: 'Shop name', value: s.shop_name, required: true })}
          ${fieldHtml({ name: 'tagline', label: 'Tagline', value: s.tagline })}
          ${fieldHtml({ name: 'currency', label: 'Currency symbol', value: s.currency, required: true, hint: 'e.g. ₹, $, £, AED' })}
          ${fieldHtml({ name: 'timezone', label: 'Time zone', type: 'datalist', value: s.timezone, options: ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'Asia/Singapore'], hint: 'Decides when "today" starts' })}
          ${fieldHtml({ name: 'phone', label: 'Phone', value: s.phone })}
          ${fieldHtml({ name: 'address', label: 'Address', value: s.address })}
        </form>
        <div class="card-foot"><div style="flex:1"></div><button class="btn btn-primary" data-save>${icon('check')} Save</button></div></div>`
      : `<div class="grid g2">
        ${catCard('expense_categories', 'Expense categories', s.expense_categories)}
        ${catCard('item_categories', 'Item categories', s.item_categories)}
      </div><div class="row mt"><div style="flex:1"></div><button class="btn btn-primary" data-save>${icon('check')} Save categories</button></div>`);
      bindTabs();
      el.querySelector('[data-save]').onclick = async () => {
        try {
          let body;
          if (tab === 'general') body = { ...s, ...readForm(el.querySelector('[data-form]')) };
          else body = { ...s, expense_categories: lines('expense_categories'), item_categories: lines('item_categories') };
          delete body.expense_categories_raw;
          if (tab === 'general') { delete body.expense_categories; delete body.item_categories; }
          const r = await api('/admin/settings', { method: 'PUT', body });
          state.settings = r.settings;
          toast('Settings saved');
          if (tab === 'general') setTimeout(() => location.reload(), 500);
        } catch (e) { toast(e.message, 'error'); }
      };
    } else if (tab === 'audit') {
      const { logs } = await api('/admin/audit' + qs({ page, q }));
      el.innerHTML = tabs + `
      <div class="toolbar"><div class="search">${icon('search')}<input class="input" data-q placeholder="Search actions…" value="${esc(q)}"></div><div class="spacer"></div>
        <button class="btn btn-sm" data-prev ${page <= 1 ? 'disabled' : ''}>${icon('chevLeft')} Newer</button><span class="small muted">Page ${page}</span><button class="btn btn-sm" data-next ${logs.length < 100 ? 'disabled' : ''}>Older ${icon('chevRight')}</button></div>
      <div class="card">${logs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>${logs.map(l => `<tr><td class="small nowrap">${esc(fmtDateTime(l.created_at))}</td><td class="small nowrap"><b>${esc(l.user_name || 'System')}</b><div class="muted">${esc(l.user_role || '')}</div></td>
          <td><span class="badge ${/delete|failed|deactivated/.test(l.action) ? 'red' : /created|logged|login$/.test(l.action) ? 'green' : 'blue'}">${esc(l.action.replace(/_/g, ' '))}</span></td>
          <td class="small muted" style="max-width:520px;word-break:break-word">${esc(prettyDetails(l.details))}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No activity', '', 'history')}</div>`;
      bindTabs();
      el.querySelector('[data-q]').oninput = debounce(e => { q = e.target.value; page = 1; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350);
      el.querySelector('[data-prev]').onclick = () => { page--; load(); };
      el.querySelector('[data-next]').onclick = () => { page++; load(); };
    } else {
      el.innerHTML = tabs + `
      <div class="card card-pad" style="max-width:640px">
        <div class="row" style="gap:16px;flex-wrap:nowrap;align-items:flex-start"><span class="avatar tone-blue" style="width:48px;height:48px">${icon('database')}</span>
        <div><h3>Download a full backup</h3><p class="muted">One file containing every record — items, production, closings, expenses, vendors, bills, payments, orders, staff and the activity log.
          Keep it somewhere safe (Google Drive, a pen drive). Uploaded invoice files live in the <code>data/uploads</code> folder on the server — copy that folder too.</p>
          <a class="btn btn-primary" href="/api/admin/backup">${icon('download')} Download backup</a></div></div>
      </div>`;
      bindTabs();
    }
  }

  function catCard(name, title, list) {
    return `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div><div class="card-body">
      <textarea class="textarea" data-cat="${name}" rows="14" style="min-height:280px">${esc((list || []).join('\n'))}</textarea>
      <div class="hint small muted" style="margin-top:6px">One per line. These appear as suggestions; staff can still type new ones.</div></div></div>`;
  }
  function lines(name) { return el.querySelector(`[data-cat="${name}"]`).value.split('\n').map(s => s.trim()).filter(Boolean); }
  function bindTabs() { el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; page = 1; load(); }); }
  await load();
}

function prettyDetails(d) {
  if (!d) return '';
  try {
    const o = JSON.parse(d);
    return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  } catch { return d; }
}
