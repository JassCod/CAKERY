import { state, api, can, qs } from '../state.js';
import { esc, icon, avatar, fmtDate, fmtDateTime, fmtMonth, todayStr, shiftMonth, money, toast, formModal, confirmDialog, empty, openModal, fieldHtml, debounce } from '../ui.js';
import { attCalendar, countsLine, editDay, cssOnce, WEEKDAYS } from './att-ui.js';

const DOC_TYPES = { id_proof: 'ID proof (Aadhaar / PAN)', address_proof: 'Address proof', photo: 'Photo', contract: 'Joining letter / contract', certificate: 'Certificate', bank: 'Bank details', other: 'Other' };

export default async function staff(el, ctx) {
  cssOnce();
  if (ctx.params[0]) return staffProfile(el, ctx.params[0], ctx);
  let tab = ctx.query.tab === 'roles' ? 'roles' : (can('users.manage', 'staff.view') ? 'staff' : 'roles');
  let rolesData = await api('/users/roles').catch(() => ({ roles: [], groups: [] }));
  let q = '';
  let showDisabled = false;

  async function load() {
    if (tab === 'staff') renderStaff((await api('/users')).users);
    else { rolesData = await api('/users/roles'); renderRoles(); }
  }

  const tabs = () => `<div class="toolbar"><div class="tabs">
    ${can('users.manage', 'staff.view') ? `<button data-tab="staff" class="${tab === 'staff' ? 'active' : ''}">${icon('users')} Staff</button>` : ''}
    ${can('users.manage', 'roles.manage') ? `<button data-tab="roles" class="${tab === 'roles' ? 'active' : ''}">${icon('shield')} Roles & access</button>` : ''}</div><div class="spacer"></div>
    ${tab === 'staff' ? `<div class="search">${icon('search')}<input class="input" data-q placeholder="Search staff…" value="${esc(q)}"></div>
      <label class="check small"><input type="checkbox" data-dis ${showDisabled ? 'checked' : ''}> Show disabled</label>
      ${can('users.manage') ? `<button class="btn btn-primary" data-add>${icon('plus')} Add staff</button>` : ''}` : ''}</div>`;

  const roleLabel = r => (rolesData.roles.find(x => x.key === r) || { label: r.replace('_', ' ') }).label;
  const roleColor = r => (rolesData.roles.find(x => x.key === r) || { color: '#888' }).color;
  const roleBadge = r => `<span class="badge" style="background:${roleColor(r)}1f;color:${roleColor(r)}">${esc(roleLabel(r))}</span>`;

  function renderStaff(users) {
    const list = users.filter(u => (showDisabled || u.active) && (!q || [u.name, u.username, u.phone, u.designation, u.kitchen].join(' ').toLowerCase().includes(q.toLowerCase())));
    const counts = {};
    users.filter(u => u.active).forEach(u => { counts[u.role] = (counts[u.role] || 0) + 1; });
    el.innerHTML = `${tabs()}
    <div class="row mb" style="gap:8px">${rolesData.roles.map(r => `<span class="badge" style="background:${r.color}1f;color:${r.color};padding:6px 12px">${esc(r.label)} · ${counts[r.key] || 0}</span>`).join('')}</div>
    ${list.length ? `<div class="grid g3">${list.map(u => `
      <a class="card vendor-card" href="#/staff/${u.id}" style="color:inherit;text-decoration:none;${u.active ? '' : 'opacity:.55'}">
        <div class="top">${avatar(u.name)}<div style="min-width:0;flex:1"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}
          ${u.id === state.user.id ? '<span class="badge rose">You</span>' : ''}</b>
          <small class="muted">${esc(u.designation || roleLabel(u.role))}${u.kitchen ? ' · ' + esc(u.kitchen) : ''}</small></div></div>
        <div class="row" style="gap:6px">${roleBadge(u.role)}
          ${u.role === 'owner' && !u.can_manage && u.id !== state.user.id ? `<span class="badge">${icon('lock')} senior</span>` : ''}
          ${u.app_access === false ? '<span class="badge">No app login</span>' : ''}
          ${u.active ? '' : '<span class="badge red">Disabled</span>'}</div>
        <div class="small muted row" style="gap:12px">${u.phone ? `${icon('phone')} ${esc(u.phone)}` : ''}
          ${u.date_of_joining ? `<span>Joined ${esc(fmtDate(u.date_of_joining))}</span>` : `<span>${u.last_login ? 'Last login ' + esc(fmtDateTime(u.last_login)) : ''}</span>`}</div>
      </a>`).join('')}</div>`
    : `<div class="card">${empty('No staff found', can('users.manage') ? 'Add your team — with or without an app login.' : '', 'users')}</div>`}
    <p class="small muted mt">${icon('shield')} Staff are never deleted — disabling keeps their history intact. Open a person to see their record, documents, attendance and salary.</p>`;
    bindTabs();
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = () => addStaff();
    el.querySelector('[data-q]').oninput = debounce(e => { q = e.target.value; renderStaff(users); const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); }, 200);
    el.querySelector('[data-dis]').onchange = e => { showDisabled = e.target.checked; renderStaff(users); };
  }

  async function addStaff() {
    const manageable = rolesData.roles.filter(r => r.manageable);
    const kitchens = state.settings.kitchens || [];
    const r = await formModal({
      title: 'Add staff member', size: 'wide',
      fields: [
        { name: 'name', label: 'Full name', required: true },
        { name: 'role', label: 'Role', type: 'select', options: manageable.map(x => [x.key, x.label]), value: 'kitchen_staff', required: true,
          hint: state.user.role === 'owner' ? 'Owner = full access; a new owner cannot change owners added before them.' : '' },
        { name: 'designation', label: 'Job title', placeholder: 'e.g. Head baker, Helper' },
        { name: 'kitchen', label: 'Kitchen', type: 'select', placeholder: '— not in a kitchen —', options: kitchens },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'date_of_joining', label: 'Joining date', type: 'date', value: todayStr() },
        ...(can('salary.manage') ? [
          { name: 'monthly_salary', label: 'Salary amount', type: 'money' },
          { name: 'salary_type', label: 'Salary is per', type: 'select', value: 'monthly', options: [['monthly', 'Month'], ['daily', 'Day (daily wage)']] },
        ] : []),
        { name: 'app_access', label: 'This person will use the app (needs a login)', type: 'checkbox', value: true, full: true },
        { name: 'username', label: 'Username or email', placeholder: 'e.g. ravi.k', hint: 'Used to sign in' },
        { name: 'password', label: 'Temporary password', type: 'text', placeholder: 'min 6 characters', hint: 'They change it at first login' },
      ],
      onMount: (_m, form) => {
        const sync = () => {
          const on = form.elements.app_access.checked;
          for (const n of ['username', 'password']) form.elements[n].closest('.field').style.display = on ? '' : 'none';
        };
        form.elements.app_access.onchange = sync; sync();
      },
      onSubmit: body => {
        if (body.app_access && (!body.username || !body.password)) throw new Error('Username and password are needed for app access');
        return api('/users', { method: 'POST', body });
      },
    });
    if (r) { toast('Staff member added'); ctx.navigate(`#/staff/${r.id}`); }
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
          if ([...r.permissions].sort().join() !== [...perms].sort().join()) await api(`/users/roles/${r.key}`, { method: 'PUT', body: { permissions: perms } });
        }
        toast('Access updated'); load();
      } catch (e) { toast(e.message, 'error'); save.disabled = false; }
    };
  }

  function bindTabs() { el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; load(); }); }
  await load();
}

