'use strict';

const express = require('express');
const router = express.Router();
const { all, db } = require('../db/database');
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
    <h3>${esc(a.name)} <span class="dept">${esc(a.title || '')} · ${esc(a.department || '')}</span>
      ${a.source && a.source !== 'contensis' ? `<span class="kw-pill">${esc(srcLabel[a.source] || a.source)}</span>` : ''}</h3>
    <p class="contact">${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}
      ${a.phone ? ` · ${esc(a.phone)}` : ''}
      ${a.profile_url ? ` · <a href="${esc(a.profile_url)}" target="_blank">Profile</a>` : ''}</p>
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

module.exports = router;
