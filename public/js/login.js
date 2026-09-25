import { api } from './state.js';
import { esc, icon, $ } from './ui.js';

const CAKE_SVG = `
<svg viewBox="0 0 400 420" aria-hidden="true">
  <defs>
    <linearGradient id="lg-sponge" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9a6346"/><stop offset="1" stop-color="#6d402c"/></linearGradient>
    <linearGradient id="lg-pink" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f58fb0"/><stop offset="1" stop-color="#c43c6b"/></linearGradient>
    <linearGradient id="lg-cream" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff5ec"/><stop offset="1" stop-color="#f3dccb"/></linearGradient>
    <linearGradient id="lg-plate" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f7ede6"/><stop offset="1" stop-color="#c9b3a5"/></linearGradient>
    <radialGradient id="rg-glow"><stop offset="0" stop-color="#ffcf70" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf70" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="cake-layer">
    <ellipse cx="200" cy="392" rx="178" ry="20" fill="url(#lg-plate)"/>
    <ellipse cx="200" cy="386" rx="160" ry="14" fill="#fffaf6" opacity=".6"/>
  </g>
  <g class="cake-layer l2">
    <path d="M60 300 v70 a140 22 0 0 0 280 0 v-70z" fill="url(#lg-sponge)"/>
    <ellipse cx="200" cy="300" rx="140" ry="22" fill="#b67a58"/>
    <path d="M60 334 a140 22 0 0 0 280 0 v8 a140 22 0 0 1 -280 0z" fill="#fbe3d3" opacity=".9"/>
    <g fill="#f58fb0">${[80, 110, 140, 170, 200, 230, 260, 290, 320].map((x, i) => `<circle cx="${x}" cy="${360 + (i % 2) * 4 + Math.sin(i) * 3}" r="5"/>`).join('')}</g>
  </g>
  <g class="cake-layer l3">
    <path d="M90 215 v78 a110 18 0 0 0 220 0 v-78z" fill="url(#lg-pink)"/>
    <ellipse cx="200" cy="215" rx="110" ry="18" fill="#f9b5cb"/>
    <path d="M90 215 q0 22 12 26 q10 4 12 -8 q4 26 16 22 q12 -2 10 -16 q6 30 20 26 q14 -2 10 -22 q8 24 22 20 q12 -4 8 -20 q8 26 22 22 q14 -4 10 -20 q6 22 20 18 q10 -4 10 -16 q6 18 16 14 q12 -6 12 -26z" fill="url(#lg-cream)"/>
    <g>${[[120, 272, '#ffd166'], [160, 280, '#7ad3c0'], [205, 268, '#ffffff'], [245, 282, '#ffd166'], [285, 270, '#7ad3c0'], [140, 262, '#fff'], [265, 258, '#fff']].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="9" height="3.4" rx="1.7" fill="${c}" transform="rotate(${(i * 47) % 180} ${x} ${y})"/>`).join('')}</g>
  </g>
  <g class="cake-layer l4">
    <path d="M125 150 v62 a75 13 0 0 0 150 0 v-62z" fill="#fff4ea"/>
    <ellipse cx="200" cy="150" rx="75" ry="13" fill="#fffaf5"/>
    <path d="M125 150 q2 16 10 17 q8 0 8 -9 q2 18 12 17 q9 -1 8 -12 q4 20 13 18 q9 -2 7 -14 q4 18 13 16 q9 -2 7 -14 q3 16 12 14 q8 -2 7 -12 q3 12 11 11 q8 -2 9 -18z" fill="#5a2e22"/>
    <circle cx="160" cy="146" r="9" fill="#d7263d"/><path d="M160 137 q4 -8 10 -9" stroke="#3d7a3a" stroke-width="2.4" fill="none"/>
    <circle cx="240" cy="148" r="9" fill="#d7263d"/><path d="M240 139 q-4 -8 -10 -9" stroke="#3d7a3a" stroke-width="2.4" fill="none"/>
  </g>
  <g class="cake-layer l4">
    <rect x="193" y="92" width="14" height="54" rx="4" fill="#fbe7a1"/>
    <path d="M193 102 l14 -6 M193 116 l14 -6 M193 130 l14 -6" stroke="#c43c6b" stroke-width="4"/>
  </g>
  <circle class="glow" cx="200" cy="72" r="40" fill="url(#rg-glow)"/>
  <path class="flame" d="M200 50 c12 14 12 28 0 40 c-12 -12 -12 -26 0 -40z" fill="#ffb347"/>
  <path class="flame" d="M200 64 c6 8 6 16 0 24 c-6 -8 -6 -16 0 -24z" fill="#fff3b0"/>
