'use strict';

/**
 * In-app reader for a single item — shows the full stored text plus the DMU
 * intelligence attached to it (matched academics, courses, events, relevance
 * rationale) so the officer reads + acts inside the tool rather than clicking
 * out. Source link is offered, not required.
 */

const express = require('express');
const router = express.Router();
const { get, all } = require('../db/database');
const { layout, esc, badge } = require('../lib/render');
const matcher = require('../services/matcher');

/** Link a member name to their MP/peer profile where resolvable; else to search. */
function memberHtml(name, party) {
  if (!name) return '';
  const tail = party ? ` (${esc(party)})` : '';
  const clean = String(name).replace(/\b(MP|Lord|Lady|Baroness|Sir|Dame|Dr|Rt Hon|The)\b/gi, '').replace(/[.,]/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return esc(name) + tail;
  const last = parts[parts.length - 1];
  const matches = all('SELECT id, first_name FROM mps WHERE last_name = ? COLLATE NOCASE', [last]);
  const m = matches.length === 1 ? matches[0]
    : matches.find((x) => clean.toLowerCase().includes(String(x.first_name || '').toLowerCase()));
  if (m) return `<a href="/mps/${m.id}">${esc(name)}</a>${tail} · <a href="/mps/${m.id}#log">log engagement →</a>`;
  return `<a href="/mps?q=${encodeURIComponent(last)}">${esc(name)}</a>${tail}`;
}

const ITEM = {
  parliamentary_item: {
    table: 'parliamentary_items',
    map: (r) => ({ title: r.title, source: r.source, date: r.date, member: r.member_name,
      party: r.party, body: r.full_text || r.snippet, url: r.url, group: r.keyword_group,
      rationale: r.relevance_rationale }),
  },
  committee_inquiry: {
    table: 'committee_inquiries',
    map: (r) => ({ title: r.inquiry_title, source: 'Committee', date: r.date_opened,
      meta: r.committee_name, body: r.summary, url: r.url, group: r.keyword_group,
      rationale: r.relevance_rationale, deadline: r.deadline, wdr: r.working_days_remaining }),
  },
  consultation: {
    table: 'consultations',
    map: (r) => ({ title: r.title, source: 'Consultation', date: r.opened,
      meta: r.organisation, body: r.summary, url: r.url, group: r.keyword_group,
      rationale: r.relevance_rationale, deadline: r.deadline, wdr: r.working_days_remaining }),
  },
  external_item: {
    table: 'external_items',
    map: (r) => ({ title: r.title, source: r.source_name, date: r.date,
      body: r.summary, url: r.url, group: r.keyword_groups, rationale: r.relevance_rationale }),
  },
};

router.get('/:type/:id', (req, res) => {
  const def = ITEM[req.params.type];
  if (!def) return res.status(404).send(layout({ title: 'Not found', body: '<h1>Unknown item type</h1>', active: '' }));
  const row = get(`SELECT * FROM ${def.table} WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).send(layout({ title: 'Not found', body: '<h1>Item not found</h1>', active: '' }));

  const it = def.map(row);
  const id = row.id, type = req.params.type;

  // Ensure matches exist, then fetch the DMU intelligence.
  let m = matcher.getMatches(id, type, { limit: 6 });
  if (!m.academics.length) { try { matcher.matchItem(id, type); m = matcher.getMatches(id, type, { limit: 6 }); } catch { /* ignore */ } }

  const acad = m.academics.length ? `<section><h2>DMU experts</h2><ul class="intel">${
    m.academics.map((a) => `<li><a href="/academics/${a.id}"><b>${esc(a.name)}</b></a>
      <span class="dept">${esc(a.title || '')}${a.department ? ' · ' + esc(a.department) : ''}</span>
      ${a.match_type === 'semantic' ? '<span class="kw-pill">conceptual</span>' : a.match_type === 'embedding' ? '<span class="kw-pill">semantic</span>' : ''}
      ${a.explanation ? `<br><span class="why">${esc(a.explanation)}</span>` : ''}</li>`).join('')}</ul></section>`
    : '<section><h2>DMU experts</h2><p class="empty">No strong expert match.</p></section>';

  const courses = m.courses && m.courses.length ? `<section><h2>Relevant DMU courses</h2><ul class="intel">${
    m.courses.map((c) => `<li><a href="/academics?q=${encodeURIComponent(c.title)}">${esc(c.title)}</a>${c.award ? ' — ' + esc(c.award) : ''}</li>`).join('')}</ul></section>` : '';

  const events = m.events && m.events.length ? `<section><h2>DMU events (context)</h2><ul class="intel">${
    m.events.map((e) => `<li>${esc(e.title)} <span class="dept">${esc((e.date || '').slice(0, 10))}</span></li>`).join('')}</ul></section>` : '';

  const deadlineBadge = it.wdr == null ? ''
    : it.wdr < 0 ? '<span class="wdr grey">deadline passed</span>'
    : `<span class="wdr ${it.wdr < 7 ? 'red' : it.wdr <= 14 ? 'amber' : 'green'}">${it.wdr} working day${it.wdr === 1 ? '' : 's'} to deadline</span>`;

  const body = `<div class="page-head"><h1>${esc(it.title || '(untitled)')}</h1></div>
    <p class="meta">${badge(it.source || 'Sector')}
      ${it.meta ? ' · ' + esc(it.meta) : ''}${it.member ? ' · ' + memberHtml(it.member, it.party) : ''}
      ${it.date ? ' · ' + esc((it.date || '').slice(0, 10)) : ''} ${deadlineBadge}
      ${it.group ? `<span class="kw-pill">${esc((it.group || '').split(',')[0])}</span>` : ''}</p>
    ${it.rationale ? `<p class="why intel-rationale">${esc(it.rationale)}</p>` : ''}

    <div class="reader-grid">
      <div class="reader-main">
        <div class="profile-text">${esc(it.body || '(no text captured)')}</div>
        <div class="card-actions">
          <button onclick="DMU.openDraft(${id},'${type}'${type === 'committee_inquiry' || type === 'consultation' ? ",'committee_submission'" : ''})">Draft response</button>
          <button onclick="DMU.findExperts(${id},'${type}',this)">Find experts (Claude)</button>
          ${it.url ? `<a class="csvbtn" href="${esc(it.url)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
        </div>
      </div>
      <aside class="reader-side">${acad}${courses}${events}</aside>
    </div>`;

  res.send(layout({ title: it.title || 'Item', body, active: '' }));
});

module.exports = router;
