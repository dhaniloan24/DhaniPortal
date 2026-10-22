const $ = s => document.querySelector(s);
$('#year').textContent = new Date().getFullYear();
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function notice(el, message, error = false) { el.hidden = false; el.textContent = message; el.classList.toggle('error', error); }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function field(labelText, control) { const label = el('label', '', labelText); label.append(control); return label; }
function input(name, value, type = 'text') { const x = el('input'); x.name = name; x.type = type; x.value = value ?? ''; if (type === 'number') { x.min = '0'; x.step = '0.01'; } return x; }
function selectStatus(value) {
  const s = el('select'); s.name = 'status';
  ['Received','Under Review','Documents Required','Approved','Rejected','Disbursed'].forEach(v => { const o = el('option','',v); o.value = v; s.append(o); });
  s.value = value; return s;
}
async function loadApps() {
  const list = $('#application-list'); list.replaceChildren();
  const apps = await api('/api/admin/applications');
  if (!apps.length) { list.append(el('p','notice','No applications have been submitted yet.')); return; }
  apps.forEach(a => {
    const card = el('article','admin-card');
    const heading = el('div','admin-card-heading');
    heading.append(el('h3','',`${a.full_name} · ${a.reference_no}`), el('span','status-pill',a.status));
    card.append(heading);
    const info = el('div','admin-info');
    [
      ['Mobile', a.phone], ['Email', a.email], ['Loan type', a.loan_type],
      ['Requested amount', `₹${Number(a.loan_amount).toLocaleString('en-IN')}`],
      ['Tenure', `${a.tenure_months} months`], ['Submitted', new Date(a.created_at).toLocaleString()]
    ].forEach(([k,v]) => { const cell = el('div'); cell.append(el('small','',k),el('strong','',String(v ?? '—'))); info.append(cell); });
    card.append(info);
    const purpose = el('p','admin-purpose',`Purpose: ${a.purpose}\nAddress: ${a.address}`); card.append(purpose);
    const files = el('div','file-links');
    [['photo','View photo'],['signature','View signature'],['document','Download document']].forEach(([kind,label]) => {
      const b = el('button','button file-button',label);
      b.type = 'button';
      b.addEventListener('click', async () => {
        try {
          const response = await fetch(`/api/admin/files/${a.id}/${kind}`, { credentials:'same-origin' });
          if (!response.ok) { const d = await response.json(); throw new Error(d.error || 'File unavailable'); }
          const blob = await response.blob(); const url = URL.createObjectURL(blob);
          const link = document.createElement('a'); link.href = url; link.download = `${kind}-${a.id}`; link.target = '_blank'; link.rel = 'noopener'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) { alert(e.message); }
      });
      files.append(b);
    });
    card.append(files);
    const edit = el('form','admin-edit');
    const status = selectStatus(a.status);
    const approved = input('approved_amount', a.approved_amount ?? '', 'number');
    const notes = el('textarea'); notes.name = 'admin_notes'; notes.rows = 3; notes.maxLength = 2000; notes.value = a.admin_notes || '';
    edit.append(field('Application status',status),field('Approved amount (₹)',approved),field('Internal/customer update note',notes));
    const save = el('button','button primary','Save changes & notify applicant'); save.type = 'submit'; edit.append(save);
    edit.addEventListener('submit', async ev => {
      ev.preventDefault(); save.disabled = true; save.textContent = 'Saving…';
      try {
        await api(`/api/admin/applications/${a.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(edit))) });
        notice($('#admin-result'),`Saved update for ${a.reference_no}. Customer email is sent when SMTP is configured.`);
        await loadApps();
      } catch(e) { notice($('#admin-result'),e.message,true); }
      finally { save.disabled = false; save.textContent = 'Save changes & notify applicant'; }
    });
    card.append(edit); list.append(card);
  });
}
async function checkSession() {
  try { await api('/api/admin/me'); $('#login-panel').hidden = true; $('#dashboard').hidden = false; await loadApps(); }
  catch { $('#login-panel').hidden = false; $('#dashboard').hidden = true; }
}
$('#login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); const button = ev.currentTarget.querySelector('button'); button.disabled = true;
  try {
    await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(ev.currentTarget)))});
    ev.currentTarget.reset(); await checkSession();
  } catch(e) { notice($('#login-result'),e.message,true); }
  finally { button.disabled = false; }
});
$('#refresh').addEventListener('click', async () => { try { await loadApps(); } catch(e) { notice($('#admin-result'),e.message,true); } });
$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout',{method:'POST'}); } finally { $('#dashboard').hidden = true; $('#login-panel').hidden = false; } });
checkSession();
