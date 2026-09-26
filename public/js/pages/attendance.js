import { state, api, can, qs } from '../state.js';
import { esc, icon, avatar, fmtDay, fmtMonth, todayStr, shiftMonth, toast, formModal, confirmDialog, empty, relDay } from '../ui.js';
import { STATUS, statusChip, hm, clock, countsLine, attCalendar, bindCalendar, editDay, cssOnce } from './att-ui.js';

const LEAVE_TYPES = { casual: 'Casual', sick: 'Sick', emergency: 'Emergency', other: 'Other' };

export default async function attendance(el, { query }) {
  cssOnce();
  const self = can('attendance.self');
  const manage = can('attendance.manage');
  let tab = query.tab || (self ? 'me' : 'team');
  let month = todayStr().slice(0, 7);
  let teamDate = todayStr();
  let timer = null;

  const tabs = () => `<div class="toolbar"><div class="tabs">
    ${self ? `<button data-tab="me" class="${tab === 'me' ? 'active' : ''}">${icon('user')} My attendance</button>` : ''}
    ${manage ? `<button data-tab="team" class="${tab === 'team' ? 'active' : ''}">${icon('users')} Team today</button>
      <button data-tab="register" class="${tab === 'register' ? 'active' : ''}">${icon('calendar')} Monthly register</button>
      <button data-tab="leaves" class="${tab === 'leaves' ? 'active' : ''}">${icon('clipboard')} Leave requests <span class="badge rose hidden" data-pend></span></button>` : ''}
  </div></div>`;

  async function load() {
    clearInterval(timer);
    if (tab === 'me') await renderMe();
    else if (tab === 'team') await renderTeam();
    else if (tab === 'register') await renderRegister();
    else await renderLeaves();
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/attendance?tab=${tab}`); load(); });
    if (manage) api('/leaves?status=pending').then(r => { const b = el.querySelector('[data-pend]'); if (b && r.pending) { b.textContent = r.pending; b.classList.remove('hidden'); } }).catch(() => {});
  }

  /* ---------------- My attendance ---------------- */
  async function renderMe() {
    const d = await api('/attendance/me' + qs({ month }));
    const a = d.today;
    const phase = !a || !a.check_in ? (a && a.status !== 'present' ? 'marked' : 'idle') : a.check_out ? 'done' : a.on_break ? 'break' : 'working';
    const phaseText = { idle: 'Not clocked in', working: 'Working', break: 'On break', done: 'Finished for today', marked: STATUS[a && a.status]?.label || '' }[phase];
    el.innerHTML = `${tabs()}
    <div class="card punch mb">
      <div class="punch-left ${phase === 'working' ? 'working' : phase === 'break' ? 'break' : phase === 'done' ? 'done' : ''}">
        <div class="small" style="opacity:.8">${esc(fmtDay(d.today_date))}</div>
        <div class="punch-time" data-now>--:--</div>
        <div class="punch-status"><i></i>${esc(phaseText)}</div>
        <div class="punch-worked">Worked today<b data-worked>${hm(a ? a.worked_min : 0)}</b>${a && a.break_min ? `Breaks: ${hm(a.break_min)}` : ''}</div>
      </div>
      <div class="punch-right">
        ${phase === 'idle' ? `<button class="btn btn-primary punch-btn" data-act="in">${icon('check')} Clock in — I'm here</button>` : ''}
        ${phase === 'working' ? `<button class="btn punch-btn" data-act="break_start">☕ Start break</button>
          <button class="btn btn-dark punch-btn" data-act="out">${icon('logout')} Clock out — finish</button>` : ''}
        ${phase === 'break' ? `<button class="btn btn-primary punch-btn" data-act="break_end">${icon('refresh')} End break — back to work</button>` : ''}
        ${phase === 'done' ? `<div class="empty" style="padding:10px">${icon('star')}<b>Great work today!</b>See you tomorrow.</div>` : ''}
        ${phase === 'marked' ? `<div class="empty" style="padding:10px"><b>${esc(phaseText)}</b>${a.note ? esc(a.note) : 'Marked by manager.'}</div>` : ''}
        ${a && a.check_in ? `<div class="timeline">
          <div><span>${icon('check')} Clocked in</span><b>${clock(a.check_in)}</b></div>
          ${a.breaks.map(b => `<div><span>☕ Break</span><b>${clock(b.start_at)} – ${b.end_at ? clock(b.end_at) : 'now'}</b></div>`).join('')}
          ${a.check_out ? `<div><span>${icon('logout')} Clocked out</span><b>${clock(a.check_out)}</b></div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <div class="grid g-2-1">
      <div class="card">
        <div class="card-head"><button class="btn btn-sm btn-icon" data-mprev>${icon('chevLeft')}</button><h3 style="min-width:140px;text-align:center">${esc(fmtMonth(month))}</h3>
          <button class="btn btn-sm btn-icon" data-mnext ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button><div class="spacer"></div></div>
        <div class="card-body">${attCalendar(d.days)}<div class="row mt" style="gap:6px">${countsLine(d.counts)}</div>
          <div class="small muted" style="margin-top:8px">Total worked this month: <b>${hm(d.counts.worked_min)}</b>${d.week_off != null ? ` · Weekly off: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.week_off]}` : ''}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>My leave</h3><div class="spacer"></div><button class="btn btn-primary btn-sm" data-leave>${icon('plus')} Request leave</button></div>
        ${d.leaves.length ? `<ul class="list">${d.leaves.map(l => `<li><div class="grow"><b>${esc(fmtDay(l.from_date))}${l.to_date !== l.from_date ? ' → ' + esc(fmtDay(l.to_date)) : ''}</b>
          <small>${esc(LEAVE_TYPES[l.leave_type] || l.leave_type)}${l.reason ? ' · ' + esc(l.reason) : ''}</small></div>
          ${leaveBadge(l)}${l.status === 'pending' ? `<button class="btn btn-sm btn-ghost btn-icon" data-cancel="${l.id}" title="Cancel">${icon('x')}</button>` : ''}</li>`).join('')}</ul>`
          : empty('No leave requests', 'Ask for leave here — your manager will approve it.', 'calendar')}
      </div>
    </div>`;

    const tick = () => {
      const n = el.querySelector('[data-now]');
      if (!n) return clearInterval(timer);
      n.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      if (a && a.check_in && !a.check_out && !a.on_break) {
        const extra = (Date.now() - loadedAt) / 60000;
        el.querySelector('[data-worked]').textContent = hm(a.worked_min + extra);
      }
    };
    const loadedAt = Date.now();
    tick(); timer = setInterval(tick, 15000);

    el.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      if (b.dataset.act === 'out' && !(await confirmDialog('Clock out and finish for today?', { title: 'Clock out', okText: 'Clock out', danger: false }))) return;
      b.disabled = true;
      try {
        await api('/attendance/action', { method: 'POST', body: { action: b.dataset.act } });
        toast({ in: 'Clocked in — have a great day!', break_start: 'Break started', break_end: 'Welcome back!', out: 'Clocked out. Thank you!' }[b.dataset.act]);
        load();
      } catch (e) { toast(e.message, 'error'); b.disabled = false; }
    });
    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); load(); };
    el.querySelector('[data-leave]').onclick = requestLeave;
    el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('Cancel this leave request?', { okText: 'Cancel request' }))) return;
      try { await api(`/leaves/${b.dataset.cancel}`, { method: 'DELETE' }); toast('Request cancelled'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function requestLeave() {
    const r = await formModal({
      title: 'Request leave', size: 'narrow',
      fields: [
        { name: 'from_date', label: 'From', type: 'date', value: todayStr(), required: true },
        { name: 'to_date', label: 'To', type: 'date', value: todayStr(), required: true },
        { name: 'leave_type', label: 'Type', type: 'select', options: Object.entries(LEAVE_TYPES), value: 'casual', full: true },
        { name: 'reason', label: 'Reason', type: 'textarea', full: true, placeholder: 'e.g. family function' },
      ],
      onSubmit: v => api('/leaves', { method: 'POST', body: v }),
    });
    if (r) { toast('Leave requested — waiting for approval'); load(); }
  }

  /* ---------------- Team today ---------------- */
  async function renderTeam() {
    const d = await api('/attendance/team' + qs({ date: teamDate }));
    const by = s => d.staff.filter(x => x.day && x.day.status === s).length;
    const working = d.staff.filter(x => x.rec && x.rec.check_in && !x.rec.check_out && !x.rec.on_break).length;
    const onBreak = d.staff.filter(x => x.rec && x.rec.on_break && !x.rec.check_out).length;
    el.innerHTML = `${tabs()}
    <div class="toolbar"><input class="input" type="date" data-date value="${teamDate}" max="${todayStr()}" style="width:170px;min-width:0"><b>${esc(relDay(teamDate))}</b></div>
    <div class="grid g4 mb">
      <div class="card stat"><div class="label">Working now</div><div class="value pos">${working}</div><div class="foot">clocked in</div></div>
      <div class="card stat"><div class="label">On break</div><div class="value" style="color:var(--warning)">${onBreak}</div><div class="foot">right now</div></div>
      <div class="card stat"><div class="label">Present / half day</div><div class="value">${by('present') + by('half_day')}</div><div class="foot">of ${d.staff.length} staff</div></div>
      <div class="card stat"><div class="label">Leave / absent</div><div class="value neg">${by('leave') + by('absent') + by('not_marked')}</div><div class="foot">${by('not_marked')} not marked yet</div></div>
    </div>
    <div class="grid g3">${d.staff.map(s => {
      const r = s.rec;
      const live = r && r.check_in && !r.check_out ? (r.on_break ? '<span class="chip st-half">☕ on break</span>' : '<span class="chip st-present">● working</span>') : '';
      return `<div class="card team-card">${avatar(s.name)}
        <div class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.designation || s.role.replace('_', ' '))}${s.kitchen ? ' · ' + esc(s.kitchen) : ''}</div>
          <div class="row" style="gap:6px;margin-top:6px">${statusChip(s.day.status, s.day.leave_paid)} ${live}</div>
          <div class="small muted" style="margin-top:4px">${r && r.check_in ? `In ${clock(r.check_in)}${r.check_out ? ' · Out ' + clock(r.check_out) : ''} · ${hm(r.worked_min)}` : ''}</div></div>
        <button class="btn btn-sm btn-ghost btn-icon" data-edit="${s.user_id}" title="Edit">${icon('edit')}</button></div>`;
    }).join('')}</div>`;
    el.querySelector('[data-date]').onchange = e => { teamDate = e.target.value || todayStr(); load(); };
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      const s = d.staff.find(x => x.user_id === b.dataset.edit);
      if (await editDay(s.user_id, s.name, { ...s.day, ...(s.rec || {}), date: d.date })) load();
    });
  }

  /* ---------------- Monthly register ---------------- */
  async function renderRegister() {
    const d = await api('/attendance/register' + qs({ month }));
    const n = d.staff[0] ? d.staff[0].days.length : 0;
    el.innerHTML = `${tabs()}
    <div class="toolbar"><button class="btn btn-icon" data-mprev>${icon('chevLeft')}</button><b style="min-width:140px;text-align:center">${esc(fmtMonth(month))}</b>
      <button class="btn btn-icon" data-mnext ${month >= todayStr().slice(0, 7) ? 'disabled' : ''}>${icon('chevRight')}</button>
      <div class="spacer"></div><span class="small muted">Click any box to correct it</span></div>
    <div class="card card-pad">${d.staff.length ? `<div class="reg-wrap"><table class="reg"><thead><tr><th></th>
      ${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>Paid days</th></tr></thead>
      <tbody>${d.staff.map(s => `<tr><td class="name">${esc(s.name)}</td>
        ${s.days.map(x => { const st = STATUS[x.status] || STATUS.upcoming; return `<td class="c ${st.cls}" data-u="${s.user_id}" data-d="${x.date}" title="${esc(fmtDay(x.date))}: ${esc(st.label)}">${esc(st.short)}</td>`; }).join('')}
        <td class="tot"><b>${Number(s.counts.units)}</b> · P${s.counts.present} ½${s.counts.half_day} L${Number(s.counts.leave_paid) + Number(s.counts.leave_unpaid)} A${s.counts.absent}</td></tr>`).join('')}</tbody></table></div>
      <div class="row mt" style="gap:6px">${Object.entries(STATUS).filter(([k]) => !['upcoming', 'not_joined'].includes(k)).map(([, v]) => `<span class="chip ${v.cls}">${v.short} ${v.label}</span>`).join('')}</div>`
      : empty('No staff', '', 'users')}</div>`;
    el.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); load(); };
    el.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); load(); };
    el.querySelectorAll('td.c').forEach(td => td.onclick = async () => {
      const s = d.staff.find(x => x.user_id === td.dataset.u);
      const day = s.days.find(x => x.date === td.dataset.d);
      if (await editDay(s.user_id, s.name, day)) load();
    });
  }

  /* ---------------- Leave requests ---------------- */
  async function renderLeaves() {
    const d = await api('/leaves');
    el.innerHTML = `${tabs()}
    <div class="card">${d.leaves.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>Dates</th><th>Type</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${d.leaves.map(l => `<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(l.user_name, 'sm')}<b>${esc(l.user_name)}</b></span></td>
        <td class="nowrap">${esc(fmtDay(l.from_date))}${l.to_date !== l.from_date ? ' → ' + esc(fmtDay(l.to_date)) : ''}<div class="small muted">${daysBetween(l.from_date, l.to_date)} day(s)</div></td>
        <td>${esc(LEAVE_TYPES[l.leave_type] || l.leave_type)}</td><td class="small muted" style="max-width:260px">${esc(l.reason || '')}</td>
        <td>${leaveBadge(l)}${l.decided_by_name ? `<div class="small muted">by ${esc(l.decided_by_name)}</div>` : ''}</td>
        <td><div class="actions">${l.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-ok="${l.id}">${icon('check')} Approve</button>
          <button class="btn btn-sm btn-danger" data-no="${l.id}">Reject</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`
      : empty('No leave requests yet', '', 'clipboard')}</div>`;
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
      const r = await formModal({
        title: 'Approve leave', size: 'narrow',
        fields: [{ name: 'paid', label: 'Paid leave (counts towards salary)', type: 'checkbox', value: true, full: true }],
        submitText: 'Approve',
        onSubmit: v => api(`/leaves/${b.dataset.ok}/decide`, { method: 'POST', body: { approve: true, paid: v.paid } }),
      });
      if (r) { toast('Leave approved'); load(); }
    });
    el.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('Reject this leave request?', { okText: 'Reject' }))) return;
      try { await api(`/leaves/${b.dataset.no}/decide`, { method: 'POST', body: { approve: false } }); toast('Leave rejected'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  await load();
}

const leaveBadge = l => `<span class="badge dot ${l.status === 'approved' ? 'green' : l.status === 'rejected' ? 'red' : 'amber'}">${esc(l.status)}${l.status === 'approved' ? (l.paid ? ' · paid' : ' · unpaid') : ''}</span>`;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
