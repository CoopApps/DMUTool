'use strict';

/**
 * University Alliance peer monitor — benchmark fellow UA members' public affairs
 * activity: recent institutional news and their parliamentary footprint.
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, esc } = require('../lib/render');

const TYPE_LABEL = { news: 'News', hansard: 'Hansard', written: 'Written Q' };
const TYPE_CLS = { news: 'sector', hansard: 'commons', written: 'written' };

router.get('/', (req, res) => {
  const member = req.query.member || '';
  const type = req.query.type || '';

  const members = all('SELECT * FROM ua_members WHERE is_self = 0 ORDER BY name');
  const counts = {};
  for (const r of all(`SELECT member, COUNT(*) c FROM ua_activity
      WHERE date >= date('now','-30 days') GROUP BY member`)) counts[r.member] = r.c;

  const where = [], params = [];
  if (member) { where.push('member = ?'); params.push(member); }
  if (type) { where.push('type = ?'); params.push(type); }
  const activity = all(
    `SELECT * FROM ua_activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY date DESC LIMIT 150`, params);

  const memberChips = members.map((m) =>
    `<a href="/alliance?member=${encodeURIComponent(m.name)}" class="chip ${m.name === member ? 'active' : ''}"
        title="${esc(m.region || '')}">${esc(m.short)} <span class="n">${counts[m.name] || 0}</span></a>`).join('');

  const typeTabs = ['', 'news', 'hansard', 'written'].map((t) =>
    `<a href="/alliance?${member ? 'member=' + encodeURIComponent(member) + '&' : ''}type=${t}" class="${t === type ? 'active' : ''}">${t ? TYPE_LABEL[t] : 'All'}</a>`).join('');

  const rows = activity.map((a) => `<article class="card sector-card">
    <div class="card-head">
      <span class="src-badge ${TYPE_CLS[a.type] || 'sector'}">${esc(TYPE_LABEL[a.type] || a.type)}</span>
      <span class="src">${esc(a.member)}</span>
      <span class="date">${esc((a.date || '').slice(0, 10))}</span>
    </div>
    <h3><a href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.title)}</a></h3>
    ${a.snippet ? `<p class="snippet">${esc(a.snippet.slice(0, 160))}</p>` : ''}
  </article>`).join('');

  const body = `<div class="page-head"><h1>University Alliance peers</h1></div>
    <p class="why">Monitoring fellow UA members' public affairs activity — institutional news and their parliamentary footprint. Benchmarking only; separate from DMU's own relevance.</p>
    <div class="chips">${memberChips}</div>
    <div class="tabs">${typeTabs}</div>
    ${member ? `<p class="count">${esc(member)} — ${activity.length} items <a href="/alliance">clear</a></p>` : `<p class="count">${activity.length} items across ${members.length} peers</p>`}
    ${rows || '<p class="empty">No peer activity recorded yet. Run the Alliance scan from Admin.</p>'}`;

  res.send(layout({ title: 'UA peers', body, active: '/alliance' }));
});

module.exports = router;
