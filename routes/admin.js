'use strict';

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');

const PU_ROLES = [
  ['team', 'Policy Unit Team', 'policy.dmu.ac.uk/policy-unit-team/'],
  ['steering', 'Steering Group', 'policy.dmu.ac.uk/steering-group/'],
  ['advisor', 'Advisors', 'policy.dmu.ac.uk/policy-unit-advisors/'],
  ['fellow', 'Policy Fellows', 'policy.dmu.ac.uk/visiting-scholars/'],
];

function policyUnitPanel(members) {
  const byRole = {};
  for (const m of members) (byRole[m.policy_unit_role] = byRole[m.policy_unit_role] || []).push(m);
  const sections = PU_ROLES.map(([key, label, source]) => {
    const list = byRole[key] || [];
    const rows = list.map((m) =>
      `<li><a href="/academics/${m.id}">${esc(m.name)}</a>${m.department ? ` <span class="dept">${esc(m.department)}</span>` : ''}</li>`).join('');
    return `<div class="pu-role">
      <h3>${esc(label)} <span class="count">${list.length}</span></h3>
      <p class="why">Source: <code>${esc(source)}</code> — paste names (one per line) from that page; existing academics get flagged, unmatched names are reported back so you know who's missing from the directory.</p>
      <ul class="intel">${rows || '<li class="empty">No members assigned yet.</li>'}</ul>
      <form class="inline" onsubmit="return DMU.savePolicyUnit(event, '${key}')">
        <textarea name="names" rows="4" cols="48" placeholder="Dr Jane Bloggs&#10;Prof John Smith"></textarea>
        <button>Add ${esc(label.toLowerCase())}</button>
      </form>
    </div>`;
  }).join('');
  return `<div class="pu-panel">
    <p class="why">The Policy Unit site blocks automated scraping, so members are added by paste. Names are matched against the academic directory by normalised name.
      <button type="button" class="danger" onclick="DMU.clearPolicyUnit()" style="margin-left:10px">Clear all roles</button></p>
    <div class="pu-grid">${sections}</div>
  </div>`;
}

