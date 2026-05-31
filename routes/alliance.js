'use strict';

/**
 * University Alliance peer monitor — benchmark fellow UA members' public affairs
 * activity: recent institutional news and their parliamentary footprint.
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');

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
    ${a.snippet ? `<p class="story">${esc(a.snippet)}</p>`
      : '<p class="story empty">No preview text — open the link to read the story.</p>'}
  </article>`).join('');

  const countLabel = member
    ? `${esc(member)} — ${activity.length} items <a href="/alliance">clear</a>`
    : `${activity.length} items across ${members.length} peers`;
  const body = `<div class="dash-head"><h1>University Alliance peers</h1>
      <span class="sub">benchmarking fellow UA members' public-affairs activity</span>
      <span class="spacer"></span>
      <div class="tabs">${typeTabs}</div></div>
    <div class="chips" style="margin:0 2px 8px">${memberChips}</div>
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: 'Peer activity', actions: `<span class="muted">${countLabel}</span>`,
        body: rows || '<p class="empty">No peer activity recorded yet. Run the Alliance scan from Admin.</p>',
        pad: true })}
    </div>`;

  res.send(layout({ title: 'UA peers', body, active: '/alliance', dashboard: true }));
});

module.exports = router;
