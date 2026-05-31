'use strict';

/**
 * Strategic dashboard — the landing page. A deliberately no-scroll executive
 * summary for DMU public-affairs strategy, leading with what is *moving* (topic
 * momentum), then what must be acted on, what's newly relevant, and who to
 * engage. Reference views (full diary, sector browse, UA peers, MP directory)
 * live off the nav, not here. The detailed operational view is /action.
 */

const express = require('express');
const router = express.Router();
const { all, get, ageNewFlags } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const claude = require('../services/claude');
const { targetList } = require('./engagement');

const RELEVANT = `(relevance_checked = 0 OR relevance_level IN ('high','medium'))`;
const interestOk = (r) => !r.relevance_checked || ['high', 'medium'].includes(r.relevance_level);
const ragClass = (wd) => wd == null || wd < 0 ? 'grey' : wd < 7 ? 'red' : wd <= 14 ? 'amber' : 'green';
const slug = (s) => String(s || '').replace(/\W/g, '');

/**
 * Topic momentum — which DMU topics are heating up. Compares mentions in the
 * last 14 days against the prior 14, across parliamentary items, committee
 * inquiries, consultations and sector items. Rising topics are where DMU should
 * position before an issue becomes a formal opportunity.
 */
function risingTopics() {
  // Per-table counts in window A (last 14d) and B (prior 14d), unioned by group.
  const q = (table, gcol, dcol) => all(
    `SELECT ${gcol} AS g,
            SUM(CASE WHEN date(${dcol}) >= date('now','-14 days') THEN 1 ELSE 0 END) AS a,
            SUM(CASE WHEN date(${dcol}) <  date('now','-14 days')
                     AND date(${dcol}) >= date('now','-28 days') THEN 1 ELSE 0 END) AS b
     FROM ${table}
     WHERE ${gcol} IS NOT NULL AND ${gcol} != '' AND ${dcol} IS NOT NULL
       AND date(${dcol}) >= date('now','-28 days') AND ${RELEVANT}
     GROUP BY ${gcol}`);
  const rows = [
    ...q('parliamentary_items', 'keyword_group', 'date'),
    ...q('committee_inquiries', 'keyword_group', "COALESCE(date_opened, created_at)"),
    ...q('consultations', 'keyword_group', "COALESCE(opened, created_at)"),
    // external_items can carry multiple groups; take the first for bucketing.
    ...all(
      `SELECT TRIM(SUBSTR(keyword_groups,1,INSTR(keyword_groups||',',',')-1)) AS g,
              SUM(CASE WHEN date(COALESCE(date,created_at)) >= date('now','-14 days') THEN 1 ELSE 0 END) AS a,
              SUM(CASE WHEN date(COALESCE(date,created_at)) <  date('now','-14 days')
                       AND date(COALESCE(date,created_at)) >= date('now','-28 days') THEN 1 ELSE 0 END) AS b
       FROM external_items
       WHERE keyword_groups IS NOT NULL AND keyword_groups != ''
         AND relevance_level IN ('high','medium')
         AND date(COALESCE(date,created_at)) >= date('now','-28 days')
       GROUP BY g`),
  ];
  const agg = {};
  for (const r of rows) {
    if (!r.g) continue;
    const k = r.g;
    agg[k] = agg[k] || { g: k, a: 0, b: 0 };
    agg[k].a += r.a || 0; agg[k].b += r.b || 0;
  }
  return Object.values(agg)
    .map((t) => ({ ...t, delta: t.a - t.b }))
    .filter((t) => t.a > 0)
    // Rank: rising first (biggest positive delta), then by current volume.
    .sort((x, y) => (y.delta - x.delta) || (y.a - x.a))
    .slice(0, 8);
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
  if (!claudeOn) health.push({ cls: 'info', html: '<b>Keyword-only curation</b> — no Claude key set; relevance is ranked by topic + DMU expertise. <a href="/admin">Admin →</a>' });
  if (hoursSinceFetch == null) health.push({ cls: 'warn', html: '<b>No data fetched yet.</b> Run sources from <a href="/admin">Admin</a>.' });
  else if (hoursSinceFetch > 26) health.push({ cls: 'warn', html: `<b>Data may be stale</b> — last fetch ${Math.round(hoursSinceFetch)}h ago. <a href="/admin">Admin →</a>` });
  if (failing.length) health.push({ cls: 'warn', html: `<b>${failing.length} source${failing.length === 1 ? '' : 's'} failing.</b> <a href="/admin">Admin →</a>` });
  const healthBar = health.length ? `<div class="healthbar">${health.map((h) => `<div class="hb ${h.cls}">${h.html}</div>`).join('')}</div>` : '';

  // ---- TILE 1 (lead): Rising topics ---------------------------------------
  const rising = risingTopics();
  const risingBody = rising.length ? `<div class="movers">${rising.map((t) => {
    const arrow = t.delta > 0 ? `<span class="mv-up">▲ +${t.delta}</span>`
      : t.delta < 0 ? `<span class="mv-down">▼ ${t.delta}</span>` : '<span class="mv-flat">●</span>';
    return `<a class="mover" href="/digest#g-${slug(t.g)}">
      <span class="mv-topic">${esc(t.g)}</span>
      <span class="mv-stat">${t.a} mention${t.a === 1 ? '' : 's'} <span class="muted">/ 2wk</span> ${arrow}</span>
    </a>`;
  }).join('')}</div>`
    : '<p class="empty">Not enough recent activity to read momentum yet.</p>';

  // ---- TILE 2: Act now — closing deadlines --------------------------------
  const deadlines = [
    ...all(`SELECT id, committee_name AS org, inquiry_title AS title, working_days_remaining AS wdr, url,
                   relevance_checked, relevance_level, 'committee_inquiry' AS kind
            FROM committee_inquiries WHERE evidence_status='AcceptingEvidence'
              AND working_days_remaining BETWEEN 0 AND 15`).filter(interestOk),
    ...all(`SELECT id, organisation AS org, title, working_days_remaining AS wdr, url,
                   relevance_checked, relevance_level, 'consultation' AS kind
            FROM consultations WHERE working_days_remaining BETWEEN 0 AND 15`).filter(interestOk),
  ].sort((a, b) => a.wdr - b.wdr).slice(0, 8);
  const actBody = deadlines.length ? `<div class="plist">${deadlines.map((d) => `
    <a href="/item/${d.kind}/${d.id}">
      <span class="wdr ${ragClass(d.wdr)}">${d.wdr}wd</span>
      <span class="t">${esc(d.title)}<br><span class="muted">${esc(d.org || '')} · ${d.kind === 'committee_inquiry' ? 'Committee' : 'Consultation'}</span></span>
      <button onclick="event.preventDefault();DMU.openDraft(${d.id},'${d.kind}','committee_submission')">Draft</button>
    </a>`).join('')}</div>`
    : '<p class="empty">No relevant deadlines in the next 15 working days.</p>';

  // ---- TILE 3: New & relevant (last 48h) ----------------------------------
  const recent = [
    ...all(`SELECT id, inquiry_title AS title, created_at, 'committee_inquiry' AS kind, 'Inquiry' AS tag, keyword_group AS grp
            FROM committee_inquiries WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'consultation' AS kind, 'Consultation' AS tag, keyword_group AS grp
            FROM consultations WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'parliamentary_item' AS kind, source AS tag, keyword_group AS grp
            FROM parliamentary_items WHERE created_at >= datetime('now','-2 days') AND ${RELEVANT}`),
    ...all(`SELECT id, title, created_at, 'external_item' AS kind, source_name AS tag, keyword_groups AS grp
            FROM external_items WHERE created_at >= datetime('now','-2 days') AND relevance_level IN ('high','medium')`),
  ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 10);
  const newBody = recent.length ? `<div class="plist">${recent.map((r) => `
    <a href="/item/${r.kind}/${r.id}">
      <span class="tag pink">${esc(r.tag || 'New')}</span>
      <span class="t">${esc(r.title || '(untitled)')}<br><span class="muted">${esc((r.grp || '').split(',')[0] || '')}</span></span>
    </a>`).join('')}</div>`
    : '<p class="empty">Nothing new in the last 48 hours.</p>';

  // ---- TILE 4: Engage — MPs newly active on our topics, never contacted ----
  let targets = [];
  try { targets = targetList('').slice(0, 8); } catch { /* ignore */ }
  const engageBody = targets.length ? `<div class="plist">${targets.map((m) => `
    <a href="/mps/${m.id}">
      <span class="t">${esc(m.first_name)} ${esc(m.last_name)}<br><span class="muted">${esc(m.party || '')}${m.constituency ? ' · ' + esc(m.constituency) : ''}</span></span>
      <span class="mv-stat"><b>${m.activity}</b> <span class="muted">on our topics</span></span>
    </a>`).join('')}</div>`
    : '<p class="empty">No untouched MPs are active on DMU topics right now.</p>';

  // ---- Strategic summary line: AI-written, held back until Claude is funded -
  const summaryLine = claudeOn
    ? '<div class="state-of-play" id="sop"><button onclick="DMU.stateOfPlay(this)">✨ Brief me — write today\'s state of play</button></div>'
    : '';

  const printBtn = '<button onclick="window.print()" title="Print or save as PDF">🖨 Print</button>';
  const body = `<div class="dash-head"><h1>${greeting}</h1>
      <span class="sub">DMU public affairs · ${esc(fullDate)}</span>
      <span class="spacer"></span>
      ${printBtn}
      <a class="kpi-link" href="/action">Full command centre →</a></div>
    ${healthBar}
    ${summaryLine}
    <div class="dashgrid strat-grid">
      ${panel({ title: '📈 Rising topics — where to position', count: rising.length,
        actions: '<span class="muted">last 2 weeks vs prior</span>', body: risingBody, pad: true,
        style: 'grid-column:1/-1; max-height:30vh;' })}
      ${panel({ title: '🎯 Act now — closing deadlines', count: deadlines.length,
        actions: '<a class="csvbtn" href="/api/calendar.ics">.ics</a>', body: actBody, pad: true })}
      ${panel({ title: '🆕 New & relevant', count: recent.length,
        actions: '<a href="/digest">Digest →</a>', body: newBody, pad: true })}
      ${panel({ title: '🤝 Engage — active, not yet contacted', count: targets.length,
        actions: '<a href="/engagement">Engagement →</a>', body: engageBody, pad: true })}
    </div>`;

  res.send(layout({ title: 'Dashboard', body, active: '/dashboard', dashboard: true }));
});

module.exports = router;
