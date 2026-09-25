import { api, can, qs } from '../state.js';
import { esc, icon, fmtDate, todayStr, toast, openModal, confirmDialog, empty, debounce, fieldHtml } from '../ui.js';

const DOC_TYPES = { invoice: 'Invoice', receipt: 'Receipt', quotation: 'Quotation', contract: 'Contract', credit_note: 'Credit note', other: 'Other' };
const fileUrl = (vendorId, d, download) => `/api/vendors/${vendorId}/documents/${d.id}/file${download ? '?download=1' : ''}`;
const size = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

export function docCard(d, vendorId) {
  const ext = (d.original_name.split('.').pop() || '').toUpperCase();
  const isImg = /^image\/(png|jpe?g|webp|gif)$/.test(d.mime || '');
  return `<div class="doc" data-doc="${d.id}" data-vendor="${vendorId}">
    <a class="thumb" href="${fileUrl(vendorId, d)}" target="_blank" rel="noopener">${isImg ? `<img src="${fileUrl(vendorId, d)}" alt="" loading="lazy">` : `<span class="ext">${esc(ext || 'FILE')}</span>`}</a>
    <b title="${esc(d.title)}">${esc(d.title)}</b>
    <div class="small muted">${esc(DOC_TYPES[d.doc_type] || d.doc_type)}${d.bill_no ? ' · Bill #' + esc(d.bill_no) : ''}<br>${esc(fmtDate(d.doc_date || d.created_at))} · ${size(d.size || 0)}</div>
    <div class="row" style="gap:6px">
      <a class="btn btn-sm" href="${fileUrl(vendorId, d)}" target="_blank" rel="noopener">${icon('eye')} View</a>
      <a class="btn btn-sm btn-ghost btn-icon" href="${fileUrl(vendorId, d, true)}" title="Download">${icon('download')}</a>
      ${can('vendors.manage') ? `<button class="btn btn-sm btn-ghost btn-icon" data-deldoc title="Delete">${icon('trash')}</button>` : ''}
    </div>
  </div>`;
}

