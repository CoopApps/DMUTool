/* DMU Parliamentary Intelligence — frontend glue (vanilla JS). */
(function () {
  'use strict';

  const draftState = { item_id: null, item_type: null, mp_id: null, draft_id: null };

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // ---- Draft slide-out -----------------------------------------------------
  function openDraft(itemId, itemType, outputType, mpId) {
    draftState.item_id = itemId;
    draftState.item_type = itemType;
    draftState.mp_id = mpId || null;
    const panel = document.getElementById('draft-panel');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (outputType) document.getElementById('draft-type').value = outputType;
    document.getElementById('draft-text').value = '';
    generateDraft();
  }
  function closeDraft() {
    const panel = document.getElementById('draft-panel');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
  async function generateDraft() {
    const ta = document.getElementById('draft-text');
    ta.value = 'Generating…';
    try {
      const data = await postJSON('/api/draft', {
        item_id: draftState.item_id,
        item_type: draftState.item_type,
        output_type: document.getElementById('draft-type').value,
        mp_id: draftState.mp_id,
      });
      ta.value = data.text || '(empty response)';
      draftState.draft_id = data.draft_id || null;
      const exp = document.getElementById('draft-export');
      if (draftState.draft_id) { exp.href = `/api/drafts/${draftState.draft_id}/export.docx`; exp.style.display = ''; }
      else exp.style.display = 'none';
    } catch (e) {
      ta.value = 'Error: ' + e.message;
    }
    updateCount();
  }
  function saveDraft() {
    if (!draftState.draft_id) return flash('Generate first');
    fetchPut(`/api/drafts/${draftState.draft_id}`,
      { content: document.getElementById('draft-text').value, status: 'edited' })
      .then(() => flash('Saved to Drafts')).catch((e) => alert('Error: ' + e.message));
  }
  function copyDraft() {
    const ta = document.getElementById('draft-text');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => flash('Copied'));
  }
  function updateCount() {
    document.getElementById('draft-count').textContent =
      document.getElementById('draft-text').value.length + ' chars';
  }

  // ---- Find experts (Tier 2) ----------------------------------------------
  async function findExperts(itemId, itemType, btn) {
    const original = btn.textContent;
    btn.textContent = 'Matching…';
    btn.disabled = true;
    try {
      const data = await postJSON('/api/match/semantic', { item_id: itemId, item_type: itemType });
      renderExperts(btn, data.matches || []);
    } catch (e) {
      alert('Find experts failed: ' + e.message);
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }
  function renderExperts(btn, matches) {
    const card = btn.closest('.card');
    let box = card.querySelector('.semantic-matches');
    if (!box) {
      box = document.createElement('div');
      box.className = 'matches semantic-matches';
      card.querySelector('.card-actions').before(box);
    }
    box.innerHTML = '<strong>Semantic matches</strong><ul>' +
      (matches.length ? matches.map((m) =>
        `<li><b>${esc(m.name)}</b> <span class="dept">${esc(m.department || '')}</span>
         <span class="kw-pill">${esc(m.confidence || '')}</span><br>
         <span class="why">${esc(m.explanation || '')}</span></li>`).join('')
        : '<li class="empty">No additional matches.</li>') + '</ul>';
  }

  // ---- Forms ---------------------------------------------------------------
  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = v; });
    Array.from(form.querySelectorAll('input[type=checkbox]')).forEach((c) => { o[c.name] = c.checked; });
    return o;
  }
  function handle(promise, okMsg) {
    promise.then(() => { flash(okMsg || 'Saved'); }).catch((e) => alert('Error: ' + e.message));
    return false;
  }

  function saveSubmission(ev, id) { ev.preventDefault();
    return handle(postJSON(`/api/committees/${id}/submission`, formData(ev.target))); }
  function saveConsultation(ev, id) { ev.preventDefault();
    return handle(postJSON(`/api/consultations/${id}/submission`, formData(ev.target))); }
  function logContact(ev, id) { ev.preventDefault();
    return handle(postJSON(`/api/mps/${id}/log`, formData(ev.target)).then(() => location.reload())); }
  function addGroup(ev) { ev.preventDefault();
    return handle(postJSON('/api/admin/groups', formData(ev.target)).then(() => location.reload())); }
  function saveKeywords(ev, id) { ev.preventDefault();
    return handle(fetchPut(`/api/admin/groups/${id}`, formData(ev.target))); }
  function deleteGroup(id) {
    if (!confirm('Delete this keyword group?')) return;
    fetch(`/api/admin/groups/${id}`, { method: 'DELETE' }).then(() => location.reload()); }
  function saveBody(ev, id) { ev.preventDefault();
    return handle(fetchPut(`/api/admin/bodies/${id}`, formData(ev.target))); }
  function saveContext(ev, key) { ev.preventDefault();
    return handle(postJSON('/api/admin/context', { key, value: ev.target.value.value })); }
  function addContext(ev) { ev.preventDefault();
    return handle(postJSON('/api/admin/context', formData(ev.target)).then(() => location.reload())); }
  async function savePolicyUnit(ev, role) { ev.preventDefault();
    const { names } = formData(ev.target);
    try {
      const r = await postJSON('/api/admin/policy-unit', { role, names });
      const msg = `Matched ${r.matched.length}` +
        (r.unmatched.length ? `. Unmatched (not in directory):\n\n${r.unmatched.join('\n')}` : '.');
      alert(msg);
      location.reload();
    } catch (e) { alert('Error: ' + e.message); }
    return false;
  }
  async function clearPolicyUnit() {
    if (!confirm('Clear all Policy Unit role assignments?')) return;
    await handle(postJSON('/api/admin/policy-unit/clear', {}));
    location.reload();
  }
  async function runSource(source, btn) {
    btn.textContent = 'Running…'; btn.disabled = true;
    try { await postJSON(`/api/admin/run/${source}`); flash('Done'); location.reload(); }
    catch (e) { alert('Error: ' + e.message); btn.textContent = 'Run now'; btn.disabled = false; }
  }
  async function weeklyBriefing(btn) {
    const out = document.getElementById('briefing-out');
    const ta = document.getElementById('briefing-text');
    out.hidden = false;
    ta.value = 'Generating briefing…';
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Generating…';
    try {
      const data = await postJSON('/api/briefing', {});
      ta.value = data.text || '(empty)';
    } catch (e) {
      ta.value = 'Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }
  // ---- Triage flags + match feedback -----------------------------------------
  function flag(type, id, field, btn) {
    postJSON('/api/flag', { item_type: type, item_id: id, field }).then((d) => {
      const on = d.state && d.state[field];
      if (field === 'ignored' && on) { const c = btn.closest('.card'); if (c) c.remove(); flash('Ignored'); return; }
      if (field === 'flagged') { btn.classList.toggle('on', !!on); flash(on ? 'Flagged for VC' : 'Unflagged'); }
    }).catch((e) => alert('Error: ' + e.message));
  }
  function matchVote(academicId, itemType, itemId, vote, btn) {
    postJSON('/api/match/feedback', { academic_id: academicId, item_type: itemType, item_id: itemId, vote })
      .then(() => { const w = btn.closest('.vote'); if (w) w.innerHTML = '<span class="why">thanks</span>'; })
      .catch((e) => alert('Error: ' + e.message));
  }

  // ---- Drafts list -----------------------------------------------------------
  function saveDraftRow(id) {
    const content = document.getElementById('draft-content-' + id).value;
    fetchPut(`/api/drafts/${id}`, { content, status: 'edited' })
      .then(() => flash('Saved')).catch((e) => alert('Error: ' + e.message));
  }
  function draftStatus(id, status) {
    fetchPut(`/api/drafts/${id}`, { status }).then(() => flash('Status: ' + status)).catch((e) => alert('Error: ' + e.message));
  }
  function copyDraftRow(id) {
    const ta = document.getElementById('draft-content-' + id);
    ta.select(); navigator.clipboard.writeText(ta.value).then(() => flash('Copied'));
  }
  function deleteDraft(id, btn) {
    if (!confirm('Delete this draft?')) return;
    fetch(`/api/drafts/${id}`, { method: 'DELETE' }).then(() => {
      const c = btn.closest('.card'); if (c) c.remove(); flash('Deleted');
    });
  }
  function copyBriefing() {
    const ta = document.getElementById('briefing-text');
    ta.select(); navigator.clipboard.writeText(ta.value).then(() => flash('Copied'));
  }
  function followUpDone(logId, btn) {
    postJSON(`/api/engagement/${logId}/done`).then(() => {
      const row = btn.closest('tr'); if (row) row.remove(); flash('Marked done');
    }).catch((e) => alert('Error: ' + e.message));
  }
  function quickExpert(ev) { ev.preventDefault();
    const q = document.getElementById('quick-expert').value;
    location.href = '/academics?q=' + encodeURIComponent(q); return false; }

  async function fetchPut(url, body) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function flash(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0a1f44;color:#fff;padding:8px 16px;border-radius:6px;z-index:200';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  document.addEventListener('input', (e) => { if (e.target.id === 'draft-text') updateCount(); });

  window.DMU = { openDraft, closeDraft, generateDraft, saveDraft, copyDraft, findExperts, saveSubmission,
    saveConsultation, logContact, addGroup, saveKeywords, deleteGroup, saveBody, saveContext,
    addContext, savePolicyUnit, clearPolicyUnit, runSource, quickExpert, followUpDone, weeklyBriefing, copyBriefing,
    saveDraftRow, draftStatus, copyDraftRow, deleteDraft, flag, matchVote };
})();
