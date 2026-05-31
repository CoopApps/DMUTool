'use strict';

/**
 * Strategic dashboard — the landing page. Answers one question first: "What can
 * I do TODAY to make DMU public affairs more impactful?" A single prioritised
 * action list (each item a concrete next step with a button), followed by a
 * compact "be aware of" band (rising topics + newly relevant) that you can see
 * but don't have to act on. The full operational view is /action; reference
 * views live off the nav.
 */

const express = require('express');
const router = express.Router();
const { all, get, ageNewFlags } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const claude = require('../services/claude');
const matcher = require('../services/matcher');
const { targetList } = require('./engagement');

const RELEVANT = `(relevance_checked = 0 OR relevance_level IN ('high','medium'))`;
const interestOk = (r) => !r.relevance_checked || ['high', 'medium'].includes(r.relevance_level);
const slug = (s) => String(s || '').replace(/\W/g, '');

/**
 * Build today's prioritised action list. Each action is a concrete next step
 * with an urgency score (lower = do sooner), a category, verb-led text and an
 * inline button. Drawn from deadlines, overdue follow-ups, untouched active MPs
 * and strong-expertise opportunities.
 */
function buildActions() {
  const actions = [];

  // 1) Respond to closing deadlines with no recorded DMU response.
  const noResp = `submitted = 0 AND (contributors IS NULL OR contributors='') AND (submission_url IS NULL OR submission_url='')`;
  const inq = all(
    `SELECT id, committee_name AS org, inquiry_title AS title, working_days_remaining AS wdr, 'committee_inquiry' AS kind,
            relevance_checked, relevance_level
     FROM committee_inquiries WHERE evidence_status='AcceptingEvidence'
       AND working_days_remaining BETWEEN 0 AND 20 AND ${noResp}`).filter(interestOk);
  const cons = all(
    `SELECT id, organisation AS org, title, working_days_remaining AS wdr, 'consultation' AS kind,
            relevance_checked, relevance_level
     FROM consultations WHERE working_days_remaining BETWEEN 0 AND 20 AND ${noResp}`).filter(interestOk);
  for (const d of [...inq, ...cons]) {
    const expertise = matcher.expertiseSignal(d.id, d.kind);
    const expertNote = expertise.strong ? ' · DMU has strong expertise here'
      : expertise.count ? ` · ${expertise.count} possible DMU expert${expertise.count === 1 ? '' : 's'}` : '';
    actions.push({
      urgency: d.wdr,                         // working days left = primary sort
      cat: 'Respond', cls: d.wdr < 7 ? 'red' : d.wdr <= 14 ? 'amber' : 'green',
      lead: `Draft DMU evidence`,
      detail: `${esc(d.title)} <span class="muted">— ${esc(d.org || '')}, closes in <b>${d.wdr} working day${d.wdr === 1 ? '' : 's'}</b>${expertNote}</span>`,
      btn: `<button onclick="DMU.openDraft(${d.id},'${d.kind}','committee_submission')">Draft</button>`,
      link: `/item/${d.kind}/${d.id}`,
    });
  }

  // 2) Chase overdue engagement follow-ups.
  const fu = all(
    `SELECT el.id, el.date, el.description, m.id AS mp_id, m.first_name, m.last_name
     FROM engagement_log el JOIN mps m ON m.id = el.mp_id
     WHERE el.followup = 1 AND el.date < date('now','-14 days') ORDER BY el.date ASC LIMIT 10`);
  for (const f of fu) {
    const days = Math.round((Date.now() - Date.parse(f.date)) / 864e5);
    actions.push({
      urgency: 2,                              // overdue chases rank near the top
      cat: 'Follow up', cls: 'amber',
      lead: `Chase ${esc(f.first_name)} ${esc(f.last_name)}`,
      detail: `follow-up flagged ${days} days ago${f.description ? ` <span class="muted">— ${esc(f.description)}</span>` : ''}`,
      btn: `<a class="btnlink" href="/mps/${f.mp_id}#log">Open</a>`,
      link: `/mps/${f.mp_id}#log`,
    });
  }

  // 3) Engage MPs active on our topics we've never contacted (top few).
  let targets = [];
  try { targets = targetList('').slice(0, 4); } catch { /* ignore */ }
  for (const m of targets) {
    actions.push({
      urgency: 12,                             // worth doing, not time-critical
      cat: 'Engage', cls: 'green',
      lead: `Reach out to ${esc(m.first_name)} ${esc(m.last_name)}`,
      detail: `${esc(m.party || '')}${m.constituency ? ', ' + esc(m.constituency) : ''} <span class="muted">— <b>${m.activity}</b> recent contribution${m.activity === 1 ? '' : 's'} on DMU topics, never contacted</span>`,
      btn: `<button onclick="DMU.openDraft(0,'parliamentary_item','mp_email',${m.id})">Draft email</button>`,
      link: `/mps/${m.id}`,
    });
  }

  // Sort by urgency (soonest/most-overdue first), cap the list.
  return actions.sort((a, b) => a.urgency - b.urgency).slice(0, 12);
}

