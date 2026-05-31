'use strict';

/**
 * Engagement view — the "acting" half of public affairs. Three intelligence-led
 * lists built from the MP table, the engagement log and recent parliamentary
 * activity:
 *   1. Follow-ups due — logged contacts flagged for follow-up (overdue first).
 *   2. Target list — MPs active on a tracked topic we've never contacted,
 *      ranked by volume of relevant recent activity. Exportable as CSV.
 *   3. Stale relationships — MPs we've engaged before but not in 6+ months who
 *      are active on our topics again.
 */

const express = require('express');
const router = express.Router();
const { all, get } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');

const ACTIVITY_DAYS = 90;
const STALE_DAYS = 180;

/** MPs active on tracked topics, never contacted, ranked by relevant activity. */
function targetList(group) {
  const groupClause = group ? 'AND pi.keyword_group = @group' : '';
  return all(
    `SELECT * FROM (
       SELECT m.id, m.first_name, m.last_name, m.party, m.constituency, m.email,
         (SELECT COUNT(*) FROM parliamentary_items pi
            WHERE pi.date >= date('now', @days)
              AND pi.member_name LIKE '%' || m.last_name || '%'
              ${groupClause}) AS activity
       FROM mps m
       WHERE m.is_active = 1
         AND NOT EXISTS (SELECT 1 FROM engagement_log el WHERE el.mp_id = m.id)
     ) WHERE activity > 0
     ORDER BY activity DESC LIMIT 100`,
    { days: `-${ACTIVITY_DAYS} days`, group }
  );
}

function staleList() {
  return all(
    `SELECT * FROM (
       SELECT m.id, m.first_name, m.last_name, m.party, m.constituency, m.email,
         (SELECT MAX(date) FROM engagement_log el WHERE el.mp_id = m.id) AS last_contact,
         (SELECT COUNT(*) FROM parliamentary_items pi
            WHERE pi.date >= date('now', @days)
              AND pi.member_name LIKE '%' || m.last_name || '%') AS activity
       FROM mps m
       WHERE EXISTS (SELECT 1 FROM engagement_log el WHERE el.mp_id = m.id)
     )
     WHERE activity > 0 AND (last_contact IS NULL OR last_contact < date('now', @stale))
     ORDER BY last_contact ASC LIMIT 100`,
    { days: `-${ACTIVITY_DAYS} days`, stale: `-${STALE_DAYS} days` }
  );
}

function followUps() {
  return all(
    `SELECT el.id, el.date, el.type, el.description, el.notes,
            m.id AS mp_id, m.first_name, m.last_name, m.party
     FROM engagement_log el JOIN mps m ON m.id = el.mp_id
     WHERE el.followup = 1 ORDER BY el.date ASC`
  );
}

router.get('/', (req, res) => {
  const group = req.query.group || '';
  const groups = all('SELECT name FROM keyword_groups ORDER BY name');
  const fu = followUps();
  const targets = targetList(group);
  const stale = staleList();

  const overdue = (d) => d && new Date(d) < new Date(Date.now() - 14 * 864e5);
  const fuRows = fu.map((r) => `<tr class="${overdue(r.date) ? 'overdue' : ''}">
    <td>${esc((r.date || '').slice(0, 10))}${overdue(r.date) ? ' <span class="kw-pill">overdue</span>' : ''}</td>
    <td><a href="/mps/${r.mp_id}">${esc(r.first_name)} ${esc(r.last_name)}</a> <span class="dept">${esc(r.party || '')}</span></td>
    <td>${esc(r.type || '')}</td>
    <td>${esc(r.description || '')}${r.notes ? `<br><span class="why">${esc(r.notes)}</span>` : ''}</td>
    <td><button onclick="DMU.followUpDone(${r.id}, this)">Mark done</button></td>
  </tr>`).join('');

  const targetRows = targets.map((m) => `<tr>
    <td><a href="/mps/${m.id}">${esc(m.first_name)} ${esc(m.last_name)}</a></td>
    <td>${esc(m.party || '')}</td><td>${esc(m.constituency || '')}</td>
    <td><b>${m.activity}</b> relevant contribution${m.activity === 1 ? '' : 's'}</td>
    <td>
      <button onclick="DMU.openDraft(0,'parliamentary_item','mp_email',${m.id})">Draft email</button>
    </td>
  </tr>`).join('');

  const staleRows = stale.map((m) => `<tr>
    <td><a href="/mps/${m.id}">${esc(m.first_name)} ${esc(m.last_name)}</a> <span class="dept">${esc(m.party || '')}</span></td>
    <td>last contact ${esc((m.last_contact || '—').slice(0, 10))}</td>
    <td><b>${m.activity}</b> recent contribution${m.activity === 1 ? '' : 's'}</td>
    <td><button onclick="DMU.openDraft(0,'parliamentary_item','mp_email',${m.id})">Re-engage</button></td>
  </tr>`).join('');

  const groupFilter = `<form class="filters" method="get" style="margin:0">
    <select name="group" onchange="this.form.submit()">
      <option value="">All topics</option>
      ${groups.map((g) => `<option ${g.name === group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
    </select>
    <a class="csvbtn" href="/api/engagement/targets.csv?group=${encodeURIComponent(group)}">Export CSV</a>
  </form>`;

  const body = `<div class="dash-head"><h1>Engagement</h1>
      <span class="sub">who to contact, who to follow up, who's gone cold</span></div>
    <div class="dashgrid" style="grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr;">
      ${panel({ title: 'Follow-ups due', count: fu.length, pad: true,
        body: fu.length ? `<table><thead><tr><th>Date</th><th>MP</th><th>Type</th><th>Detail</th><th></th></tr></thead><tbody>${fuRows}</tbody></table>`
          : '<p class="empty">No follow-ups flagged. Tick "Needs follow-up" when logging a contact.</p>' })}
      ${panel({ title: 'Target list — active, never contacted', count: targets.length, pad: true,
        style: 'grid-row: 1 / 3;', actions: groupFilter,
        body: targets.length ? `<table><thead><tr><th>MP</th><th>Party</th><th>Constituency</th><th>Activity</th><th></th></tr></thead><tbody>${targetRows}</tbody></table>`
          : '<p class="empty">No untouched MPs with recent activity on this topic.</p>' })}
      ${panel({ title: 'Stale relationships — active again', count: stale.length, pad: true,
        body: stale.length ? `<table><thead><tr><th>MP</th><th>Last contact</th><th>Recent activity</th><th></th></tr></thead><tbody>${staleRows}</tbody></table>`
          : '<p class="empty">No stale relationships needing attention.</p>' })}
    </div>`;

  res.send(layout({ title: 'Engagement', body, active: '/engagement', dashboard: true }));
});

module.exports = { router, targetList };
