'use strict';

const express = require('express');
const router = express.Router();
const { all, get } = require('../db/database');
const { layout, esc, badge } = require('../lib/render');
const matcher = require('../services/matcher');

function lastUpdated() {
  const rows = all(`SELECT source, MAX(completed_at) AS at FROM fetch_log GROUP BY source`);
  return rows.map((r) => `${esc(r.source)}: ${r.at ? esc(r.at.slice(0, 16).replace('T', ' ')) : '—'}`).join(' · ');
}

function matchSidebar(itemId, itemType) {
  const { academics, courses } = matcher.getMatches(itemId, itemType, { limit: 3 });
  let html = '';
  if (academics.length) {
    html += '<div class="matches"><strong>Matched academics</strong><ul>' +
      academics.map((a) => `<li><b>${esc(a.name)}</b> <span class="dept">${esc(a.department || '')}</span><br>
        <span class="why">${esc(a.explanation || '')}</span></li>`).join('') +
      '</ul></div>';
  }
  if (courses.length) {
    html += '<div class="matches courses"><strong>Relevant courses</strong><ul>' +
      courses.map((c) => `<li><a href="${esc(c.url || '#')}">${esc(c.title)}</a></li>`).join('') +
      '</ul></div>';
  }
  return html;
}

function itemCard(it) {
  const isNew = it.is_new ? '<span class="new-badge">New</span>' : '';
  const member = it.member_name ? ` · ${esc(it.member_name)}${it.party ? ` (${esc(it.party)})` : ''}` : '';
  return `<article class="card" data-id="${it.id}" data-type="parliamentary_item">
    <div class="card-head">${badge(it.source)} <span class="date">${esc((it.date || '').slice(0, 10))}</span>${member} ${isNew}</div>
    <h3><a href="${esc(it.url || '#')}" target="_blank" rel="noopener">${esc(it.title || '(untitled)')}</a></h3>
    <p class="snippet">${esc((it.snippet || '').slice(0, 150))}</p>
    <div class="card-body">${matchSidebar(it.id, 'parliamentary_item')}</div>
    <div class="card-actions">
      <button onclick="DMU.openDraft(${it.id},'parliamentary_item')">Draft response</button>
      <button onclick="DMU.findExperts(${it.id},'parliamentary_item',this)">Find experts</button>
    </div>
  </article>`;
}

router.get('/', (req, res) => {
  // New committee inquiry banner(s)
  const newInquiries = all(
    `SELECT id, inquiry_title, working_days_remaining FROM committee_inquiries
     WHERE is_new = 1 ORDER BY deadline ASC LIMIT 5`
  );
  const banner = newInquiries.map((q) =>
    `<div class="banner">New inquiry — <b>${esc(q.inquiry_title)}</b> —
     ${q.working_days_remaining != null ? `${q.working_days_remaining} working days to deadline` : 'deadline TBC'}
     <a href="/committees">View committee tracker →</a></div>`
  ).join('');

  // Items from last 7 days or flagged new, grouped by keyword group.
  const items = all(
    `SELECT * FROM parliamentary_items
     WHERE date >= date('now','-7 days') OR is_new = 1
     ORDER BY keyword_group, date DESC`
  );
  const groups = all('SELECT name FROM keyword_groups ORDER BY name');

  const byGroup = {};
  for (const it of items) (byGroup[it.keyword_group] = byGroup[it.keyword_group] || []).push(it);

  const sections = groups.map((g) => {
    const list = byGroup[g.name] || [];
    const collapsed = list.length === 0 ? ' collapsed' : '';
    const cards = list.length ? list.map(itemCard).join('') : '<p class="empty">No items in the last 7 days.</p>';
    return `<section class="group${collapsed}">
      <h2 onclick="this.parentElement.classList.toggle('collapsed')">${esc(g.name)} <span class="count">${list.length}</span></h2>
      <div class="group-body">${cards}</div>
    </section>`;
  }).join('');

  const expertBox = `<form class="expert-box" onsubmit="return DMU.quickExpert(event)">
    <input type="text" id="quick-expert" placeholder="Who at DMU works on this?">
    <button>Search</button>
  </form>`;

  const body = `<div class="page-head"><h1>Daily digest</h1>${expertBox}</div>
    ${banner}${sections}
    <footer class="updated">Last updated — ${lastUpdated()}</footer>`;

  res.send(layout({ title: 'Digest', body, active: '/digest' }));
});

module.exports = router;
