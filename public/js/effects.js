// Interaction effects: click ripples, 3D tilt, cursor spotlight, count-up numbers.
// Everything is delegated from the document, so it works on every page without extra wiring.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches; // mouse/trackpad (no tilt on touch screens)

const RIPPLE = '.btn, .nav a, .tabs button, .chip[data-pick], .aday, .punch-btn';
const TILT = '.stat, .vendor-card, .team-card, .login-card, .money';
const GLOW = '.card, .login-card';

/* ---------- click ripple ---------- */
document.addEventListener('pointerdown', e => {
  const el = e.target.closest(RIPPLE);
  if (!el || el.disabled || reduce) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'fx-ripple';
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.classList.add('fx-clip');
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}, { passive: true });

/* ---------- tilt + spotlight ---------- */
let raf = 0, lastEvt = null, tilted = null;
function frame() {
  raf = 0;
  const e = lastEvt;
  const glow = e.target.closest && e.target.closest(GLOW);
  if (glow) {
    const r = glow.getBoundingClientRect();
    glow.style.setProperty('--mx', `${e.clientX - r.left}px`);
    glow.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
  const t = fine && !reduce && e.target.closest && e.target.closest(TILT);
  if (tilted && tilted !== t) { tilted.style.transform = ''; tilted.classList.remove('fx-tilting'); }
  tilted = t || null;
  if (t) {
    const r = t.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const max = t.classList.contains('login-card') ? 4 : 7;
    t.classList.add('fx-tilting');
    t.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateY(-4px)`;
  }
}
document.addEventListener('pointermove', e => {
  lastEvt = e;
  if (!raf) raf = requestAnimationFrame(frame);
}, { passive: true });
document.addEventListener('pointerleave', () => { if (tilted) { tilted.style.transform = ''; tilted = null; } });

/* ---------- count-up numbers ---------- */
const NUM_RE = /^(\D*?)(-?[\d,]+(?:\.\d+)?)(.*)$/s;
function countUp(el) {
  if (el.dataset.fxCounted) return;
  el.dataset.fxCounted = '1';
  if (reduce || el.children.length) return;
  const m = (el.textContent || '').trim().match(NUM_RE);
  if (!m) return;
  const target = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(target) || Math.abs(target) < 2) return;
  const dec = (m[2].split('.')[1] || '').length;
  const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const start = performance.now(), dur = 900;
  const step = now => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = m[1] + fmt.format(target * eased) + m[3];
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const observer = new MutationObserver(muts => {
  for (const mu of muts) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches && n.matches('.stat .value, .money b')) countUp(n);
    n.querySelectorAll && n.querySelectorAll('.stat .value, .money b').forEach(countUp);
  }
});
observer.observe(document.body, { childList: true, subtree: true });