/** Topic momentum — last 14d vs prior 14d across all relevant sources. */
function risingTopics() {
  const q = (table, gcol, dcol) => all(
    `SELECT ${gcol} AS g,
            SUM(CASE WHEN date(${dcol}) >= date('now','-14 days') THEN 1 ELSE 0 END) AS a,
            SUM(CASE WHEN date(${dcol}) <  date('now','-14 days') AND date(${dcol}) >= date('now','-28 days') THEN 1 ELSE 0 END) AS b
     FROM ${table} WHERE ${gcol} IS NOT NULL AND ${gcol} != '' AND ${dcol} IS NOT NULL
       AND date(${dcol}) >= date('now','-28 days') AND ${RELEVANT} GROUP BY ${gcol}`);
  const rows = [
    ...q('parliamentary_items', 'keyword_group', 'date'),
    ...q('committee_inquiries', 'keyword_group', 'COALESCE(date_opened, created_at)'),
    ...q('consultations', 'keyword_group', 'COALESCE(opened, created_at)'),
    ...all(
      `SELECT TRIM(SUBSTR(keyword_groups,1,INSTR(keyword_groups||',',',')-1)) AS g,
              SUM(CASE WHEN date(COALESCE(date,created_at)) >= date('now','-14 days') THEN 1 ELSE 0 END) AS a,
              SUM(CASE WHEN date(COALESCE(date,created_at)) <  date('now','-14 days') AND date(COALESCE(date,created_at)) >= date('now','-28 days') THEN 1 ELSE 0 END) AS b
       FROM external_items WHERE keyword_groups IS NOT NULL AND keyword_groups != ''
         AND relevance_level IN ('high','medium') AND date(COALESCE(date,created_at)) >= date('now','-28 days') GROUP BY g`),
  ];
  const agg = {};
  for (const r of rows) { if (!r.g) continue; (agg[r.g] = agg[r.g] || { g: r.g, a: 0, b: 0 }); agg[r.g].a += r.a || 0; agg[r.g].b += r.b || 0; }
  return Object.values(agg).map((t) => ({ ...t, delta: t.a - t.b }))
    .filter((t) => t.a > 0).sort((x, y) => (y.delta - x.delta) || (y.a - x.a)).slice(0, 6);
}

