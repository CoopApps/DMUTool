'use strict';

const express = require('express');
const router = express.Router();
const { all, get } = require('../db/database');
const { layout, panel, esc, freshness } = require('../lib/render');

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
const SECTOR_TYPES = TABS.map(([t]) => t);
const TYPE_PLACEHOLDERS = SECTOR_TYPES.map(() => '?').join(',');

function relPill(level) {
  if (level === 'high') return '<span class="tag green">high relevance</span>';
  if (level === 'medium') return '<span class="tag amber">relevant</span>';
  if (level === 'low') return '<span class="tag grey">tangential</span>';
  if (level === 'none') return '<span class="tag grey">not relevant</span>';
  return '<span class="tag grey">assessing…</span>';
}

function card(it) {
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
  // The smart bit: Claude's judgement of why this matters to DMU (or doesn't).
  const rel = it.relevance_rationale
    ? `<p class="why dmu-take"><b>DMU take:</b> ${esc(it.relevance_rationale)}</p>` : '';
  return `<article class="card sector-card">
    <div class="card-head"><span class="src">${esc(it.source_name)}</span>
      <span class="date">${esc((it.date || '').slice(0,10))}</span>
      ${relPill(it.relevance_checked ? it.relevance_level : null)}${meta}</div>
    <h3><a href="${esc(it.url || '#')}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
    ${it.summary ? `<p class="story">${esc(it.summary)}</p>`
      : '<p class="story empty">No preview text — open the link to read the story.</p>'}
    ${rel}
    <div class="kw-pills">${groups}</div>
  </article>`;
}

router.get('/', (req, res) => {
  const view = req.query.tab && TABS.some(([t]) => t === req.query.tab) ? req.query.tab : 'curated';

  // ---- KPIs across everything Sector watch covers ----
  const counts = get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN relevance_level IN ('high','medium') THEN 1 ELSE 0 END) AS relevant,
       SUM(CASE WHEN relevance_level = 'high' THEN 1 ELSE 0 END) AS high,
       SUM(CASE WHEN relevance_checked = 0 AND COALESCE(keyword_groups,'') != '' THEN 1 ELSE 0 END) AS pending
     FROM external_items WHERE source_type IN (${TYPE_PLACEHOLDERS})`,
    SECTOR_TYPES
  ) || { total: 0, relevant: 0, high: 0, pending: 0 };

  const kpi = (n, label, cls = '') =>
    `<div class="kpi ${cls}"><span class="num">${n || 0}</span><span class="lbl">${esc(label)}</span></div>`;
  const kpis = `<div class="dash-kpis">
    ${kpi(counts.relevant, 'relevant to DMU', counts.relevant ? 'ok' : '')}
    ${kpi(counts.high, 'high priority')}
    ${kpi(counts.pending, 'being assessed', counts.pending ? 'warn' : '')}
    ${kpi(counts.total, 'items tracked')}
  </div>`;

  // Secondary nav: Curated first, then the per-source tabs.
  const tabnav = `<a href="/sector" class="${view === 'curated' ? 'active' : ''}">★ Curated</a>` +
    TABS.map(([t, label]) => `<a href="/sector?tab=${t}" class="${t === view ? 'active' : ''}">${esc(label)}</a>`).join('');

  let panelTitle, panelCount, panelBody;

  if (view === 'curated') {
    // Only what passed DMU's relevance gate, split by priority, rationale shown.
    const relevant = all(
      `SELECT * FROM external_items
       WHERE source_type IN (${TYPE_PLACEHOLDERS}) AND relevance_level IN ('high','medium')
       ORDER BY (relevance_level='high') DESC, COALESCE(relevance_score,0) DESC, date DESC
       LIMIT 120`, SECTOR_TYPES);
    const high = relevant.filter((r) => r.relevance_level === 'high');
    const med = relevant.filter((r) => r.relevance_level === 'medium');

    const section = (label, list) => list.length
      ? `<section class="group"><h2>${esc(label)} <span class="count">${list.length}</span></h2>
          <div class="group-body">${list.map(card).join('')}</div></section>` : '';

    if (relevant.length) {
      panelBody = section('High priority', high) + section('Worth watching', med) +
        (counts.pending ? `<p class="muted assessing-note">${counts.pending} further item${counts.pending === 1 ? '' : 's'} still being assessed by the relevance filter — check back shortly.</p>` : '');
    } else {
      panelBody = `<div class="empty-digest">
        <p><b>Nothing has passed DMU's relevance filter yet.</b></p>
        <p class="muted">Sector items that mention a tracked topic are assessed in the background for genuine DMU relevance.
        ${counts.pending ? `${counts.pending} item${counts.pending === 1 ? '' : 's'} currently being assessed — check back shortly.` : 'Run the sector fetches from Admin to populate this.'}
        Browse everything via the source tabs above.</p></div>`;
    }
    panelTitle = 'Curated for DMU';
    panelCount = relevant.length;
  } else {
    // Per-source browse — still relevance-aware (scored items lead, rationale shown).
    const items = all(
      `SELECT * FROM external_items WHERE source_type = ?
       ORDER BY (relevance_level='high') DESC, (relevance_level='medium') DESC,
                COALESCE(relevance_score, -1) DESC, date DESC LIMIT 120`, [view]);
    panelTitle = (TABS.find(([t]) => t === view) || [, view])[1];
    panelCount = items.length;
    panelBody = items.length ? items.map(card).join('') : '<p class="empty">No items in this source yet.</p>';
  }

  const body = `<div class="dash-head"><h1>Sector watch</h1>
      <span class="sub">higher-education sector news & policy, filtered for DMU relevance</span>
      <span class="spacer"></span>${freshness(['feeds', 'thinktanks', 'guardian', 'briefings'])}
      <div class="tabs sector-tabs">${tabnav}</div></div>
    ${kpis}
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: panelTitle, count: panelCount, body: panelBody, pad: true })}
    </div>`;

  res.send(layout({ title: 'Sector watch', body, active: '/sector', dashboard: true }));
});

module.exports = router;
