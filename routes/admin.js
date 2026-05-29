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

  const SOURCES = ['hansard','writtenQuestions','committees','govuk','whatson','feeds','guardian','bills','petitions','legislation','edms','oralQuestions','contensis','staffXml','mpRefresh','email'];
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

  const body = `<div class="page-head"><h1>Admin</h1></div>
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
