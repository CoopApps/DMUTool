'use strict';

const express = require('express');
const router = express.Router();
const { all, get, db } = require('../db/database');
const { layout, esc } = require('../lib/render');

/** Run an FTS5 search, falling back to LIKE if FTS errors on the query. */
function search(q) {
  if (!q) return [];
  try {
    // Build a safe prefix query for FTS5.
    const terms = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
    return all(
      `SELECT a.id, a.name, a.title, a.department, a.email, a.phone, a.profile_url, a.source,
              snippet(academics_fts, 3, '<mark>', '</mark>', '…', 12) AS excerpt, bm25(academics_fts) AS rank
       FROM academics_fts JOIN academics a ON a.id = academics_fts.rowid
       WHERE academics_fts MATCH ? ORDER BY rank LIMIT 50`,
      [terms]
    );
  } catch {
    const like = `%${q}%`;
    return all(
      `SELECT id, name, title, department, email, phone, profile_url, source,
              substr(profile_text,1,160) AS excerpt
       FROM academics WHERE name LIKE ? OR department LIKE ? OR profile_text LIKE ?
       LIMIT 50`, [like, like, like]
    );
  }
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const results = search(q);

  const srcLabel = { contensis: 'Contensis', xml: 'staff listing', legacy: 'legacy record' };
  const cards = results.map((a) => `<article class="card academic">
    <h3><a href="/academics/${a.id}">${esc(a.name)}</a> <span class="dept">${esc(a.title || '')} · ${esc(a.department || '')}</span>
      ${a.source && a.source !== 'contensis' ? `<span class="kw-pill">${esc(srcLabel[a.source] || a.source)}</span>` : ''}</h3>
    <p class="contact">${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}
      ${a.phone ? ` · ${esc(a.phone)}` : ''}
      · <a href="/academics/${a.id}">View profile</a></p>
    <p class="snippet">${a.excerpt || ''}</p>
  </article>`).join('');

  const body = `<div class="page-head"><h1>Academic expert finder</h1></div>
    <form class="expert-box big" method="get">
      <input name="q" value="${esc(q)}" placeholder="Search profiles, publications, departments, courses…">
      <button>Search</button>
    </form>
    ${q ? `<p class="count">${results.length} results for “${esc(q)}”</p>` : ''}
    ${cards || (q ? '<p class="empty">No matches.</p>' : '<p class="empty">Enter a query above. Tip: try a topic, a journal name, or a department.</p>')}`;

  res.send(layout({ title: 'Academics', body, active: '/academics' }));
});

// In-tool academic profile — everything we hold, no link-out required.
router.get('/:id(\\d+)', (req, res) => {
  const a = get('SELECT * FROM academics WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).send(layout({ title: 'Not found', body: '<h1>Academic not found</h1>', active: '/academics' }));

  let pubs = [];
  try { pubs = JSON.parse(a.publications_json || '[]'); } catch { /* ignore */ }
  const pubsList = pubs.length
    ? `<section><h2>Publications <span class="count">${pubs.length}</span></h2><ul class="pubs">${
        pubs.map((p) => `<li>${esc(typeof p === 'string' ? p : (p.title || JSON.stringify(p)))}</li>`).join('')}</ul></section>`
    : '<section><h2>Publications</h2><p class="empty">None captured yet — run the profile enrichment scrape.</p></section>';

  // What this academic has been matched to across the tool.
  const parl = all(
    `SELECT pi.title, pi.source, pi.date, pi.url, pi.keyword_group, am.score, am.match_type
     FROM academic_matches am JOIN parliamentary_items pi ON pi.id = am.item_id
     WHERE am.academic_id=? AND am.item_type='parliamentary_item' ORDER BY am.score DESC LIMIT 15`, [a.id]);
  const cttee = all(
    `SELECT ci.inquiry_title AS title, ci.url, am.score
     FROM academic_matches am JOIN committee_inquiries ci ON ci.id = am.item_id
     WHERE am.academic_id=? AND am.item_type='committee_inquiry' ORDER BY am.score DESC LIMIT 10`, [a.id]);

  const matchList = (rows, label) => rows.length
    ? `<section><h2>${label} <span class="count">${rows.length}</span></h2><ul>${
        rows.map((r) => `<li><a href="${esc(r.url || '#')}" target="_blank" rel="noopener">${esc(r.title)}</a>
          ${r.keyword_group ? `<span class="kw-pill">${esc(r.keyword_group)}</span>` : ''}
          <span class="dept">${esc((r.date || '').slice(0, 10))}${r.match_type === 'semantic' ? ' · semantic' : ''}</span></li>`).join('')}</ul></section>`
    : '';

  const srcLabel = { contensis: 'Contensis API', xml: 'staff listing', legacy: 'legacy record' };
  const profile = a.profile_text
    ? `<section><h2>Profile &amp; research interests</h2><div class="profile-text">${esc(a.profile_text)}</div></section>`
    : '<section><h2>Profile &amp; research interests</h2><p class="empty">Not captured yet — run the profile enrichment scrape to pull research interests and biography into the tool.</p></section>';

  const body = `<div class="page-head"><h1>${esc(a.name)}</h1></div>
    <p class="meta"><b>${esc(a.title || '')}</b>${a.department ? ' · ' + esc(a.department) : ''}${a.faculty && a.faculty !== a.department ? ' · ' + esc(a.faculty) : ''}
      <span class="kw-pill">${esc(srcLabel[a.source] || a.source || '')}</span></p>
    <p class="contact">${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}${a.phone ? ' · ' + esc(a.phone) : ''}
      ${a.research_group ? ' · ' + esc(a.research_group) : ''}
      ${a.profile_url ? ` · <a href="${esc(a.profile_url)}" target="_blank" rel="noopener">source page ↗</a>` : ''}</p>
    ${profile}
    ${pubsList}
    ${matchList(parl, 'Matched parliamentary activity')}
    ${matchList(cttee, 'Matched committee inquiries')}
    <p><a href="/academics">← back to finder</a></p>`;

  res.send(layout({ title: a.name, body, active: '/academics' }));
});

module.exports = router;