</svg>`;

const SPRINKLE_COLORS = ['#ffd166', '#f58fb0', '#7ad3c0', '#ffffff', '#c7a4ff'];

export function renderLogin(root, { shopName = 'Cakery', tagline = '', onSuccess, needsSetup = false, notConfigured = false, connectError = '' }) {
  const sprinkles = Array.from({ length: 22 }, (_, i) => {
    const left = (i * 37) % 100;
    const dur = 9 + (i * 7) % 11;
    const delay = -((i * 13) % 20);
    return `<i class="sprinkle" style="left:${left}%;background:${SPRINKLE_COLORS[i % SPRINKLE_COLORS.length]};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join('');

  root.innerHTML = `
  <div class="login">
    <section class="login-art">
      ${sprinkles}
      <div class="login-brand"><img src="img/logo.svg" alt=""><b>${esc(shopName)}</b></div>
      <div class="login-headline">
        <h1>Every layer,<br>every <em>crumb</em>,<br>accounted for.</h1>
        <p>${esc(tagline || 'The back office of your bakery')} — stock, kitchen output, daily cash &amp; online closing, vendor dues and monthly history in one place.</p>
        <div class="login-rotator"><span>✦ Daily cash &amp; online closing</span><span>✦ Vendor dues &amp; invoices</span><span>✦ Kitchen production logs</span><span>✦ Month-by-month history</span></div>
      </div>
      <div class="login-roles"><span>Owner</span><span>Manager</span><span>Cashier</span><span>Cook</span><span>Kitchen Staff</span><span>Customer Service</span></div>
      <div class="cake-stage">${CAKE_SVG}</div>
    </section>
    <section class="login-panel">
      <button class="btn btn-ghost btn-icon login-theme" data-theme-toggle aria-label="Toggle theme">${icon('moon')}</button>
      ${notConfigured ? `<div class="login-card">
        <div class="hello">Almost <em>ready</em></div>
        <div class="sub">This app is not connected to its database yet.</div>
        <ol style="padding-left:18px;color:var(--text-2);line-height:1.7">
          <li>Create a free project at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
          <li>In Supabase → <b>SQL Editor</b>, run the file <code>supabase/setup.sql</code> from the repository.</li>
          <li>In GitHub → repository <b>Settings → Secrets and variables → Actions → Variables</b>, add
            <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> (from Supabase → Project Settings → API).</li>
          <li>Re-run the <b>Deploy to GitHub Pages</b> action, then reload this page.</li>
        </ol>
      </div>` : `<form class="login-card" novalidate autocomplete="on">
        <div class="hello">${needsSetup ? 'Set up your <em>shop</em>' : 'Welcome <em>back</em>'}</div>
        <div class="sub">${needsSetup ? 'First time here — create the owner account. You can add staff after signing in.' : 'Sign in with the account your shop owner gave you.'}</div>
        <div class="login-error ${connectError ? '' : 'hidden'}" role="alert">${esc(connectError)}</div>
        ${needsSetup ? `<div class="field">
          <label for="lg-name">Your name</label>
          <div class="input-icon">${icon('user')}<input id="lg-name" class="input" name="name" autocomplete="name" required></div>
        </div>` : ''}
        <div class="field">
          <label for="lg-user">Username or email</label>
          <div class="input-icon">${icon('user')}<input id="lg-user" class="input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required ${needsSetup ? 'value="owner"' : ''}></div>
        </div>
        <div class="field">
          <label for="lg-pass">Password</label>
          <div class="input-icon">${icon('lock')}<input id="lg-pass" class="input" type="password" name="password" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" required>
            <button type="button" class="btn btn-ghost btn-sm btn-icon toggle-pw" aria-label="Show password">${icon('eye')}</button></div>
        </div>
        ${needsSetup ? `<div class="field">
          <label for="lg-pass2">Confirm password</label>
          <div class="input-icon">${icon('lock')}<input id="lg-pass2" class="input" type="password" name="confirm" autocomplete="new-password" required></div>
        </div>` : ''}
        <button class="btn btn-primary" type="submit">${needsSetup ? 'Create owner account' : 'Sign in'} ${icon('chevRight')}</button>
        <div class="login-foot">${icon('shield')} Access is based on your role. Every action is recorded.</div>
      </form>`}
    </section>
  </div>`;

  if (notConfigured) return;
  const form = $('.login-card', root);
  const err = $('.login-error', root);
  const pw = $('#lg-pass', root);
  $('.toggle-pw', root).onclick = e => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye');
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) { showErr('Enter your username and password.'); return; }
    if (needsSetup) {
      if (!form.name.value.trim()) { showErr('Enter your name.'); return; }
      if (password.length < 6) { showErr('Password must be at least 6 characters.'); return; }
      if (password !== form.confirm.value) { showErr('Passwords do not match.'); return; }
    }
    const label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${needsSetup ? 'Creating…' : 'Signing in…'}`;
    try {
      if (needsSetup) await api('/auth/setup', { method: 'POST', body: { name: form.name.value.trim(), username, password, confirm: form.confirm.value } });
      else await api('/auth/login', { method: 'POST', body: { username, password } });
      root.querySelector('.login').classList.add('leaving');
      setTimeout(onSuccess, 350);
    } catch (ex) {
      showErr(ex.message);
      btn.disabled = false; btn.innerHTML = label;
    }
  });
  function showErr(m) { err.textContent = m; err.classList.remove('hidden'); err.style.animation = 'none'; void err.offsetWidth; err.style.animation = ''; }
  setTimeout(() => $(needsSetup ? '#lg-name' : '#lg-user', root).focus(), 400);
}
