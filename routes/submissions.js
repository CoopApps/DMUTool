'use strict';

/**
 * Consolidated submissions register — institutional memory. One roll-up of
 * everything DMU has submitted or is working on across committee inquiries and
 * government consultations, drawn from the per-item submission trackers.
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, esc } = require('../lib/render');

router.get('/', (req, res) => {
  const filter = req.query.filter || 'all'; // all | submitted | inprogress

  const committee = all(
    `SELECT 'Committee' AS kind, committee_name AS body, inquiry_title AS title, deadline,
            working_days_remaining AS wdr, submitted, contributors, submission_url, url
     FROM committee_inquiries
     WHERE submitted = 1 OR (contributors IS NOT NULL AND contributors != '') OR (submission_url IS NOT NULL AND submission_url != '')`
  );
  const consultation = all(
    `SELECT 'Consultation' AS kind, organisation AS body, title, deadline,
            working_days_remaining AS wdr, submitted, contributors, submission_url, url
     FROM consultations
     WHERE submitted = 1 OR (contributors IS NOT NULL AND contributors != '') OR (submission_url IS NOT NULL AND submission_url != '')`
  );
  let rows = [...committee, ...consultation];
  if (filter === 'submitted') rows = rows.filter((r) => r.submitted);
  if (filter === 'inprogress') rows = rows.filter((r) => !r.submitted);
  rows.sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));

  const tableRows = rows.map((r) => `<tr>
    <td><span class="src-badge ${r.kind === 'Committee' ? 'committee' : 'written'}">${esc(r.kind)}</span></td>
    <td>${esc(r.body || '')}</td>
    <td><a href="${esc(r.url || '#')}" target="_blank" rel="noopener">${esc(r.title || '')}</a></td>
    <td>${esc((r.deadline || '').slice(0, 10) || '—')}</td>
    <td>${r.submitted ? '<span class="wdr green">submitted</span>' : '<span class="wdr amber">in progress</span>'}</td>
    <td>${esc(r.contributors || '—')}</td>
    <td>${r.submission_url ? `<a href="${esc(r.submission_url)}" target="_blank">document</a>` : '—'}</td>
  </tr>`).join('');

  const toggle = `<div class="filters">
    <a href="/submissions?filter=all" class="${filter === 'all' ? 'active' : ''}">All</a>
    <a href="/submissions?filter=submitted" class="${filter === 'submitted' ? 'active' : ''}">Submitted</a>
    <a href="/submissions?filter=inprogress" class="${filter === 'inprogress' ? 'active' : ''}">In progress</a>
  </div>`;

  const body = `<div class="page-head"><h1>Submissions register</h1>${toggle}</div>
    <p class="count">${rows.length} record${rows.length === 1 ? '' : 's'}</p>
    ${rows.length ? `<table><thead><tr><th>Type</th><th>Body</th><th>Title</th><th>Deadline</th><th>Status</th><th>Contributors</th><th>Document</th></tr></thead><tbody>${tableRows}</tbody></table>`
      : '<p class="empty">No submissions logged yet. Use the submission tracker on a committee inquiry or consultation.</p>'}`;

  res.send(layout({ title: 'Submissions', body, active: '/submissions' }));
});

module.exports = router;
