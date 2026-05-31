'use strict';

const express = require('express');
const router = express.Router();
const { all, run, ageNewFlags } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const matcher = require('../services/matcher');

function deadlineClass(wdr) {
  if (wdr == null) return 'grey';
  if (wdr < 0) return 'grey';
  if (wdr < 7) return 'red';
  if (wdr <= 14) return 'amber';
  return 'green';
}

function card(c) {
  const { academics, courses, events } = matcher.getMatches(c.id, 'consultation', { limit: 3 });
  const acad = academics.map((a) =>
    `<li><b>${esc(a.name)}</b> <span class="dept">${esc(a.department || '')}</span> — ${esc(a.explanation || '')}</li>`).join('');
  const crs = courses.map((x) => `<li><a href="${esc(x.url || '#')}">${esc(x.title)}</a></li>`).join('');
  const evs = (events || []).map((e) => `<li><a href="${esc(e.url || '#')}">${esc(e.title)}</a>
    ${e.date ? `<span class="dept">${esc((e.date || '').slice(0,10))}</span>` : ''}</li>`).join('');
  const cls = deadlineClass(c.working_days_remaining);
  const wdrText = c.working_days_remaining == null ? 'no deadline'
    : c.working_days_remaining < 0 ? 'closed' : `${c.working_days_remaining} working days`;

  return `<article class="card committee" data-id="${c.id}">
    <div class="card-head">
      <span class="committee-name">${esc(c.organisation || 'GOV.UK')}</span>
      ${c.is_new ? '<span class="new-badge">New</span>' : ''}
      <span class="wdr ${cls}">${esc(wdrText)}</span>
    </div>
    <h3><a href="${esc(c.url || '#')}" target="_blank" rel="noopener">${esc(c.title)}</a></h3>
    <p class="meta">Opened ${esc((c.opened || '').slice(0,10) || '—')} · Closes ${esc((c.deadline || '').slice(0,10) || '—')}</p>
    <p class="snippet">${esc((c.summary || '').slice(0, 200))}</p>
    <div class="matches"><strong>Matched academics</strong><ul>${acad || '<li class="empty">No matches yet.</li>'}</ul></div>
    ${crs ? `<div class="matches courses"><strong>Relevant courses</strong><ul>${crs}</ul></div>` : ''}
    ${evs ? `<div class="matches events"><strong>DMU events (context)</strong><ul>${evs}</ul></div>` : ''}
    <form class="submission" onsubmit="return DMU.saveConsultation(event, ${c.id})">
      <label><input type="checkbox" name="submitted" ${c.submitted ? 'checked' : ''}> DMU responded</label>
      <input type="text" name="contributors" placeholder="Contributor names" value="${esc(c.contributors || '')}">
      <input type="url" name="submission_url" placeholder="Link to response" value="${esc(c.submission_url || '')}">
      <button>Save</button>
    </form>
    <div class="card-actions">
      <button onclick="DMU.openDraft(${c.id},'consultation','committee_submission')">Draft response</button>
      <button onclick="DMU.findExperts(${c.id},'consultation',this)">Find experts</button>
    </div>
  </article>`;
}

router.get('/', (req, res) => {
  ageNewFlags();
  const filter = req.query.filter || 'open'; // open | matched | all
  let sql = 'SELECT * FROM consultations';
  const where = [];
  if (filter === 'open') where.push(`(deadline IS NULL OR date(deadline) >= date('now'))`);
  if (filter === 'matched') where.push('keyword_group IS NOT NULL');
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY (deadline IS NULL), deadline ASC';
  const rows = all(sql);

  const toggle = `<div class="filters">
    <a href="/consultations?filter=open" class="${filter === 'open' ? 'active' : ''}">Open</a>
    <a href="/consultations?filter=matched" class="${filter === 'matched' ? 'active' : ''}">Keyword-matched</a>
    <a href="/consultations?filter=all" class="${filter === 'all' ? 'active' : ''}">All</a>
  </div>`;

  const body = `<div class="dash-head"><h1>Government consultations</h1>
      <span class="sub">open GOV.UK consultations on DMU topics</span>
      <span class="spacer"></span>${toggle}</div>
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: 'Consultations', count: rows.length,
        body: rows.length ? rows.map(card).join('') : '<p class="empty">No consultations on record. Run a GOV.UK fetch from Admin.</p>',
        pad: true })}
    </div>`;

  res.send(layout({ title: 'Consultations', body, active: '/consultations', dashboard: true }));
});

module.exports = router;
