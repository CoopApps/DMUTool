'use strict';

/**
 * Global search across everything — parliamentary items, committee inquiries,
 * consultations, external items (sector/think-tank/briefings), academics and
 * members. A single box in the header points here.
 */

const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { layout, esc } = require('../lib/render');

function search(q) {
  const like = `%${q}%`;
  return {
    parliamentary: all(
      `SELECT id, title, source, date, url, keyword_group FROM parliamentary_items
       WHERE title LIKE ? OR snippet LIKE ? OR member_name LIKE ? ORDER BY date DESC LIMIT 25`, [like, like, like]),
    committees: all(
      `SELECT id, inquiry_title AS title, committee_name, deadline, url FROM committee_inquiries
       WHERE inquiry_title LIKE ? OR summary LIKE ? ORDER BY deadline LIMIT 15`, [like, like]),
    consultations: all(
      `SELECT id, title, organisation, deadline, url FROM consultations
       WHERE title LIKE ? OR summary LIKE ? ORDER BY deadline LIMIT 15`, [like, like]),
    external: all(
      `SELECT id, title, source_name, source_type, date, url FROM external_items
       WHERE title LIKE ? OR summary LIKE ? ORDER BY date DESC LIMIT 25`, [like, like]),
    academics: all(
      `SELECT id, name, title, department FROM academics
       WHERE name LIKE ? OR department LIKE ? OR profile_text LIKE ? LIMIT 20`, [like, like, like]),
    members: all(
      `SELECT id, first_name, last_name, party, house FROM mps
       WHERE first_name LIKE ? OR last_name LIKE ? OR constituency LIKE ? LIMIT 20`, [like, like, like]),
  };
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const r = q ? search(q) : null;

  const section = (title, items, render) => !items || !items.length ? '' :
    `<section class="group"><h2>${esc(title)} <span class="count">${items.length}</span></h2>
     <div class="group-body">${items.map(render).join('')}</div></section>`;

  const ext = (it) => `<div class="result"><a href="${esc(it.url || '#')}" target="_blank" rel="noopener">${esc(it.title)}</a>
    <span class="dept">${esc(it.source_name || it.source || it.committee_name || it.organisation || '')} ${esc((it.date || it.deadline || '').slice(0,10))}</span></div>`;

  const body = `<div class="page-head"><h1>Search</h1></div>
    <form class="expert-box big" method="get" action="/search">
      <input name="q" value="${esc(q)}" placeholder="Search everything — items, committees, consultations, sector, academics, members…" autofocus>
      <button>Search</button>
    </form>
    ${!q ? '<p class="empty">Type a query above.</p>' : `
      ${section('Parliamentary', r.parliamentary, ext)}
      ${section('Committee inquiries', r.committees, ext)}
      ${section('Consultations', r.consultations, ext)}
      ${section('Sector / think tanks / briefings', r.external, ext)}
      ${section('Academics', r.academics, (a) => `<div class="result"><a href="/academics?q=${encodeURIComponent(a.name)}">${esc(a.name)}</a> <span class="dept">${esc(a.title || '')} · ${esc(a.department || '')}</span></div>`)}
      ${section('Members', r.members, (m) => `<div class="result"><a href="/mps/${m.id}">${esc(m.first_name)} ${esc(m.last_name)}</a> <span class="dept">${esc(m.party || '')} · ${esc(m.house || '')}</span></div>`)}
      ${[r.parliamentary, r.committees, r.consultations, r.external, r.academics, r.members].every((x) => !x.length) ? '<p class="empty">No matches.</p>' : ''}
    `}`;

  res.send(layout({ title: q ? `Search: ${q}` : 'Search', body, active: '/search' }));
});

module.exports = router;
