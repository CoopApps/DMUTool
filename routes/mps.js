'use strict';

const express = require('express');
const router = express.Router();
const { all, get } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');
const mpProfile = require('../services/mpProfile');
const twfy = require('../services/theyworkforyou');

router.get('/', (req, res) => {
  const { party = '', active = '', q = '', house = '' } = req.query;
  const where = [];
  const params = [];
  if (party) { where.push('party = ?'); params.push(party); }
  if (house) { where.push('house = ?'); params.push(house); }
  if (active === '1' || active === '0') { where.push('is_active = ?'); params.push(parseInt(active, 10)); }
  if (q) { where.push('(first_name LIKE ? OR last_name LIKE ? OR constituency LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = `SELECT * FROM mps ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_name, first_name LIMIT 800`;
  const mps = all(sql, params);
  const parties = all('SELECT DISTINCT party FROM mps WHERE party IS NOT NULL ORDER BY party');

  const rows = mps.map((m) => `<tr>
    <td><a href="/mps/${m.id}">${esc(m.first_name)} ${esc(m.last_name)}</a></td>
    <td>${esc(m.party || '')}</td>
    <td>${esc(m.house === 'Lords' ? 'House of Lords' : (m.constituency || ''))}</td>
    <td>${m.is_active ? 'Active' : 'Inactive'}</td>
  </tr>`).join('');

  const body = `<div class="dash-head"><h1>Members tracker</h1>
      <span class="sub">MPs & peers relevant to DMU</span>
      <span class="spacer"></span>
      <form class="filters" method="get">
        <input name="q" placeholder="Search name / constituency" value="${esc(q)}">
        <select name="house"><option value="">Both Houses</option>
          <option value="Commons" ${house==='Commons'?'selected':''}>Commons</option>
          <option value="Lords" ${house==='Lords'?'selected':''}>Lords</option></select>
        <select name="party"><option value="">All parties</option>
          ${parties.map((p) => `<option ${p.party === party ? 'selected' : ''}>${esc(p.party)}</option>`).join('')}</select>
        <select name="active"><option value="">All</option>
          <option value="1" ${active==='1'?'selected':''}>Active</option>
          <option value="0" ${active==='0'?'selected':''}>Inactive</option></select>
        <button>Filter</button>
      </form></div>
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: 'Members', count: mps.length,
        body: `<table class="mp-table"><thead><tr><th>Name</th><th>Party</th><th>Seat / House</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody></table>`,
        pad: true })}
    </div>`;

  res.send(layout({ title: 'MPs', body, active: '/mps', dashboard: true }));
});

router.get('/:id', async (req, res) => {
  const mp = get('SELECT * FROM mps WHERE id = ?', [req.params.id]);
  if (!mp) return res.status(404).send(layout({ title: 'Not found', body: '<h1>MP not found</h1>', active: '/mps' }));

  const log = all('SELECT * FROM engagement_log WHERE mp_id = ? ORDER BY date DESC', [mp.id]);
  const contributions = all(
    `SELECT * FROM parliamentary_items WHERE member_name LIKE ?
     AND date >= date('now','-90 days') ORDER BY date DESC LIMIT 20`,
    [`%${mp.last_name}%`]
  );

  // Enrich photo/active status from the live Members API (cached 30 days),
  // then re-read the row so the freshly written photo_url shows immediately.
  try { await mpProfile.enrichFromMembers(mp); } catch { /* ignore */ }
  const fresh = get('SELECT * FROM mps WHERE id = ?', [mp.id]);
  if (fresh) Object.assign(mp, fresh);

  let votes = [], interests = [], twfyProfile = null;
  try { votes = await mpProfile.getVotingRecord(mp); } catch { /* ignore */ }
  try { interests = await mpProfile.getInterests(mp); } catch { /* ignore */ }
  let contact = null;
  try { contact = await mpProfile.getContact(mp); if (contact && contact.email) mp.email = mp.email || contact.email; } catch { /* ignore */ }
  try { twfyProfile = await twfy.getProfile(mp); } catch { /* ignore */ }

  const logRows = log.map((l) => `<li><b>${esc((l.date||'').slice(0,10))}</b> ${esc(l.type||'')} — ${esc(l.description||'')}
    ${l.notes ? `<br><span class="why">${esc(l.notes)}</span>` : ''}${l.followup ? ' <span class="kw-pill">follow up</span>' : ''}</li>`).join('');
  const contribRows = contributions.map((c) => `<li>${esc((c.date||'').slice(0,10))} — <a href="${esc(c.url)}" target="_blank">${esc(c.title)}</a> <span class="kw-pill">${esc(c.keyword_group||'')}</span></li>`).join('');
  const voteRows = votes.slice(0, 15).map((v) => `<li>${esc((v.date||'').slice(0,10))} — ${esc(v.title||'')}: <b>${esc(v.vote)}</b></li>`).join('');
  const interestRows = interests.slice(0, 15).map((i) => `<li>${esc(i.category||'')}: ${esc(i.summary||'')}</li>`).join('');

  const body = `<div class="page-head"><h1>${esc(mp.first_name)} ${esc(mp.last_name)}</h1></div>
    <div class="mp-profile">
      <div class="mp-card">
        ${mp.photo_url ? `<img src="${esc(mp.photo_url)}" alt="" class="mp-photo">` : ''}
        <p><b>${esc(mp.party||'')}</b><br>${esc(mp.constituency||'')}</p>
        <p>${mp.email ? `<a href="mailto:${esc(mp.email)}">${esc(mp.email)}</a>` : '<span class="empty">no email on file</span>'}
          ${contact && contact.phone ? `<br>${esc(contact.phone)}` : ''}
          ${contact && contact.address ? `<br><span class="dept">${esc(contact.address)}</span>` : ''}</p>
        <div class="card-actions">
          <button onclick="DMU.openDraft(${contributions[0] ? contributions[0].id : 0},'parliamentary_item','mp_email',${mp.id})">Draft email</button>
        </div>
      </div>
      <div class="mp-detail">
        <section id="log"><h2>Engagement history</h2><ul>${logRows || '<li class="empty">No contact logged.</li>'}</ul>
          <form class="log-form" onsubmit="return DMU.logContact(event, ${mp.id})">
            <h3>Log contact</h3>
            <input type="date" name="date" required>
            <select name="type"><option>call</option><option>email</option><option>meeting</option><option>submission</option></select>
            <input name="description" placeholder="Description">
            <textarea name="notes" placeholder="Notes"></textarea>
            <label><input type="checkbox" name="followup"> Needs follow-up</label>
            <button>Save</button>
          </form>
        </section>
        <section><h2>Recent contributions (90 days)</h2><ul>${contribRows || '<li class="empty">None matched.</li>'}</ul></section>
        <section><h2>Voting record</h2><ul>${voteRows || '<li class="empty">No cached votes.</li>'}</ul>
          ${twfyProfile ? `<p>${twfyProfile.office && twfyProfile.office.length ? esc(twfyProfile.office.join('; ')) + '<br>' : ''}
            ${twfyProfile.votes_url ? `<a href="${esc(twfyProfile.votes_url)}" target="_blank">Voting summary &amp; positions (TheyWorkForYou) →</a>` : ''}</p>` : ''}
        </section>
        <section><h2>Declared interests</h2><ul>${interestRows || '<li class="empty">None cached.</li>'}</ul></section>
      </div>
    </div>`;

  res.send(layout({ title: `${mp.first_name} ${mp.last_name}`, body, active: '/mps' }));
});

module.exports = router;