export function bindDocCards(root, reload) {
  root.querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => {
    const card = b.closest('[data-doc]');
    if (!(await confirmDialog('Delete this document permanently?'))) return;
    try { await api(`/vendors/${card.dataset.vendor}/documents/${card.dataset.doc}`, { method: 'DELETE' }); toast('Document deleted'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// vendor: fixed vendor object, or null to let the user choose from `vendorList`.
export function uploadModal(vendor, bills = [], billId = null, vendorList = []) {
  return new Promise(resolve => {
    let done = false;
    openModal({
      title: vendor ? `Upload to ${vendor.name}` : 'Upload vendor document',
      body: `<form class="form-grid" novalidate>
        <div class="form-error hidden full"></div>
        ${vendor ? '' : fieldHtml({ name: 'vendor_id', label: 'Vendor', type: 'select', placeholder: 'Choose vendor…', options: vendorList.map(v => [v.id, v.name]), required: true, full: true })}
        <div class="full"><div class="drop" data-drop tabindex="0">${icon('upload')}<div style="margin-top:8px"><b>Drop files here</b> or click to choose</div><div class="small">PDF, images, Word, Excel · up to 15 MB each</div><div class="small" data-names style="margin-top:8px;color:var(--text)"></div></div>
          <input type="file" name="files" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt"></div>
        ${fieldHtml({ name: 'title', label: 'Title', placeholder: 'defaults to file name' })}
        ${fieldHtml({ name: 'doc_type', label: 'Type', type: 'select', options: Object.entries(DOC_TYPES), value: 'invoice' })}
        ${fieldHtml({ name: 'doc_date', label: 'Document date', type: 'date', value: todayStr() })}
        ${bills.length ? fieldHtml({ name: 'bill_id', label: 'Link to bill', type: 'select', placeholder: '— not linked —', options: bills.map(b => [b.id, b.bill_no ? '#' + b.bill_no : fmtDate(b.bill_date)]), value: billId || '' }) : ''}
      </form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go>${icon('upload')} Upload</button>`,
      onMount: m => {
        const form = m.el.querySelector('form');
        const input = form.elements.files;
        const drop = m.el.querySelector('[data-drop]');
        let files = [];
        const setFiles = list => { files = [...list]; m.el.querySelector('[data-names]').textContent = files.map(f => f.name).join(', '); };
        drop.onclick = () => input.click();
        drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
        input.onchange = () => setFiles(input.files);
        drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
        drop.ondragleave = () => drop.classList.remove('over');
        drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); setFiles(e.dataTransfer.files); };
        const err = m.el.querySelector('.form-error');
        m.el.querySelector('[data-go]').onclick = async e => {
          const vid = vendor ? vendor.id : form.elements.vendor_id.value;
          if (!vid) { err.textContent = 'Choose a vendor'; err.classList.remove('hidden'); return; }
          if (!files.length) { err.textContent = 'Choose at least one file'; err.classList.remove('hidden'); return; }
          const fd = new FormData();
          files.forEach(f => fd.append('files', f));
          for (const k of ['title', 'doc_type', 'doc_date', 'bill_id']) if (form.elements[k] && form.elements[k].value) fd.append(k, form.elements[k].value);
          e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span> Uploading…';
          try {
            await api(`/vendors/${vid}/documents`, { method: 'POST', form: fd });
            done = true; m.close(); toast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`); resolve(true);
          } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); e.target.disabled = false; e.target.innerHTML = `${icon('upload')} Upload`; }
        };
        const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
        obs.observe(document.getElementById('modal-root'), { childList: true });
      },
    });
  });
}

export default async function documents(el) {
  const f = { q: '', type: '', month: '' };
  const open = new Set();
  let vendorList = [];
  try { vendorList = (await api('/vendors')).vendors; } catch { /* ignore */ }

  async function load() {
    const { documents: docs } = await api('/admin/documents' + qs(f));
    const groups = new Map();
    for (const d of docs) {
      if (!groups.has(d.vendor_id)) groups.set(d.vendor_id, { name: d.vendor_name, docs: [] });
      groups.get(d.vendor_id).docs.push(d);
    }
    if (f.q || f.type || f.month) for (const k of groups.keys()) open.add(k);
    el.innerHTML = `
    <div class="toolbar">
      <div class="search">${icon('search')}<input class="input" data-q placeholder="Search vendor, title or file…" value="${esc(f.q)}"></div>
      <select class="select" data-type><option value="">All types</option>${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="input" type="month" data-month value="${esc(f.month)}" style="min-width:0;width:170px" title="Filter by month">
      <div class="spacer"></div>
      <span class="muted small">${docs.length} document${docs.length === 1 ? '' : 's'} in ${groups.size} vendor folder${groups.size === 1 ? '' : 's'}</span>
      ${can('documents.upload') ? `<button class="btn btn-primary" data-up>${icon('upload')} Upload</button>` : ''}
    </div>
    ${groups.size ? `<div class="stack">${[...groups.entries()].map(([vid, g]) => `
      <div class="card folder">
        <div class="folder-head" data-folder="${vid}"><span class="ico">${icon('folder')}</span>
          <div style="flex:1;min-width:0"><b>${esc(g.name)}</b><div class="small muted">${g.docs.length} file${g.docs.length === 1 ? '' : 's'} · latest ${esc(fmtDate(g.docs[0].doc_date || g.docs[0].created_at))}</div></div>
          <a class="btn btn-sm btn-ghost" href="#/vendors/${vid}?tab=documents" onclick="event.stopPropagation()">Vendor →</a>
          ${icon(open.has(vid) ? 'arrowUp' : 'arrowDown')}</div>
        ${open.has(vid) ? `<div class="doc-grid">${g.docs.map(d => docCard(d, vid)).join('')}</div>` : ''}
      </div>`).join('')}</div>`
    : `<div class="card">${empty('No documents found', 'Upload vendor invoices and receipts; each vendor gets its own folder.', 'folder')}</div>`}`;

    el.querySelector('[data-q]').oninput = debounce(e => { f.q = e.target.value; load().then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
    el.querySelector('[data-type]').onchange = e => { f.type = e.target.value; load(); };
    el.querySelector('[data-month]').onchange = e => { f.month = e.target.value; load(); };
    el.querySelectorAll('[data-folder]').forEach(h => h.onclick = () => { const id = Number(h.dataset.folder); open.has(id) ? open.delete(id) : open.add(id); load(); });
    const up = el.querySelector('[data-up]');
    if (up) up.onclick = async () => { if (await uploadModal(null, [], null, vendorList)) load(); };
    bindDocCards(el, load);
  }
  await load();
}
