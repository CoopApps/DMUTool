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
const { layout, panel, esc } = require('../lib/render');
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
  const newInq = get(`SELECT COUNT(*) c FROM committee_inquiries WHERE is_new=1 AND ${RELEVANT}`).c;
  const newCons = get(`SELECT COUNT(*) c FROM consultations WHERE is_new=1 AND ${RELEVANT}`).c;
  const newParl = get(`SELECT COUNT(*) c FROM parliamentary_items WHERE is_new=1`).c;
  const newTT = get(`SELECT COUNT(*) c FROM external_items WHERE source_type='think_tank' AND created_at >= datetime('now','-1 day') AND relevance_level IN ('high','medium')`).c;

  // 4) Follow-ups due.
  const fuDue = get(`SELECT COUNT(*) c FROM engagement_log WHERE followup=1`).c;
  const fuOverdue = get(`SELECT COUNT(*) c FROM engagement_log WHERE followup=1 AND date < date('now','-14 days')`).c;

  // 5) University Alliance peer activity this week.
  const peerItems = get(`SELECT COUNT(*) c FROM ua_activity WHERE date >= date('now','-7 days')`).c;
  const peerActive = get(`SELECT COUNT(DISTINCT member) c FROM ua_activity WHERE date >= date('now','-7 days')`).c;

  // 6) Curated priorities — top items the gate passed, most urgent/new first.
  const priorities = all(
    `SELECT id, title, keyword_group, relevance_level, date, 'parliamentary_item' AS kind
       FROM parliamentary_items
      WHERE relevance_level IN ('high','medium') AND date >= date('now','-14 days')
      ORDER BY (relevance_level='high') DESC, date DESC LIMIT 30`
  );

  // 7) This week in Parliament (diary, keyword-matched first).
  const diaryWk = all(
    `SELECT title, house, date, keyword_match FROM diary_events
      WHERE date BETWEEN date('now') AND date('now','+7 days')
      ORDER BY keyword_match DESC, date ASC LIMIT 40`
  );

  // 8) Sector headlines — recent relevant think-tank / sector reports.
  const sector = all(
    `SELECT id, title, source_name, date FROM external_items
      WHERE source_type IN ('think_tank','briefing') AND relevance_level IN ('high','medium')
      ORDER BY COALESCE(date, created_at) DESC LIMIT 20`
  );

  const kpi = (n, label, href, cls = '') =>
    `<a class="kpi ${cls}" href="${href}"><span class="num">${n}</span><span class="lbl">${esc(label)}</span></a>`;

  const deadlineList = deadlines.length ? `<div class="plist">${deadlines.map((d) => `
    <a href="${esc(d.url || '#')}" target="_blank" rel="noopener">
      <span class="wdr ${ragClass(d.wdr)}">${d.wdr}wd</span>
      <span class="t">${esc(d.title)}<br><span class="muted">${esc(d.org || '')} · ${d.kind === 'committee_inquiry' ? 'Committee' : 'Consultation'}</span></span>
      <button onclick="event.preventDefault();DMU.openDraft(${d.id},'${d.kind}','committee_submission')">Draft</button>
    </a>`).join('')}</div>` : '<p class="empty">No relevant deadlines in the next 15 working days.</p>';

  const priorityList = priorities.length ? `<div class="plist">${priorities.map((p) => `
    <a href="/item/${p.kind}/${p.id}">
      <span class="tag ${p.relevance_level === 'high' ? 'green' : 'amber'}">${p.relevance_level}</span>
      <span class="t">${esc(p.title)}<br><span class="muted">${esc(p.keyword_group || '')} · ${esc((p.date || '').slice(0, 10))}</span></span>
      <span></span>
    </a>`).join('')}</div>` : '<p class="empty">No curated priorities — items are still being assessed, or none meet the threshold.</p>';

  const diaryList = diaryWk.length ? `<div class="plist">${diaryWk.map((e) => `
    <span class="pli">
      <span class="when muted">${esc((e.date || '').slice(5, 10))}</span>
      <span class="t">${e.keyword_match ? '★ ' : ''}${esc(e.title)}</span>
      <span class="muted">${esc(e.house || '')}</span>
    </span>`).join('')}</div>` : '<p class="empty">No sitting events scheduled this week.</p>';

  const oralList = oralRows.length
    ? `<table><thead><tr><th>Left</th><th>Department</th><th>Submit by</th></tr></thead><tbody>${
        oralRows.join('').replace(/<td>Session [^<]*<\/td>/g, '')}</tbody></table>`
    : '<p class="empty">No upcoming oral-question sessions for the key departments.</p>';

  const sectorList = sector.length ? `<div class="plist">${sector.map((s) => `
    <a href="/item/external_item/${s.id}">
      <span class="when muted">${esc((s.date || '').slice(0, 10))}</span>
      <span class="t">${esc(s.title)}</span>
      <span class="muted">${esc(s.source_name || '')}</span>
    </a>`).join('')}</div>` : '<p class="empty">No recent relevant sector reports.</p>';

  const peerList = `<div class="panel-body pad"><p>${peerItems} University Alliance peer items in the last 7 days, across ${peerActive} peers.</p>
    <p>${fuDue} engagement follow-up${fuDue === 1 ? '' : 's'} due${fuOverdue ? ` — <b style="color:var(--red)">${fuOverdue} overdue</b>` : ''}.</p>
    <p><a href="/alliance">UA peers →</a> · <a href="/engagement">Engagement →</a></p></div>`;

  const grid = `<div class="dashgrid" style="grid-template-columns:1.2fr 1fr 1fr;grid-template-rows:1fr 1fr;">
    ${panel({ title: 'Response deadlines', count: deadlines.length,
      actions: '<a class="csvbtn" href="/api/calendar.ics">.ics</a>', body: deadlineList })}
    ${panel({ title: 'Priorities — curated', count: priorities.length,
      actions: '<a href="/digest">Digest →</a>', body: priorityList })}
    ${panel({ title: 'This week in Parliament', count: diaryWk.length,
      actions: '<a href="/diary">Diary →</a>', body: diaryList })}
    ${panel({ title: 'Oral-question cut-offs', count: oralRows.length, body: oralList, pad: true })}
    ${panel({ title: 'Sector headlines', count: sector.length,
      actions: '<a href="/sector">Sector watch →</a>', body: sectorList })}
    ${panel({ title: 'Engagement & UA peers', body: peerList })}
  </div>`;

  const dashBody = `<div class="dash-head"><h1>Command centre</h1>
      <span class="sub">DMU public affairs — week of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span>
      <span class="spacer"></span>
      <button class="primary" onclick="DMU.weeklyBriefing(this)">Generate weekly briefing</button></div>
    <div class="dash-kpis">
      ${kpi(deadlines.length, 'deadlines ≤15wd', '#', deadlines.some((d) => d.wdr < 7) ? 'warn' : '')}
      ${kpi(newParl, 'new parliamentary', '/digest')}
      ${kpi(newInq, 'new inquiries', '/committees')}
      ${kpi(newCons, 'new consultations', '/consultations')}
      ${kpi(newTT, 'new sector reports', '/sector')}
      ${kpi(fuDue, `follow-ups due${fuOverdue ? ` (${fuOverdue} late)` : ''}`, '/engagement', fuOverdue ? 'warn' : '')}
    </div>
    <div id="briefing-out" class="briefing" hidden>
      <div class="slideout-head" style="border-radius:8px 8px 0 0"><strong>Weekly briefing</strong>
        <button class="close" onclick="document.getElementById('briefing-out').hidden=true">×</button></div>
      <textarea id="briefing-text" rows="18"></textarea>
      <div class="draft-actions"><button onclick="DMU.copyBriefing()">Copy</button>
        <button onclick="DMU.weeklyBriefing(this)">Regenerate</button></div>
    </div>
    ${grid}`;

  res.send(layout({ title: 'Command centre', body: dashBody, active: '/action', dashboard: true }));
});

module.exports = router;