router.get('/', (req, res) => {
  ageNewFlags();
  const claudeOn = claude.isConfigured();
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const fullDate = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---- Health strip (only when something needs attention) -----------------
  const lastOk = get(`SELECT MAX(completed_at) AS at FROM fetch_log WHERE error IS NULL`);
  const hoursSinceFetch = lastOk && lastOk.at ? (Date.now() - Date.parse(lastOk.at.replace(' ', 'T') + 'Z')) / 36e5 : null;
  const failing = all(`SELECT source FROM fetch_log WHERE id IN (SELECT MAX(id) FROM fetch_log GROUP BY source) AND error IS NOT NULL`);
  const health = [];
  if (!claudeOn) health.push({ cls: 'info', html: '<b>Keyword-only curation</b> — no Claude key; relevance ranked by topic + DMU expertise. <a href="/admin">Admin →</a>' });
  if (hoursSinceFetch == null) health.push({ cls: 'warn', html: '<b>No data fetched yet.</b> Run sources from <a href="/admin">Admin</a>.' });
  else if (hoursSinceFetch > 26) health.push({ cls: 'warn', html: `<b>Data may be stale</b> — last fetch ${Math.round(hoursSinceFetch)}h ago. <a href="/admin">Admin →</a>` });
  if (failing.length) health.push({ cls: 'warn', html: `<b>${failing.length} source${failing.length === 1 ? '' : 's'} failing.</b> <a href="/admin">Admin →</a>` });
  const healthBar = health.length ? `<div class="healthbar">${health.map((h) => `<div class="hb ${h.cls}">${h.html}</div>`).join('')}</div>` : '';

  // ===== THE MAIN EVENT: what you can do today =============================
  const actions = buildActions();
  const todoBody = actions.length ? `<ol class="todo">${actions.map((a) => `
    <li class="todo-item">
      <span class="todo-flag ${a.cls}">${esc(a.cat)}</span>
      <span class="todo-body"><a href="${a.link}"><b>${a.lead}</b></a> — ${a.detail}</span>
      <span class="todo-act">${a.btn}</span>
    </li>`).join('')}</ol>`
    : `<div class="todo-clear"><p><b>Nothing demands action today.</b></p>
       <p class="muted">No closing deadlines, overdue follow-ups or untouched active MPs. Scan "be aware of" below, or open the <a href="/action">command centre</a>.</p></div>`;

  // AI "where to focus" line — held back until Claude is funded.
  const focusLine = claudeOn
    ? '<div class="state-of-play" id="sop"><button onclick="DMU.stateOfPlay(this)">✨ Brief me — what should I focus on today?</button></div>'
    : '';

  // ===== BE AWARE OF: momentum + newly relevant (see, don't action) ========
  const rising = risingTopics();
  const risingBody = rising.length ? `<div class="movers">${rising.map((t) => {
    const arrow = t.delta > 0 ? `<span class="mv-up">▲ +${t.delta}</span>` : t.delta < 0 ? `<span class="mv-down">▼ ${t.delta}</span>` : '<span class="mv-flat">●</span>';
    return `<a class="mover" href="/digest#g-${slug(t.g)}"><span class="mv-topic">${esc(t.g)}</span>
      <span class="mv-stat">${t.a}/2wk ${arrow}</span></a>`;
  }).join('')}</div>` : '<p class="empty">Not enough recent activity to read momentum.</p>';

  const recent = [
    ...all(`SELECT id, inquiry_title AS title, created_at, 'committee_inquiry' AS kind, 'Inquiry' AS tag, keyword_group AS grp
            FROM committee_inquiries WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'consultation' AS kind, 'Consultation' AS tag, keyword_group AS grp
            FROM consultations WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'parliamentary_item' AS kind, source AS tag, keyword_group AS grp
            FROM parliamentary_items WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'external_item' AS kind, source_name AS tag, keyword_groups AS grp
            FROM external_items WHERE created_at >= datetime('now','-2 days') AND relevance_level IN ('high','medium')`),
  ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8);
  const newBody = recent.length ? `<div class="plist">${recent.map((r) => `
    <a href="/item/${r.kind}/${r.id}"><span class="tag pink">${esc(r.tag || 'New')}</span>
      <span class="t">${esc(r.title || '(untitled)')}<br><span class="muted">${esc((r.grp || '').split(',')[0] || '')}</span></span></a>`).join('')}</div>`
    : '<p class="empty">Nothing new in the last 48 hours.</p>';

  const printBtn = '<button onclick="window.print()" title="Print or save as PDF">🖨 Print</button>';
  const body = `<div class="dash-head"><h1>${greeting}</h1>
      <span class="sub">DMU public affairs · ${esc(fullDate)}</span>
      <span class="spacer"></span>
      ${printBtn}
      <a class="kpi-link" href="/action">Full command centre →</a></div>
    ${healthBar}
    ${focusLine}
    <div class="dash-split">
      ${panel({ title: '✅ Do today — to make DMU public affairs more impactful', count: actions.length,
        body: todoBody, pad: true, style: 'flex:1 1 auto; min-height:0;' })}
      <div class="aware-band">
        ${panel({ title: '📈 Rising topics', count: rising.length,
          actions: '<span class="muted">2wk vs prior</span>', body: risingBody, pad: true })}
        ${panel({ title: '🆕 New & relevant (48h)', count: recent.length,
          actions: '<a href="/digest">Digest →</a>', body: newBody, pad: true })}
      </div>
    </div>`;

  res.send(layout({ title: 'Dashboard', body, active: '/dashboard', dashboard: true }));
});

module.exports = router;