/* ======================= Staff profile ======================= */
async function staffProfile(el, id, ctx) {
  let tab = ctx.query.tab || 'details';
  let month = todayStr().slice(0, 7);
  const rolesData = await api('/users/roles').catch(() => ({ roles: [] }));

  async function load() {
    const d = await api(`/staff/${id}`);
    const s = d.staff;
    ctx.setTitle(s.name);
    const tabsList = [['details', 'Details'], ['documents', `Documents (${d.documents.length})`],
      ...(can('attendance.manage') || id === state.user.id ? [['attendance', 'Attendance']] : []),
      ...(can('salary.view') ? [['salary', 'Salary']] : [])];
    el.innerHTML = `
    <div class="toolbar"><a class="btn btn-ghost" href="#/staff">${icon('chevLeft')} All staff</a><div class="spacer"></div>
      ${s.can_manage && can('users.manage') && s.id !== state.user.id ? `<button class="btn" data-account>${icon('lock')} Login & role</button>` : ''}
      ${s.can_edit_record ? `<button class="btn btn-primary" data-edit>${icon('edit')} Edit record</button>` : ''}</div>
    <div class="card card-pad mb" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      ${avatar(s.name, 'lg')}
      <div style="flex:1;min-width:200px"><h2 class="serif" style="font-size:26px;font-weight:500">${esc(s.name)}</h2>
        <div class="muted">${esc(s.designation || s.role_label)}${s.kitchen ? ' · ' + esc(s.kitchen) : ''}</div>
        <div class="row" style="gap:6px;margin-top:8px"><span class="badge rose">${esc(s.role_label)}</span>
          ${s.app_access === false ? '<span class="badge">No app login</span>' : `<span class="badge">@${esc(s.username)}</span>`}
          ${s.active ? '<span class="badge green dot">Active</span>' : '<span class="badge red dot">Disabled</span>'}</div></div>
      <div class="row" style="gap:18px">
        ${s.date_of_joining ? `<div><div class="small muted">Joined</div><b>${esc(fmtDate(s.date_of_joining))}</b></div>` : ''}
        ${s.monthly_salary != null ? `<div><div class="small muted">Salary</div><b>${Number(s.monthly_salary) ? money(s.monthly_salary, { dec: false }) + (s.salary_type === 'daily' ? '/day' : '/month') : '—'}</b></div>` : ''}
        ${s.phone ? `<div><div class="small muted">Phone</div><b><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></b></div>` : ''}
      </div>
    </div>
    <div class="toolbar"><div class="tabs">${tabsList.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${esc(l)}</button>`).join('')}</div></div>
    <div data-panel></div>`;

    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/staff/${id}?tab=${tab}`); load(); });
    const edit = el.querySelector('[data-edit]');
    if (edit) edit.onclick = () => editRecord(s);
    const acc = el.querySelector('[data-account]');
    if (acc) acc.onclick = () => editAccount(s);
    const panel = el.querySelector('[data-panel]');
    if (tab === 'documents') return renderDocs(panel, s, d.documents);
    if (tab === 'attendance') return renderAttendance(panel, s);
    if (tab === 'salary') { ctx.navigate(`#/salary/${id}`); return; }
    const row = (l, v) => `<div class="summary-line"><span class="muted">${esc(l)}</span><b style="text-align:right">${v ? esc(v) : '<span class="muted">—</span>'}</b></div>`;
    panel.innerHTML = `<div class="grid g2">
      <div class="card card-pad"><h3 style="margin-bottom:8px">Personal</h3>
        ${row('Phone', s.phone)}${row('Date of birth', s.date_of_birth && fmtDate(s.date_of_birth))}${row('Address', s.address)}${row('Emergency contact', s.emergency_contact)}${row('ID number', s.id_proof)}</div>
      <div class="card card-pad"><h3 style="margin-bottom:8px">Work</h3>
        ${row('Role', s.role_label)}${row('Job title', s.designation)}${row('Kitchen', s.kitchen)}${row('Joining date', s.date_of_joining && fmtDate(s.date_of_joining))}
        ${row('Weekly off', s.week_off != null ? WEEKDAYS[s.week_off] : '')}
        ${s.monthly_salary != null ? row('Salary', Number(s.monthly_salary) ? `${money(s.monthly_salary)} per ${s.salary_type === 'daily' ? 'day' : 'month'}` : '') + row('Bank / UPI', s.bank_details) : ''}
        ${s.staff_notes ? `<div class="small muted" style="margin-top:8px">${esc(s.staff_notes)}</div>` : ''}</div></div>`;
  }

  async function editRecord(s) {
    const kitchens = state.settings.kitchens || [];
    const r = await formModal({
      title: `Staff record · ${s.name}`, size: 'wide',
      fields: [
        { name: 'name', label: 'Full name', value: s.name, required: true },
        { name: 'phone', label: 'Phone', type: 'tel', value: s.phone || '' },
        { name: 'designation', label: 'Job title', value: s.designation || '' },
        { name: 'kitchen', label: 'Kitchen', type: 'select', placeholder: '— not in a kitchen —', options: kitchens, value: s.kitchen || '' },
        { name: 'date_of_joining', label: 'Joining date', type: 'date', value: s.date_of_joining || '' },
        { name: 'date_of_birth', label: 'Date of birth', type: 'date', value: s.date_of_birth || '' },
        { name: 'week_off', label: 'Weekly off day', type: 'select', placeholder: '— none —', options: WEEKDAYS.map((w, i) => [String(i), w]), value: s.week_off ?? '' },
        { name: 'id_proof', label: 'ID number (Aadhaar / PAN)', value: s.id_proof || '' },
        { name: 'emergency_contact', label: 'Emergency contact', value: s.emergency_contact || '', placeholder: 'name & phone' },
        ...(can('salary.manage') ? [
          { name: 'monthly_salary', label: 'Salary amount', type: 'money', value: s.monthly_salary ?? '' },
          { name: 'salary_type', label: 'Salary is per', type: 'select', value: s.salary_type || 'monthly', options: [['monthly', 'Month'], ['daily', 'Day (daily wage)']] },
          { name: 'bank_details', label: 'Bank / UPI for salary', value: s.bank_details || '', full: true },
        ] : []),
        { name: 'address', label: 'Address', type: 'textarea', value: s.address || '', full: true },
        { name: 'staff_notes', label: 'Notes', type: 'textarea', value: s.staff_notes || '', full: true },
      ],
      onSubmit: body => api(`/staff/${s.id}`, { method: 'PUT', body }),
    });
    if (r) { toast('Record saved'); load(); }
  }

  async function editAccount(s) {
    const manageable = rolesData.roles.filter(r => r.manageable);
    const r = await formModal({
      title: `Login & role · ${s.name}`,
      fields: [
        { name: 'name', label: 'Full name', value: s.name, required: true },
        { name: 'role', label: 'Role', type: 'select', options: manageable.map(x => [x.key, x.label]), value: s.role, required: true },
        { name: 'phone', label: 'Phone', type: 'tel', value: s.phone || '' },
        { name: 'password', label: 'Reset password', type: 'text', placeholder: 'leave empty to keep', hint: 'They must change it at next login' },
        { name: 'app_access', label: 'Can sign in to the app', type: 'checkbox', value: s.app_access !== false },
        { name: 'active', label: 'Active (untick to disable this person)', type: 'checkbox', value: !!s.active },
      ],
      onSubmit: body => api(`/users/${s.id}`, { method: 'PUT', body }),
    });
    if (r) { toast('Saved'); load(); }
  }

  function renderDocs(panel, s, docs) {
    const manage = can('staff.manage');
    panel.innerHTML = `<div class="card">
      <div class="card-head"><h3>${icon('folder')} ${esc(s.name)}'s documents</h3><div class="spacer"></div>
        ${manage ? `<button class="btn btn-primary btn-sm" data-up>${icon('upload')} Upload</button>` : ''}</div>
      ${docs.length ? `<div class="doc-grid" style="padding-top:18px">${docs.map(d => {
        const ext = (d.original_name.split('.').pop() || '').toUpperCase();
        const img = /^image\//.test(d.mime || '') && d.url;
        return `<div class="doc"><a class="thumb" href="${esc(d.url || '#')}" target="_blank" rel="noopener">${img ? `<img src="${esc(d.url)}" alt="" loading="lazy">` : `<span class="ext">${esc(ext)}</span>`}</a>
          <b title="${esc(d.title)}">${esc(d.title)}</b><div class="small muted">${esc(DOC_TYPES[d.doc_type] || d.doc_type)}<br>${esc(fmtDate(d.created_at))}</div>
          <div class="row" style="gap:6px"><a class="btn btn-sm" href="${esc(d.url || '#')}" target="_blank" rel="noopener">${icon('eye')} View</a>
            <a class="btn btn-sm btn-ghost btn-icon" href="${esc(d.download_url || d.url || '#')}" title="Download">${icon('download')}</a>
            ${manage ? `<button class="btn btn-sm btn-ghost btn-icon" data-deldoc="${d.id}">${icon('trash')}</button>` : ''}</div></div>`;
      }).join('')}</div>` : empty('No documents yet', 'Keep ID proof, address proof, photo and joining papers here.', 'folder')}
    </div>`;
    const up = panel.querySelector('[data-up]');
    if (up) up.onclick = () => uploadDialog(s);
    panel.querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('Delete this document permanently?'))) return;
      try { await api(`/staff/${s.id}/documents/${b.dataset.deldoc}`, { method: 'DELETE' }); toast('Document deleted'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  function uploadDialog(s) {
    openModal({
      title: `Upload for ${s.name}`,
      body: `<form class="form-grid" novalidate><div class="form-error hidden full"></div>
        <div class="full"><input class="input" type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"></div>
        ${fieldHtml({ name: 'doc_type', label: 'Type', type: 'select', options: Object.entries(DOC_TYPES), value: 'id_proof' })}
        ${fieldHtml({ name: 'title', label: 'Title', placeholder: 'defaults to file name' })}</form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go>${icon('upload')} Upload</button>`,
      onMount: m => {
        const form = m.el.querySelector('form');
        const err = m.el.querySelector('.form-error');
        m.el.querySelector('[data-go]').onclick = async e => {
          const files = [...form.elements.files.files];
          if (!files.length) { err.textContent = 'Choose at least one file'; err.classList.remove('hidden'); return; }
          const fd = new FormData();
          files.forEach(f => fd.append('files', f));
          fd.append('staff_name', s.name); fd.append('doc_type', form.elements.doc_type.value); fd.append('title', form.elements.title.value);
          e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span> Uploading…';
          try { await api(`/staff/${s.id}/documents`, { method: 'POST', form: fd }); m.close(); toast('Uploaded'); load(); }
          catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); e.target.disabled = false; e.target.innerHTML = `${icon('upload')} Upload`; }
        };
      },
    });
  }

  async function renderAttendance(panel, s) {
    const d = await api(`/attendance/staff/${s.id}` + qs({ month }));
    const manage = can('attendance.manage');
    panel.innerHTML = `<div class="card">
      <div class="card-head"><button class="btn btn-sm btn-icon" data-mprev>${icon('chevLeft')}</button><h3 style="min-width:140px;text-align:center">${esc(fmtMonth(month))}</h3>
        <button class="btn btn-sm btn-icon" data-mnext ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button><div class="spacer"></div>
        ${manage ? '<span class="small muted">Click a day to correct it</span>' : ''}</div>
      <div class="card-body">${attCalendar(d.days)}<div class="row mt" style="gap:6px">${countsLine(d.counts)}</div></div></div>`;
    panel.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); renderAttendance(panel, s); };
    panel.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); renderAttendance(panel, s); };
    if (manage) panel.querySelectorAll('[data-aday]').forEach(b => b.onclick = async () => {
      const day = d.days.find(x => x.date === b.dataset.aday);
      if (day && day.status !== 'upcoming' && await editDay(s.id, s.name, day)) renderAttendance(panel, s);
    });
  }

  await load();
}
