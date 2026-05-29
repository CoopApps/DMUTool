'use strict';

/**
 * "This week" — a single consolidated urgency view. Everything time-sensitive
 * the tool tracks, pulled together and RAG-coded: closing committee/consultation
 * deadlines, oral-question submission cut-offs, what's new, and follow-ups due.
 * Plus an on-demand Claude weekly briefing for the SLT.
 */

const express = require('express');
const router = express.Router();
const { all, get, ageNewFlags } = require('../db/database');
const { layout, esc } = require('../lib/render');
const { workingDaysUntil, sittingDaysBefore } = require('../lib/parliament');

const HORIZON = 15; // working days
const RELEVANT = `(relevance_checked = 0 OR relevance_level IN ('high','medium'))`;
// Gated on overall DMU interest (institutional + sector/UA + expertise, weighed
// together by the relevance gate).
const interestOk = (r) => !r.relevance_checked || ['high', 'medium'].includes(r.relevance_level);

function ragClass(wdr) {
  if (wdr == null) return 'grey';
  if (wdr < 0) return 'grey';
  if (wdr < 7) return 'red';
  if (wdr <= 14) return 'amber';
  return 'green';
}

router.get('/', async (req, res) => {
  ageNewFlags();

  // 1) Closing deadlines within horizon — gated on overall DMU interest
  //    (institutional impact + sector/UA + expertise, weighed together).
  const inquiries = all(
    `SELECT id, committee_name AS org, inquiry_title AS title, working_days_remaining AS wdr, url,
            relevance_checked, relevance_level, 'committee_inquiry' AS kind
     FROM committee_inquiries WHERE evidence_status='AcceptingEvidence'
       AND working_days_remaining IS NOT NULL AND working_days_remaining BETWEEN 0 AND ${HORIZON}`
  ).filter(interestOk);
  const consultations = all(
    `SELECT id, organisation AS org, title, working_days_remaining AS wdr, url,
            relevance_checked, relevance_level, 'consultation' AS kind
     FROM consultations WHERE working_days_remaining IS NOT NULL AND working_days_remaining BETWEEN 0 AND ${HORIZON}`
  ).filter(interestOk);
  const deadlines = [...inquiries, ...consultations].sort((a, b) => a.wdr - b.wdr);

  const deadlineRows = deadlines.map((d) => `<tr>
    <td><span class="wdr ${ragClass(d.wdr)}">${d.wdr} wd</span></td>
    <td>${esc(d.org || '')}</td>
    <td><a href="${esc(d.url || '#')}" target="_blank" rel="noopener">${esc(d.title)}</a></td>
    <td>${d.kind === 'committee_inquiry' ? 'Committee' : 'Consultation'}</td>
    <td><button onclick="DMU.openDraft(${d.id},'${d.kind}','committee_submission')">Draft</button></td>
  </tr>`).join('');

  // 2) Oral-question submission cut-offs for the key departments.
  const oral = all(
    `SELECT title, date, meta_json, url FROM external_items
     WHERE source_type='oral_question' AND date >= date('now') ORDER BY date ASC LIMIT 12`
  );
  const oralRows = [];
  for (const o of oral) {
    let dept = o.title;
    try { const m = JSON.parse(o.meta_json || '{}'); if (m.department) dept = m.department; } catch { /* ignore */ }
    if (!o.date) continue;
    const cutoff = await sittingDaysBefore(new Date(o.date), 3);
    const wd = await workingDaysUntil(cutoff);
    if (wd < 0) continue; // cut-off passed
    oralRows.push(`<tr>
      <td><span class="wdr ${ragClass(wd)}">${wd} wd</span></td>
      <td>${esc(dept)}</td>
      <td>Session ${esc((o.date || '').slice(0,10))}</td>
      <td>Submit by ${esc(cutoff.toISOString().slice(0,10))} (12:30)</td>
    </tr>`);
  }

  // 3) New since 24h (relevant).
  const newInq = all(`SELECT COUNT(*) c FROM committee_inquiries WHERE is_new=1 AND ${RELEVANT}`).c;
  const newCons = all(`SELECT COUNT(*) c FROM consultations WHERE is_new=1 AND ${RELEVANT}`).c;
  const newParl = all(`SELECT COUNT(*) c FROM parliamentary_items WHERE is_new=1`).c;
  const newTT = all(`SELECT COUNT(*) c FROM external_items WHERE source_type='think_tank' AND created_at >= datetime('now','-1 day') AND relevance_level IN ('high','medium')`).c;

  // 4) Follow-ups due.
  const fuDue = all(`SELECT COUNT(*) c FROM engagement_log WHERE followup=1`).c;
  const fuOverdue = all(`SELECT COUNT(*) c FROM engagement_log WHERE followup=1 AND date < date('now','-14 days')`).c;

  const stat = (n, label, href) => `<a class="stat" href="${href}"><span class="num">${n}</span>${esc(label)}</a>`;

  const body = `<div class="page-head"><h1>This week</h1>
    <div>
      <a class="csvbtn" href="/api/calendar.ics">Export deadlines (.ics)</a>
      <button class="primary" onclick="DMU.weeklyBriefing(this)">Generate weekly briefing</button>
    </div></div>

    <div class="stats">
      ${stat(newParl, 'new parliamentary', '/digest')}
      ${stat(newInq, 'new inquiries', '/committees')}
      ${stat(newCons, 'new consultations', '/consultations')}
      ${stat(newTT, 'new think-tank reports', '/sector?tab=think_tank')}
      ${stat(fuDue, `follow-ups due${fuOverdue ? ` (${fuOverdue} overdue)` : ''}`, '/engagement')}
    </div>

    <div id="briefing-out" class="briefing" hidden>
      <div class="slideout-head" style="border-radius:8px 8px 0 0"><strong>Weekly briefing</strong>
        <button class="close" onclick="document.getElementById('briefing-out').hidden=true">×</button></div>
      <textarea id="briefing-text" rows="18"></textarea>
      <div class="draft-actions"><button onclick="DMU.copyBriefing()">Copy</button>
        <button onclick="DMU.weeklyBriefing(this)">Regenerate</button></div>
    </div>

    <section><h2>Response deadlines — next ${HORIZON} working days <span class="count">${deadlines.length}</span></h2>
      ${deadlines.length ? `<table><thead><tr><th>Left</th><th>Body</th><th>Title</th><th>Type</th><th></th></tr></thead><tbody>${deadlineRows}</tbody></table>`
        : '<p class="empty">No relevant response deadlines inside the horizon.</p>'}</section>

    <section><h2>Oral-question submission cut-offs <span class="count">${oralRows.length}</span></h2>
      ${oralRows.length ? `<table><thead><tr><th>Left</th><th>Department</th><th>Session</th><th>Deadline</th></tr></thead><tbody>${oralRows.join('')}</tbody></table>`
        : '<p class="empty">No upcoming oral-question sessions for the key departments.</p>'}</section>`;

  res.send(layout({ title: 'This week', body, active: '/action' }));
});

module.exports = router;
