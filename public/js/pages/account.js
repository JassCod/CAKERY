import { state, api } from '../state.js';
import { esc, icon, avatar, toast, fieldHtml, readForm } from '../ui.js';

export default async function account(el) {
  const u = state.user;
  el.innerHTML = `
  ${u.must_change_password ? `<div class="card card-pad mb" style="border-color:var(--warning);background:var(--warning-50)"><b>${icon('alert')} Please set your own password</b><div class="small">Your account uses a temporary password. Choose a new one to continue.</div></div>` : ''}
  <div class="grid g2">
    <div class="card card-pad">
      <div class="row" style="gap:16px;flex-wrap:nowrap">${avatar(u.name, 'lg')}
        <div><h2 style="font-size:22px">${esc(u.name)}</h2><div class="muted">@${esc(u.username)} · ${esc(u.role_label)}</div></div></div>
      <div class="mt"><b class="small">What you can do</b>
        ${state.access.length ? state.access.map(g => `<div style="margin-top:12px"><div class="small muted" style="font-weight:700">${esc(g.group)}</div>
          <div class="row" style="gap:6px;margin-top:6px">${g.items.map(l => `<span class="badge green">${icon('check')} ${esc(l)}</span>`).join('')}</div></div>`).join('')
          : '<div class="muted small" style="margin-top:8px">No permissions yet — ask the owner.</div>'}</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${icon('lock')} Change password</h3></div>
      <form class="card-body" data-form style="display:grid;gap:14px" novalidate>
        <div class="form-error hidden"></div>
        ${fieldHtml({ name: 'current_password', label: 'Current password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        ${fieldHtml({ name: 'new_password', label: 'New password', type: 'password', required: true, hint: 'At least 6 characters', attrs: 'autocomplete="new-password"' })}
        ${fieldHtml({ name: 'confirm', label: 'Confirm new password', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}
        <div><button class="btn btn-primary" type="submit">${icon('check')} Update password</button></div>
      </form>
    </div>
  </div>`;
  const form = el.querySelector('[data-form]');
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = readForm(form);
    const fail = m => { err.textContent = m; err.classList.remove('hidden'); };
    if (!v.current_password || !v.new_password) return fail('Fill in all fields');
    if (v.new_password.length < 6) return fail('New password must be at least 6 characters');
    if (v.new_password !== v.confirm) return fail('New passwords do not match');
    try {
      await api('/auth/change-password', { method: 'POST', body: v });
      err.classList.add('hidden'); form.reset();
      toast('Password updated');
      if (u.must_change_password) { u.must_change_password = false; location.hash = '#/dashboard'; }
    } catch (ex) { fail(ex.message); }
  });
}
