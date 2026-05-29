'use strict';

/**
 * APPG tracker — relevant All-Party Parliamentary Groups grouped by topic, with
 * their purpose and officer MPs surfaced as an engagement route (officers link
 * to the MP profile where we can resolve them).
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, esc } = require('../lib/render');
const { linkOfficers } = require('../services/appgs');

router.get('/', (req, res) => {
  const showAll = req.query.show === 'all';
  const rows = all(`SELECT * FROM appgs ${showAll ? '' : 'WHERE matched = 1'}
    ORDER BY keyword_group, name`);

  const byGroup = {};
  for (const a of rows) (byGroup[a.keyword_group || 'Other'] = byGroup[a.keyword_group || 'Other'] || []).push(a);

  const sections = Object.keys(byGroup).sort().map((grp) => {
    const cards = byGroup[grp].map((a) => {
      const officers = linkOfficers(a.officers_json).map((o) =>
        o.mp ? `<a href="/mps/${o.mp.id}">${esc(o.name)}</a>` : esc(o.name)).join(', ');
      return `<article class="card">
        <h3><a href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.name)}</a></h3>
        ${a.purpose ? `<p class="snippet">${esc(a.purpose.slice(0, 220))}</p>` : ''}
        ${officers ? `<p class="meta"><b>Officers:</b> ${officers}</p>` : '<p class="meta empty">Officers not yet scraped.</p>'}
      </article>`;
    }).join('');
    return `<section class="group"><h2>${esc(grp)} <span class="count">${byGroup[grp].length}</span></h2>
      <div class="group-body">${cards}</div></section>`;
  }).join('');

  const toggle = `<div class="filters">
    <a href="/appgs" class="${showAll ? '' : 'active'}">Relevant to DMU</a>
    <a href="/appgs?show=all" class="${showAll ? 'active' : ''}">All groups</a>
  </div>`;

  const body = `<div class="page-head"><h1>All-Party Parliamentary Groups</h1>${toggle}</div>
    <p class="why">APPGs whose subject matches DMU's topics — their officer MPs are a ready-made engagement route.</p>
    ${rows.length ? sections : '<p class="empty">No APPGs on record. Run the APPG scraper from Admin (register URL may need tuning in .env).</p>'}`;

  res.send(layout({ title: 'APPGs', body, active: '/appgs' }));
});

module.exports = router;
