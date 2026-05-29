'use strict';

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, esc } = require('../lib/render');

const TABS = [
  ['he_news', 'HE news'],
  ['professional_body', 'Professional bodies'],
  ['outlet', 'Outlets'],
  ['think_tank', 'Think tanks'],
  ['briefing', 'Library & POST'],
  ['govuk', 'Government'],
  ['legislation', 'Legislation'],
  ['bill', 'Bills'],
  ['edm', 'EDMs'],
  ['petition', 'Petitions'],
];

router.get('/', (req, res) => {
  const tab = req.query.tab && TABS.some(([t]) => t === req.query.tab) ? req.query.tab : 'he_news';

  // Scored sources (think tanks) lead with the most relevant; others by date.
  const items = all(
    `SELECT * FROM external_items WHERE source_type = ?
     ORDER BY COALESCE(relevance_score, -1) DESC, date DESC LIMIT 100`, [tab]
  );

  const tabnav = TABS.map(([t, label]) =>
    `<a href="/sector?tab=${t}" class="${t === tab ? 'active' : ''}">${esc(label)}</a>`).join('');

  const cards = items.map((it) => {
    let meta = '';
    try {
      const m = it.meta_json ? JSON.parse(it.meta_json) : null;
      if (m && m.signatures) {
        const trend = (m.delta != null && m.delta !== 0)
          ? ` <span class="${m.delta > 0 ? 'rag green' : 'rag grey'}">${m.delta > 0 ? '▲' : '▼'} ${Math.abs(m.delta).toLocaleString()}</span>` : '';
        meta = `<span class="pill">${m.signatures.toLocaleString()} signatures</span>${trend}`;
      }
      if (m && m.stage) meta = `<span class="pill">${esc(m.stage)}</span>`;
    } catch { /* ignore */ }
    const groups = (it.keyword_groups || '').split(',').filter(Boolean)
      .map((g) => `<span class="kw-pill">${esc(g)}</span>`).join('');
    const rel = it.relevance_rationale
      ? `<p class="why">DMU relevance (${esc(it.relevance_level || '')}): ${esc(it.relevance_rationale)}</p>` : '';
    return `<article class="card sector-card">
      <div class="card-head"><span class="src">${esc(it.source_name)}</span>
        <span class="date">${esc((it.date || '').slice(0,10))}</span>${meta}</div>
      <h3><a href="${esc(it.url || '#')}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <p class="snippet">${esc((it.summary || '').slice(0, 100))}</p>
      ${rel}
      <div class="kw-pills">${groups}</div>
    </article>`;
  }).join('');

  const body = `<div class="page-head"><h1>Sector watch</h1></div>
    <div class="tabs">${tabnav}</div>
    ${cards || '<p class="empty">No items in this panel yet.</p>'}`;

  res.send(layout({ title: 'Sector watch', body, active: '/sector' }));
});

module.exports = router;
