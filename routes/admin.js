'use strict';

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db/database');
const { layout, esc } = require('../lib/render');

router.get('/', (req, res) => {
  const groups = all('SELECT * FROM keyword_groups ORDER BY name');
  const bodies = all('SELECT * FROM professional_bodies ORDER BY name');
  const logs = all('SELECT * FROM fetch_log ORDER BY started_at DESC LIMIT 40');
  const context = all('SELECT * FROM dmu_context ORDER BY key');

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
    <td>${esc(g.name)}</td>
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

  const SOURCES = ['hansard','writtenQuestions','committees','committeesRoster','govuk','whatson','feeds','guardian','thinktanks','briefings','appgs','alliance','bills','petitions','legislation','edms','oralQuestions','contensis','staffXml','dmuEvents','ukri','commonsRefresh','lordsRefresh','mpRefresh','email','briefing'];
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

  const body = `<div class="page-head"><h1>Admin</h1>
    <span class="pill">Background queue: ${queuePending} pending</span></div>

    <section><h2>Academic directory coverage</h2>
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
      </p>
    </section>

    <section><h2>Keyword groups</h2>
      <table><thead><tr><th>Group</th><th>Keywords (comma-separated)</th></tr></thead><tbody>${groupRows}</tbody></table>
      <form class="inline" onsubmit="return DMU.addGroup(event)">
        <input name="name" placeholder="New group name" required>
        <input name="keywords" placeholder="keyword, keyword" size="40">
        <button>Add group</button>
      </form>
    </section>
    <section><h2>Professional bodies</h2>
      <table><thead><tr><th>Body</th><th>Mappings</th></tr></thead><tbody>${bodyRows}</tbody></table></section>
    <section><h2>Fetch log</h2>
      <table><thead><tr><th>Source</th><th>Last run</th><th>Fetched</th><th>New</th><th>Error</th><th></th></tr></thead>
      <tbody>${logRows}</tbody></table></section>
    <section><h2>DMU context (drafting)</h2>
      <table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${ctxRows}</tbody></table>
      <form class="inline" onsubmit="return DMU.addContext(event)">
        <input name="key" placeholder="key" required><input name="value" placeholder="value" size="50">
        <button>Add</button></form>
    </section>`;

  res.send(layout({ title: 'Admin', body, active: '/admin' }));
});

module.exports = router;
