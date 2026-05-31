'use strict';

const express = require('express');
const router = express.Router();
const { all, get, ageNewFlags } = require('../db/database');
const { layout, esc, badge } = require('../lib/render');
const matcher = require('../services/matcher');

function lastUpdated() {
  const r = get(`SELECT MAX(completed_at) AS at FROM fetch_log`);
  return r && r.at ? esc(r.at.slice(0, 16).replace('T', ' ')) : '—';
}

// Procedural / set-piece debates that flood the feed and aren't actionable.
const NOISE = /(king'?s speech|queen'?s speech|debate on the address|business of the house|business without debate|points? of order|point of order|prayers|oral answers to questions|speaker'?s statement|royal assent|petition|adjournment|bill presented|deferred division|division)\b/i;

function isNoise(title) {
  return !title || NOISE.test(title);
}

function relevancePill(level) {
  if (!level || level === 'medium') return '';
  const cls = { high: 'green', low: 'grey', none: 'grey' }[level] || 'grey';
  return `<span class="tag ${cls}" title="overall DMU interest">${esc(level)} interest</span>`;
}
function expertisePill(type, id) {
  const s = matcher.expertiseSignal(id, type);
  if (s.strong) return '<span class="tag green" title="strong DMU expertise">★ expertise</span>';
  if (s.count > 0) return `<span class="tag amber" title="${s.count} expert matches">${s.count} experts</span>`;
  return '';
}
function flagState(type, id) {
  return get('SELECT flagged, ignored FROM item_flags WHERE item_type=? AND item_id=?', [type, id]) || {};
}
function interestOk(row) {
  return !row.relevance_checked || ['high', 'medium'].includes(row.relevance_level);
}

/** A dense one-line row (the new default look). */
function row(it) {
  const type = it._kind === 'committee' ? 'committee_inquiry' : 'parliamentary_item';
  const f = flagState(type, it.id);
  const title = it._kind === 'committee' ? it.inquiry_title : it.title;
  const src = it._kind === 'committee' ? 'Committee' : it.source;
  const date = (it._sort || '').slice(0, 10);
  const who = it.member_name ? `${esc(it.member_name)}${it.party ? ' (' + esc(it.party) + ')' : ''}` : (it.committee_name ? esc(it.committee_name) : '');
  const count = it._count > 1 ? `<span class="muted">×${it._count}</span>` : '';
  const flagged = f.flagged ? '<span class="tag amber">★</span>' : '';
  const newb = it.is_new ? '<span class="tag pink">new</span>' : '';
  return `<a class="drow" href="/item/${type}/${it.id}">
    <span class="drow-meta">${badge(src)} <span class="muted">${esc(date)}</span></span>
    <span class="drow-title">${esc(title || '(untitled)')} ${count}</span>
    <span class="drow-tags">${who ? `<span class="muted">${who}</span>` : ''} ${relevancePill(it.relevance_level)} ${expertisePill(type, it.id)} ${newb} ${flagged}</span>
  </a>`;
}

router.get('/', (req, res) => {
  ageNewFlags();
  const showAll = req.query.show === 'all';

  const notIgnored = (type, tbl) => showAll ? '' :
    `AND NOT EXISTS (SELECT 1 FROM item_flags f WHERE f.item_type='${type}' AND f.item_id=${tbl}.id AND f.ignored=1)`;

  // Parliamentary items, last 14 days. Collapse repeated debate contributions:
  // keep the most recent row per (keyword_group, title), with a contribution count.
  const rawItems = all(
    `SELECT *, COUNT(*) OVER (PARTITION BY keyword_group, title) AS _count,
            ROW_NUMBER() OVER (PARTITION BY keyword_group, title ORDER BY date DESC, id DESC) AS _rn
     FROM parliamentary_items
     WHERE (date >= date('now','-14 days') OR is_new = 1)
       ${notIgnored('parliamentary_item', 'parliamentary_items')}`
  ).filter((it) => it._rn === 1 && !isNoise(it.title))
   .map((it) => ({ ...it, _kind: 'parliamentary', _sort: it.date || '' }));

  const inquiries = all(
    `SELECT * FROM committee_inquiries
     WHERE evidence_status = 'AcceptingEvidence'
       AND (COALESCE(date_opened, created_at) >= date('now','-30 days') OR is_new = 1)
       ${notIgnored('committee_inquiry', 'committee_inquiries')}`
  ).filter((q) => showAll || interestOk(q))
   .map((q) => ({ ...q, _kind: 'committee', _sort: q.date_opened || q.created_at || '', title: q.inquiry_title }));

  const groups = all('SELECT name FROM keyword_groups ORDER BY name');
  const byGroup = {};
  for (const r of [...inquiries, ...rawItems]) {
    if (!r.keyword_group) continue;
    (byGroup[r.keyword_group] = byGroup[r.keyword_group] || []).push(r);
  }

  // Sort groups by activity (most items first); collapse empty + low-priority by default.
  const ordered = groups
    .map((g) => ({ name: g.name, list: (byGroup[g.name] || []).sort((a, b) => (b._sort || '').localeCompare(a._sort || '')) }))
    .sort((a, b) => b.list.length - a.list.length);

  const jumpNav = `<nav class="topic-jump">${ordered.map((g) =>
    `<a href="#g-${g.name.replace(/\W/g, '')}" class="${g.list.length ? '' : 'muted'}">${esc(g.name)} <b>${g.list.length}</b></a>`).join('')}</nav>`;

  const sections = ordered.map((g) => {
    const id = g.name.replace(/\W/g, '');
    const open = g.list.length > 0 && g.list.length <= 60; // keep huge groups collapsed
    const rows = g.list.length ? g.list.map(row).join('') : '<p class="empty">Nothing in the last 14 days.</p>';
    return `<section class="group ${open ? '' : 'collapsed'}" id="g-${id}">
      <h2 onclick="this.parentElement.classList.toggle('collapsed')">${esc(g.name)} <span class="count">${g.list.length}</span></h2>
      <div class="group-body drows">${rows}</div>
    </section>`;
  }).join('');

  const relToggle = `<div class="filters">
    <a href="/digest" class="${showAll ? '' : 'active'}">Relevant only</a>
    <a href="/digest?show=all" class="${showAll ? 'active' : ''}">Show all</a>
    <a href="/search">Search everything →</a>
  </div>`;

  const body = `<div class="page-head"><h1>Daily digest</h1>
    <form class="expert-box" onsubmit="return DMU.quickExpert(event)">
      <input type="text" id="quick-expert" placeholder="Who at DMU works on…?"><button>Find</button>
    </form></div>
    ${relToggle}
    ${jumpNav}
    ${sections}
    <footer class="updated">Last updated ${lastUpdated()} · procedural debates (King's Speech, points of order, etc.) hidden · repeated contributions collapsed</footer>`;

  res.send(layout({ title: 'Digest', body, active: '/digest' }));
});

module.exports = router;
