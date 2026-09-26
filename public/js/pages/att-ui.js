// Shared attendance helpers: status colours, month calendar, edit-day dialog.
import { api } from '../state.js';
import { esc, icon, fmtDay, todayStr, formModal, toast } from '../ui.js';

export const STATUS = {
  present: { label: 'Present', short: 'P', cls: 'st-present' },
  half_day: { label: 'Half day', short: '½', cls: 'st-half' },
  leave: { label: 'Leave', short: 'L', cls: 'st-leave' },
  absent: { label: 'Absent', short: 'A', cls: 'st-absent' },
  week_off: { label: 'Week off', short: 'W', cls: 'st-off' },
  holiday: { label: 'Holiday', short: 'H', cls: 'st-holiday' },
  not_marked: { label: 'Not marked', short: '·', cls: 'st-none' },
  not_joined: { label: 'Before joining', short: '', cls: 'st-future' },
  upcoming: { label: '', short: '', cls: 'st-future' },
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const statusChip = (s, paid) => {
  const st = STATUS[s] || { label: s, cls: '' };
  return `<span class="chip ${st.cls}">${esc(st.label)}${s === 'leave' ? (paid ? ' · paid' : ' · unpaid') : ''}</span>`;
};

export const hm = min => {
  min = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
};
export const clock = ts => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const timeInput = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function countsLine(c) {
  const bits = [
    ['present', c.present, 'st-present'], ['half day', c.half_day, 'st-half'],
    ['paid leave', c.leave_paid, 'st-leave'], ['unpaid leave', c.leave_unpaid, 'st-leave'],
    ['absent', c.absent, 'st-absent'], ['week off', c.week_off, 'st-off'], ['holiday', c.holiday, 'st-holiday'],
  ].filter(b => Number(b[1]));
  return bits.map(([l, n, cls]) => `<span class="chip ${cls}">${n} ${l}</span>`).join(' ') || '<span class="muted small">No days yet</span>';
}

// Month calendar of attendance days. onDay(dayObj) makes cells clickable.
export function attCalendar(days, { onDay } = {}) {
  if (!days.length) return '';
  const first = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  const t = todayStr();
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="aday blank"></div>';
  for (const d of days) {
    const st = STATUS[d.status] || STATUS.upcoming;
    html += `<button type="button" class="aday ${st.cls} ${d.date === t ? 'today' : ''}" data-aday="${d.date}" ${onDay ? '' : 'tabindex="-1"'}
      title="${esc(fmtDay(d.date))} — ${esc(st.label)}${d.worked_min ? ' · ' + hm(d.worked_min) : ''}">
      <b>${Number(d.date.slice(8))}</b><span>${esc(st.short)}</span>${d.worked_min ? `<small>${hm(d.worked_min)}</small>` : ''}</button>`;
  }
  return `<div class="acal">${html}</div>`;
}

export function bindCalendar(root, days, onDay) {
  root.querySelectorAll('[data-aday]').forEach(b => b.onclick = () => {
    const d = days.find(x => x.date === b.dataset.aday);
    if (d && d.status !== 'upcoming' || onDay.allowFuture) onDay(d);
  });
}

// Manager dialog to set/correct one person's day.
export async function editDay(userId, name, day) {
  const r = await formModal({
    title: `${name} · ${fmtDay(day.date)}`, size: 'narrow',
    fields: [
      { name: 'status', label: 'Status', type: 'select', full: true, value: ['present', 'half_day', 'leave', 'absent', 'week_off', 'holiday'].includes(day.status) ? day.status : 'present',
        options: [['present', 'Present'], ['half_day', 'Half day'], ['leave', 'Leave'], ['absent', 'Absent'], ['week_off', 'Week off'], ['holiday', 'Holiday'], ['clear', '— Clear this day —']] },
      { name: 'check_in', label: 'Start time', type: 'time', value: timeInput(day.check_in) },
      { name: 'check_out', label: 'Finish time', type: 'time', value: timeInput(day.check_out) },
      { name: 'leave_paid', label: 'Leave is paid', type: 'checkbox', value: day.status === 'leave' ? !!day.leave_paid : true, full: true, hint: 'Only used when status is Leave' },
      { name: 'note', label: 'Note', value: day.note || '', full: true },
    ],
    onSubmit: v => api(`/attendance/${userId}/${day.date}`, { method: 'PUT', body: v }),
  });
  if (r) toast('Attendance updated');
  return r;
}

export const cssOnce = () => {
  if (document.getElementById('att-css')) return;
  const st = document.createElement('style');
  st.id = 'att-css';
  st.textContent = `
  .chip { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; background:var(--bg-2); color:var(--text-2); white-space:nowrap; }
  .st-present { background:var(--success-50); color:var(--success); }
  .st-half { background:var(--warning-50); color:var(--warning); }
  .st-leave { background:var(--info-50); color:var(--info); }
  .st-absent { background:var(--danger-50); color:var(--danger); }
  .st-off { background:var(--bg-2); color:var(--muted); }
  .st-holiday { background:#efe6fb; color:#7b4bb7; }
  :root[data-theme="dark"] .st-holiday { background:#2c2140; color:#c3a6f0; }
  .st-none { background:transparent; color:var(--muted); border:1px dashed var(--border-strong); }
  .st-future { background:transparent; color:var(--muted); opacity:.5; }
  .acal { display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:6px; }
  .acal .dow { font-size:11px; color:var(--muted); text-align:center; font-weight:700; }
  .aday { border:1px solid transparent; border-radius:12px; padding:6px 4px; min-height:58px; display:flex; flex-direction:column; align-items:center; gap:1px; cursor:pointer; font:inherit; }
  .aday b { font-size:12px; } .aday span { font-weight:800; font-size:15px; line-height:1.1; } .aday small { font-size:10px; opacity:.85; }
  .aday.today { outline:2px solid var(--primary); outline-offset:1px; }
  .aday.blank { background:none; cursor:default; }
  .aday:hover:not(.blank) { transform:translateY(-1px); border-color:var(--border-strong); }
  .punch { display:grid; grid-template-columns: 1.1fr 1fr; gap:0; overflow:hidden; }
  .punch-left { padding:26px; color:#fff; background: radial-gradient(500px 240px at 0% 0%, rgba(255,255,255,.18), transparent 60%), linear-gradient(135deg, #3d2622, #1d1210); position:relative; }
  .punch-left.working { background: radial-gradient(500px 240px at 0% 0%, rgba(255,255,255,.2), transparent 60%), linear-gradient(135deg, #1f8a5b, #0f5a3a); }
  .punch-left.break { background: radial-gradient(500px 240px at 0% 0%, rgba(255,255,255,.2), transparent 60%), linear-gradient(135deg, #d98e3d, #a45f18); }
  .punch-left.done { background: radial-gradient(500px 240px at 0% 0%, rgba(255,255,255,.2), transparent 60%), linear-gradient(135deg, #c43c6b, #8f2a52); }
  .punch-time { font-family: var(--serif); font-size: 46px; line-height: 1; letter-spacing: -1px; }
  .punch-status { display:inline-flex; align-items:center; gap:8px; margin-top:14px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,.16); font-weight:700; font-size:13px; }
  .punch-status i { width:8px; height:8px; border-radius:50%; background:#fff; }
  .punch-left.working .punch-status i, .punch-left.break .punch-status i { animation: pulse 1.4s infinite; }
  @keyframes pulse { 0%{ box-shadow:0 0 0 0 rgba(255,255,255,.7);} 70%{ box-shadow:0 0 0 10px rgba(255,255,255,0);} 100%{ box-shadow:0 0 0 0 rgba(255,255,255,0);} }
  .punch-worked { margin-top:18px; font-size:13px; opacity:.85; } .punch-worked b { font-size:22px; display:block; opacity:1; }
  .punch-right { padding:22px; display:flex; flex-direction:column; gap:12px; justify-content:center; }
  .punch-btn { height:56px; font-size:16px; border-radius:16px; }
  .timeline { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
  .timeline div { display:flex; justify-content:space-between; font-size:13px; padding:6px 10px; border-radius:10px; background:var(--surface-2); }
  .reg-wrap { overflow-x:auto; }
  table.reg { border-collapse:separate; border-spacing:3px; font-size:12px; }
  table.reg th { font-size:10.5px; color:var(--muted); font-weight:700; padding:2px; }
  table.reg td.name { white-space:nowrap; font-weight:600; padding-right:10px; position:sticky; left:0; background:var(--surface); z-index:1; }
  table.reg td.c { width:28px; height:28px; text-align:center; border-radius:7px; font-weight:800; cursor:pointer; }
  table.reg td.tot { white-space:nowrap; padding-left:8px; color:var(--text-2); }
  .team-card { padding:14px 16px; display:flex; gap:12px; align-items:center; }
  .team-card .grow { flex:1; min-width:0; }
  @media (max-width: 760px) { .punch { grid-template-columns:1fr; } .punch-time { font-size:38px; } }
  `;
  document.head.appendChild(st);
};
