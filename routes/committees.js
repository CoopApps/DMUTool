'use strict';

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db/database');
const { layout, esc } = require('../lib/render');
const matcher = require('../services/matcher');

function deadlineClass(wdr) {
  if (wdr == null) return 'grey';
  if (wdr < 0) return 'grey';
  if (wdr < 7) return 'red';
  if (wdr <= 14) return 'amber';
  return 'green';
}

function card(q) {
  const { academics, courses } = matcher.getMatches(q.id, 'committee_inquiry', { limit: 3 });
  const acad = academics.map((a) =>
    `<li><b>${esc(a.name)}</b> <span class="dept">${esc(a.department || '')}</span> — ${esc(a.explanation || '')}</li>`).join('');
  const crs = courses.map((c) => `<li><a href="${esc(c.url || '#')}">${esc(c.title)}</a></li>`).join('');
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
  const filter = req.query.filter || 'all'; // all | matched
  let sql = `SELECT * FROM committee_inquiries WHERE evidence_status = 'AcceptingEvidence'`;
  if (filter === 'matched') sql += ` AND keyword_group IS NOT NULL`;
  sql += ` ORDER BY (deadline IS NULL), deadline ASC`;
  const inquiries = all(sql);

  const toggle = `<div class="filters">
    <a href="/committees?filter=all" class="${filter === 'all' ? 'active' : ''}">All open</a>
    <a href="/committees?filter=matched" class="${filter === 'matched' ? 'active' : ''}">Keyword-matched only</a>
  </div>`;

  const body = `<div class="page-head"><h1>Committee tracker</h1>${toggle}</div>
    ${inquiries.length ? inquiries.map(card).join('') : '<p class="empty">No open inquiries on record. Run a committees fetch from Admin.</p>'}`;

  res.send(layout({ title: 'Committees', body, active: '/committees' }));
});

module.exports = router;
