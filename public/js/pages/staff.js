import { state, api, can } from '../state.js';
import { esc, icon, avatar, fmtDateTime, toast, formModal, confirmDialog, empty } from '../ui.js';

export default async function staff(el) {
  let tab = can('users.manage') ? 'staff' : 'roles';
  let rolesData = await api('/users/roles');

  async function load() {
    if (tab === 'staff') {
      const { users } = await api('/users');
      renderStaff(users);
    } else {
      rolesData = await api('/users/roles');
      renderRoles();
    }
  }

  const tabs = () => `<div class="toolbar"><div class="tabs">
    ${can('users.manage') ? `<button data-tab="staff" class="${tab === 'staff' ? 'active' : ''}">${icon('users')} Staff accounts</button>` : ''}
    <button data-tab="roles" class="${tab === 'roles' ? 'active' : ''}">${icon('shield')} Roles & access</button></div><div class="spacer"></div>
    ${tab === 'staff' ? `<button class="btn btn-primary" data-add>${icon('plus')} Add staff</button>` : ''}</div>`;

  const roleLabel = r => (rolesData.roles.find(x => x.key === r) || { label: r }).label;
  const roleColor = r => (rolesData.roles.find(x => x.key === r) || { color: '#888' }).color;
  const roleBadge = r => `<span class="badge" style="background:${roleColor(r)}1f;color:${roleColor(r)}">${esc(roleLabel(r))}</span>`;
  const manageable = rolesData.roles.filter(r => r.manageable);

  function renderStaff(users) {
    const counts = {};
    users.filter(u => u.active).forEach(u => { counts[u.role] = (counts[u.role] || 0) + 1; });
    el.innerHTML = `${tabs()}
    <div class="row mb" style="gap:8px">${rolesData.roles.map(r => `<span class="badge" style="background:${r.color}1f;color:${r.color};padding:6px 12px">${esc(r.label)} · ${counts[r.key] || 0}</span>`).join('')}</div>
    <div class="card">${users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Phone</th><th>Last login</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map(u => {
        const canEdit = u.id !== state.user.id && rolesData.roles.find(r => r.key === u.role)?.manageable;
        return `<tr style="${u.active ? '' : 'opacity:.55'}"><td><span class="row" style="gap:10px;flex-wrap:nowrap">${avatar(u.name, 'sm')}<b>${esc(u.name)}</b>${u.id === state.user.id ? '<span class="badge rose">You</span>' : ''}</span></td>
        <td class="small">${esc(u.username)}</td><td>${roleBadge(u.role)}</td><td class="small">${esc(u.phone || '—')}</td>
        <td class="small muted">${u.last_login ? esc(fmtDateTime(u.last_login)) : 'Never'}</td>
        <td>${u.active ? '<span class="badge green dot">Active</span>' : '<span class="badge dot">Disabled</span>'}</td>
        <td><div class="actions">${canEdit ? `<button class="btn btn-sm btn-ghost btn-icon" data-edit="${u.id}" title="Edit">${icon('edit')}</button>
          ${u.active ? `<button class="btn btn-sm btn-ghost btn-icon" data-off="${u.id}" title="Disable">${icon('lock')}</button>` : ''}` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>` : empty('No staff yet', '', 'users')}</div>
    <p class="small muted mt">${icon('shield')} Staff are never deleted — disabling keeps their history (expenses, production, closings) intact. New and reset passwords must be changed at first login.</p>`;

    bindTabs();
    el.querySelector('[data-add]').onclick = () => edit();
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(users.find(u => String(u.id) === b.dataset.edit)));
    el.querySelectorAll('[data-off]').forEach(b => b.onclick = async () => {
      const u = users.find(x => String(x.id) === b.dataset.off);
      if (!(await confirmDialog(`Disable ${u.name}? They will be signed out and cannot log in.`, { okText: 'Disable' }))) return;
      try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('Account disabled'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function edit(u) {
    const r = await formModal({
      title: u ? `Edit ${u.name}` : 'Add staff member',
      fields: [
        { name: 'name', label: 'Full name', value: u?.name, required: true },
        { name: 'role', label: 'Role', type: 'select', options: manageable.map(x => [x.key, x.label]), value: u?.role || 'cashier', required: true },
        ...(u ? [] : [{ name: 'username', label: 'Username', required: true, placeholder: 'e.g. ravi.k', hint: 'Used to sign in' }]),
        { name: 'phone', label: 'Phone', type: 'tel', value: u?.phone || '' },
        { name: 'password', label: u ? 'Reset password' : 'Temporary password', type: 'text', required: !u, placeholder: u ? 'leave empty to keep' : 'min 6 characters', hint: 'They will be asked to change it on first login' },
        ...(u ? [{ name: 'active', label: 'Account active', type: 'checkbox', value: !!u.active }] : []),
      ],
      onSubmit: body => api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body }),
    });
    if (r) { toast(u ? 'Staff updated' : 'Staff account created'); load(); }
  }

  function renderRoles() {
    const editable = can('roles.manage');
    const roles = rolesData.roles;
    el.innerHTML = `${tabs()}
    <div class="card">
      <div class="card-head"><h3>Who can do what</h3><div class="spacer"></div>
        ${editable ? `<span class="small muted">Tick to grant, then save.</span><button class="btn btn-primary btn-sm" data-save>${icon('check')} Save changes</button>` : '<span class="small muted">Only the owner can change access.</span>'}</div>
      <div class="table-wrap"><table class="table perm-table">
        <thead><tr><th>Permission</th>${roles.map(r => `<th class="role"><span style="color:${r.color}">${esc(r.label)}</span><div class="small muted" style="text-transform:none;letter-spacing:0;font-weight:500">${r.users} user${r.users === 1 ? '' : 's'}</div></th>`).join('')}</tr></thead>
        <tbody>${rolesData.groups.map(g => `<tr class="perm-group"><td colspan="${roles.length + 1}">${esc(g.group)}</td></tr>` + g.items.map(([key, label]) => `<tr>
          <td>${esc(label)}<div class="small muted">${esc(key)}</div></td>
          ${roles.map(r => `<td class="c"><input type="checkbox" style="width:17px;height:17px;accent-color:${r.color}" data-role="${r.key}" data-perm="${key}" ${r.permissions.includes(key) ? 'checked' : ''} ${editable && r.key !== 'owner' ? '' : 'disabled'} aria-label="${esc(r.label)}: ${esc(label)}"></td>`).join('')}
        </tr>`).join('')).join('')}</tbody></table></div>
      <div class="card-foot small muted">${icon('lock')} The Owner always has full access. Changes apply to staff immediately on their next click.</div>
    </div>`;
    bindTabs();
    const save = el.querySelector('[data-save]');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        for (const r of roles) {
          if (r.key === 'owner') continue;
          const perms = [...el.querySelectorAll(`input[data-role="${r.key}"]:checked`)].map(i => i.dataset.perm);
          const before = [...r.permissions].sort().join();
          if (before !== [...perms].sort().join()) await api(`/users/roles/${r.key}`, { method: 'PUT', body: { permissions: perms } });
        }
        toast('Access updated'); load();
      } catch (e) { toast(e.message, 'error'); save.disabled = false; }
    };
  }

  function bindTabs() { el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; load(); }); }
  await load();
}
