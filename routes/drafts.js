'use strict';

/**
 * Draft history — every generated/edited draft, with status workflow, inline
 * editing, .docx export and delete. Turns the drafting panel from a throwaway
 * generator into a record of what DMU produced.
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const { OUTPUT_LABELS } = require('../services/docxExport');

const STATUSES = ['generated', 'edited', 'approved', 'sent'];

router.get('/', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const type = req.query.type || '';
  const where = [], params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('output_type = ?'); params.push(type); }
  const sql = `SELECT * FROM drafts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT 200`;
  const drafts = all(sql, params);

  const filter = `<form class="filters" method="get">
    <select name="status" onchange="this.form.submit()">
      <option value="">All statuses</option>
      ${STATUSES.map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <select name="type" onchange="this.form.submit()">
      <option value="">All types</option>
      ${Object.entries(OUTPUT_LABELS).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(v)}</option>`).join('')}
    </select>
  </form>`;

  const cards = drafts.map((d) => `<article class="card" data-id="${d.id}">
    <div class="card-head">
      <span class="src-badge committee">${esc(OUTPUT_LABELS[d.output_type] || d.output_type || 'Draft')}</span>
      <span class="date">${esc((d.updated_at || '').slice(0, 16).replace('T', ' '))}</span>
      <select onchange="DMU.draftStatus(${d.id}, this.value)">
        ${STATUSES.map((s) => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <h3>${esc(d.item_title || '(untitled item)')}</h3>
    <textarea id="draft-content-${d.id}" rows="8">${esc(d.content || '')}</textarea>
    <div class="card-actions">
      <button onclick="DMU.saveDraftRow(${d.id})">Save edits</button>
      <a class="csvbtn" href="/api/drafts/${d.id}/export.docx">Export .docx</a>
      <button onclick="DMU.copyDraftRow(${d.id})">Copy</button>
      <button class="danger" onclick="DMU.deleteDraft(${d.id}, this)">Delete</button>
    </div>
  </article>`).join('');

  const body = `<div class="dash-head"><h1>Drafts</h1>
      <span class="sub">AI-generated response drafts</span>
      <span class="spacer"></span>${filter}</div>
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: 'Saved drafts', count: drafts.length,
        body: cards || '<p class="empty">No drafts yet. Use “Draft response” on any item to generate one.</p>',
        pad: true })}
    </div>`;

  res.send(layout({ title: 'Drafts', body, active: '/drafts', dashboard: true }));
});

module.exports = router;
