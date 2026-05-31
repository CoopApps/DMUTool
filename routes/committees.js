'use strict';

const express = require('express');
const router = express.Router();
const { all, get, run, ageNewFlags } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const matcher = require('../services/matcher');

function deadlineClass(wdr) {
  if (wdr == null) return 'grey';
  if (wdr < 0) return 'grey';
  if (wdr < 7) return 'red';
  if (wdr <= 14) return 'amber';
  return 'green';
}

function card(q) {
  const { academics, courses, events } = matcher.getMatches(q.id, 'committee_inquiry', { limit: 3 });
  const acad = academics.map((a) =>
    `<li><b>${esc(a.name)}</b> <span class="dept">${esc(a.department || '')}</span> — ${esc(a.explanation || '')}</li>`).join('');
  const crs = courses.map((c) => `<li><a href="${esc(c.url || '#')}">${esc(c.title)}</a></li>`).join('');
  const evs = (events || []).map((e) => `<li><a href="${esc(e.url || '#')}">${esc(e.title)}</a>
    ${e.date ? `<span class="dept">${esc((e.date || '').slice(0,10))}</span>` : ''}</li>`).join('');
  const cls = deadlineClass(q.working_days_remaining);
  const wdrText = q.working_days_remaining == null ? 'TBC'
    : q.working_days_remaining < 0 ? 'closed' : `${q.working_days_remaining} working days`;

  return `<article class="card committee" data-id="${q.id}">
    <div class="card-head">
      <span class="committee-name">${esc(q.committee_name)}</span>
      ${q.is_new ? '<span class="new-badge">New inquiry</span>' : ''}
      <span class="wdr ${cls}">${esc(wdrText)}</span>
    </div>
    <h3><a href="${esc(q.url || '#')}" target="_blank" rel="noopener">${esc(q.inquiry_title)}</a></h3>
    <p class="meta">Opened ${esc((q.date_opened || '').slice(0,10) || '—')} · Deadline ${esc((q.deadline || '').slice(0,10) || '—')}</p>
    <p class="snippet">${esc((q.summary || '').slice(0, 200))}</p>
    <div class="matches"><strong>Matched academics</strong><ul>${acad || '<li class="empty">No matches yet.</li>'}</ul></div>
    ${crs ? `<div class="matches courses"><strong>Relevant courses</strong><ul>${crs}</ul></div>` : ''}
    ${evs ? `<div class="matches events"><strong>DMU events (context)</strong><ul>${evs}</ul></div>` : ''}
    <form class="submission" onsubmit="return DMU.saveSubmission(event, ${q.id})">
      <label><input type="checkbox" name="submitted" ${q.submitted ? 'checked' : ''}> DMU submitted evidence</label>
      <input type="text" name="contributors" placeholder="Contributor names" value="${esc(q.contributors || '')}">
      <input type="url" name="submission_url" placeholder="Link to submitted document" value="${esc(q.submission_url || '')}">
      <button>Save</button>
    </form>
    <div class="card-actions">
      <button onclick="DMU.openDraft(${q.id},'committee_inquiry','committee_submission')">Draft opening paragraph</button>
      <button onclick="DMU.findExperts(${q.id},'committee_inquiry',this)">Find experts</button>
    </div>
  </article>`;
}

router.get('/', (req, res) => {
  ageNewFlags();
  const filter = req.query.filter || 'all'; // all | matched
  let sql = `SELECT * FROM committee_inquiries WHERE evidence_status = 'AcceptingEvidence'`;
  if (filter === 'matched') sql += ` AND keyword_group IS NOT NULL`;
  sql += ` ORDER BY (deadline IS NULL), deadline ASC`;
  const inquiries = all(sql);

  const toggle = `<div class="filters">
    <a href="/committees?filter=all" class="${filter === 'all' ? 'active' : ''}">All open</a>
    <a href="/committees?filter=matched" class="${filter === 'matched' ? 'active' : ''}">Keyword-matched only</a>
  </div>`;

  // DMU-relevant committees and what they're currently investigating.
  const committees = all(`SELECT * FROM committees WHERE relevant = 1 ORDER BY name`);
  const rosterCards = committees.map((c) => {
    let members = [], studies = [];
    try { members = JSON.parse(c.members_json || '[]'); } catch { /* ignore */ }
    try { studies = JSON.parse(c.studies_json || '[]'); } catch { /* ignore */ }
    const chair = members.find((m) => /chair/i.test(m.role || ''));
    return `<article class="card">
      <h3><a href="${esc(c.url || '#')}" target="_blank" rel="noopener">${esc(c.name)}</a>
        <span class="dept">${esc(c.house || '')}${c.departments ? ' · scrutinises ' + esc(c.departments) : ''}</span></h3>
      ${chair ? `<p class="meta"><b>Chair:</b> ${esc(chair.name)}${chair.party ? ` (${esc(chair.party)})` : ''} · ${members.length} members</p>` : `<p class="meta">${members.length} members</p>`}
      ${studies.length ? `<details><summary>Currently investigating (${studies.length})</summary><ul class="intel">${
        studies.map((s) => `<li>${esc(s.title)}${s.open ? ' <span class="kw-pill">accepting evidence</span>' : ''}</li>`).join('')}</ul></details>` : ''}
      ${members.length ? `<details><summary>Membership</summary><ul class="intel">${
        members.map((m) => `<li>${esc(m.name)} <span class="dept">${esc(m.role || '')}${m.party ? ' · ' + esc(m.party) : ''}</span></li>`).join('')}</ul></details>` : ''}
    </article>`;
  }).join('');

  const body = `<div class="dash-head"><h1>Committees</h1>
      <span class="sub">open calls for evidence + DMU-relevant committee membership</span>
      <span class="spacer"></span>${toggle}</div>
    <div class="dashgrid" style="grid-template-columns:1fr 1fr;">
      ${panel({ title: 'Open calls for evidence', count: inquiries.length,
        body: inquiries.length ? inquiries.map(card).join('') : '<p class="empty">No calls for evidence open on DMU topics right now. New ones appear here automatically.</p>',
        pad: true })}
      ${panel({ title: 'DMU-relevant committees', count: committees.length,
        body: rosterCards || '<p class="empty">Run the committeesRoster fetch from Admin to populate committee membership and current inquiries.</p>',
        pad: true })}
    </div>`;

  res.send(layout({ title: 'Committees', body, active: '/committees', dashboard: true }));
});

module.exports = router;