router.get('/', (req, res) => {
  const groups = all('SELECT * FROM keyword_groups ORDER BY name');
  const bodies = all('SELECT * FROM professional_bodies ORDER BY name');
  const logs = all('SELECT * FROM fetch_log ORDER BY started_at DESC LIMIT 40');
  const context = all('SELECT * FROM dmu_context ORDER BY key');
  const puMembers = all(
    `SELECT id, name, department, policy_unit_role FROM academics
     WHERE policy_unit_role IS NOT NULL ORDER BY policy_unit_role, name`);
  const claudeOn = require('../services/claude').isConfigured();
  const heuristicN = require('../services/relevance').heuristicCount();

  // ---- Academic directory coverage ----
  const cov = {
    total: get('SELECT COUNT(*) c FROM academics').c,
    bySource: all(`SELECT COALESCE(source,'unknown') s, COUNT(*) c FROM academics GROUP BY s`),
    withProfile: get(`SELECT COUNT(*) c FROM academics WHERE profile_text IS NOT NULL AND profile_text != ''`).c,
    withPubs: get(`SELECT COUNT(*) c FROM academics WHERE publications_json IS NOT NULL AND publications_json NOT IN ('', '[]')`).c,
    matchable: get(`SELECT COUNT(*) c FROM academics WHERE (profile_text IS NOT NULL AND profile_text != '')
                    OR (publications_json IS NOT NULL AND publications_json NOT IN ('', '[]'))`).c,
    awaitingScrape: get(`SELECT COUNT(*) c FROM academics WHERE profile_url IS NOT NULL AND profile_url != ''
                         AND (publications_json IS NULL OR publications_json IN ('', '[]'))`).c,
    legacyTotal: get('SELECT COUNT(*) c FROM academics_legacy').c,
  };
  const lastCrawl = (src) => {
    const l = get(`SELECT items_fetched, items_new, completed_at FROM fetch_log
      WHERE source = ? ORDER BY started_at DESC LIMIT 1`, [src]);
    return l ? `${l.items_fetched} fetched, ${l.items_new} new — ${(l.completed_at || '').slice(0,16).replace('T',' ')}` : 'never run';
  };

  const groupRows = groups.map((g) => `<tr>
    <td><button type="button" class="watchstar ${g.watched ? 'on' : ''}" title="Watch this topic"
        onclick="DMU.toggleWatch(${g.id}, this)">${g.watched ? '★' : '☆'}</button> ${esc(g.name)}</td>
    <td><form class="inline" onsubmit="return DMU.saveKeywords(event, ${g.id})">
      <input name="keywords" value="${esc(g.keywords)}" size="60">
      <button>Save</button>
      <button type="button" class="danger" onclick="DMU.deleteGroup(${g.id})">Delete</button>
    </form></td></tr>`).join('');

  const bodyRows = bodies.map((b) => `<tr>
    <td>${esc(b.name)}</td>
    <td><form class="inline" onsubmit="return DMU.saveBody(event, ${b.id})">
      <input name="departments_json" value="${esc(b.departments_json||'')}" placeholder='["Dept"]' size="30">
      <input name="scrape_selectors" value="${esc(b.scrape_selectors||'')}" placeholder="selectors JSON" size="30">
      <button>Save</button>
    </form></td></tr>`).join('');

  const SOURCES = ['hansard','writtenQuestions','committees','committeesRoster','govuk','whatson','feeds','guardian','thinktanks','briefings','appgs','alliance','bills','petitions','legislation','edms','oralQuestions','contensis','staffXml','dmuEvents','ukri','commonsRefresh','lordsRefresh','mpRefresh','email','deadlineAlerts','briefing'];
  const logBySource = {};
  for (const l of logs) if (!logBySource[l.source]) logBySource[l.source] = l;
  const logRows = SOURCES.map((s) => {
    const l = logBySource[s];
    return `<tr>
      <td>${esc(s)}</td>
      <td>${l ? esc((l.completed_at||l.started_at||'').slice(0,16).replace('T',' ')) : '—'}</td>
      <td>${l ? l.items_fetched : '—'}</td>
      <td>${l ? l.items_new : '—'}</td>
      <td class="err">${l && l.error ? esc(l.error.slice(0,80)) : ''}</td>
      <td><button onclick="DMU.runSource('${s}',this)">Run now</button></td>
    </tr>`;
  }).join('');

  const ctxRows = context.map((c) => `<tr>
    <td>${esc(c.key)}</td>
    <td><form class="inline" onsubmit="return DMU.saveContext(event, '${esc(c.key)}')">
      <input name="value" value="${esc(c.value)}" size="60"><button>Save</button>
    </form></td></tr>`).join('');

  let queuePending = 0;
  try { queuePending = require('../jobs/queue').pending(); } catch { /* table may be new */ }

  const pct = (n) => cov.total ? Math.round((n / cov.total) * 100) : 0;
  const sourceLabel = { contensis: 'Contensis API', xml: 'Staff XML listing', legacy: 'Legacy (Access)', unknown: 'Unknown' };
  const covSourceRows = cov.bySource.map((r) =>
    `<tr><td>${esc(sourceLabel[r.s] || r.s)}</td><td>${r.c}</td></tr>`).join('');

  const coverageBody = `<div class="pad">
      <div class="stats">
        <div class="stat"><span class="num">${cov.total}</span>academics in directory</div>
        <div class="stat"><span class="num">${cov.matchable}</span>matchable (${pct(cov.matchable)}%)</div>
        <div class="stat"><span class="num">${cov.withPubs}</span>with publications</div>
        <div class="stat"><span class="num">${cov.awaitingScrape}</span>awaiting profile scrape</div>
      </div>
      <table><thead><tr><th>By source</th><th>Count</th></tr></thead><tbody>${covSourceRows || '<tr><td colspan="2" class="empty">No academics yet — run the Contensis crawl.</td></tr>'}</tbody></table>
      <p class="why">
        <b>Matchable</b> = has profile text or publications (otherwise searchable by name only, weak at topic matching).
        <b>Awaiting profile scrape</b> = have a profile URL (e.g. XML-listing stubs) but no publications yet — run <code>staffXml</code> then the publication scraper.<br>
        Last Contensis crawl: ${lastCrawl('contensis')} · Last staff XML/legacy: ${lastCrawl('staffXml')} · Legacy records on file: ${cov.legacyTotal}
      </p></div>`;

  const body = `<div class="dash-head"><h1>Admin</h1>
      <span class="sub">data sources, keywords & drafting context</span>
      <span class="spacer"></span>
      <span class="pill">Background queue: ${queuePending} pending</span></div>
    <div class="panelgrid">
      ${panel({ title: 'Academic directory coverage', body: coverageBody, style: 'grid-column:1/-1;' })}
      ${panel({ title: 'Relevance curation', pad: true, style: 'grid-column:1/-1;', body: `
        <p class="why">Curation mode: <b>${claudeOn ? 'Claude AI judgement' : 'keyword-only heuristic'}</b>${claudeOn ? '' : ' — no API key set'}.
          ${heuristicN} item${heuristicN === 1 ? '' : 's'} currently scored by the free keyword heuristic (labelled <span class="tag grey">keyword match</span>).</p>
        ${claudeOn
          ? `<p>Re-judge the ${heuristicN} keyword-scored item${heuristicN === 1 ? '' : 's'} with Claude so the backlog is upgraded to full AI curation.</p>
             <button ${heuristicN ? '' : 'disabled'} onclick="DMU.reassess(this)">Re-assess ${heuristicN} item${heuristicN === 1 ? '' : 's'} with Claude</button>`
          : `<p class="why">Add <code>ANTHROPIC_API_KEY</code> to enable AI curation. New items are then judged automatically; click here afterwards to re-assess the ${heuristicN} existing keyword-scored item${heuristicN === 1 ? '' : 's'}.</p>
             <button disabled title="Set ANTHROPIC_API_KEY first">Re-assess with Claude (needs key)</button>`}` })}
      ${panel({ title: 'DMU Policy Unit members', pad: true, style: 'grid-column:1/-1;', body: policyUnitPanel(puMembers) })}
      ${panel({ title: 'Keyword groups', pad: true, body:
        `<table><thead><tr><th>Group</th><th>Keywords (comma-separated)</th></tr></thead><tbody>${groupRows}</tbody></table>
        <form class="inline" onsubmit="return DMU.addGroup(event)">
          <input name="name" placeholder="New group name" required>
          <input name="keywords" placeholder="keyword, keyword" size="40">
          <button>Add group</button>
        </form>` })}
      ${panel({ title: 'Professional bodies', pad: true, body:
        `<table><thead><tr><th>Body</th><th>Mappings</th></tr></thead><tbody>${bodyRows}</tbody></table>` })}
      ${panel({ title: 'Fetch log', pad: true, style: 'grid-column:1/-1;', body:
        `<table><thead><tr><th>Source</th><th>Last run</th><th>Fetched</th><th>New</th><th>Error</th><th></th></tr></thead>
        <tbody>${logRows}</tbody></table>` })}
      ${panel({ title: 'DMU context (drafting)', pad: true, style: 'grid-column:1/-1;', body:
        `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${ctxRows}</tbody></table>
        <form class="inline" onsubmit="return DMU.addContext(event)">
          <input name="key" placeholder="key" required><input name="value" placeholder="value" size="50">
          <button>Add</button></form>` })}
    </div>`;

  res.send(layout({ title: 'Admin', body, active: '/admin' }));
});

module.exports = router;
