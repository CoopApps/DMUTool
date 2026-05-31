'use strict';

/**
 * DMU public-affairs events — create an event, assemble a curated invite list
 * from the tool's stakeholder universe (MPs/peers) plus ad-hoc contacts, track
 * simple RSVP status, and generate personalised invite emails to send manually
 * (nothing is sent automatically). Building an invite list logs nothing until
 * you mark people invited, keeping it a safe workspace.
 */

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db/database');
const { layout, panel, esc } = require('../lib/render');

const STATUSES = ['shortlist', 'invited', 'accepted', 'declined', 'attended'];
const STATUS_CLS = { shortlist: 'grey', invited: 'amber', accepted: 'green', declined: 'grey', attended: 'green' };

// ---- List of events ---------------------------------------------------------
router.get('/', (req, res) => {
  const events = all(`SELECT e.*,
    (SELECT COUNT(*) FROM event_invitees WHERE event_id=e.id) AS invitees,
    (SELECT COUNT(*) FROM event_invitees WHERE event_id=e.id AND status='accepted') AS accepted
    FROM pa_events e ORDER BY (date IS NULL), date DESC, e.id DESC`);

  const rows = events.map((e) => `<a class="plist-row" href="/events/${e.id}">
    <span class="t"><b>${esc(e.title)}</b><br><span class="muted">${esc((e.date || '').slice(0, 10) || 'date TBC')}${e.location ? ' · ' + esc(e.location) : ''}</span></span>
    <span class="muted">${e.accepted}/${e.invitees} confirmed</span>
    <span class="tag ${e.status === 'done' ? 'green' : e.status === 'invites_out' ? 'amber' : 'grey'}">${esc(e.status.replace('_', ' '))}</span>
  </a>`).join('');

  const createForm = `<form class="inline event-create" onsubmit="return DMU.createEvent(event)">
    <input name="title" placeholder="Event title" required>
    <input name="date" type="date">
    <input name="location" placeholder="Location">
    <button>Create event</button>
  </form>`;

  const body = `<div class="dash-head"><h1>Events</h1>
      <span class="sub">DMU public-affairs events &amp; invite lists</span>
      <span class="spacer"></span></div>
    <div class="dashgrid" style="grid-template-rows:1fr;">
      ${panel({ title: 'Events', count: events.length,
        actions: '', pad: true,
        body: `<div class="pad" style="padding:10px 12px">${createForm}</div>
          ${events.length ? `<div class="plist tall">${rows}</div>` : '<p class="empty">No events yet. Create one above to start building an invite list.</p>'}` })}
    </div>`;
  res.send(layout({ title: 'Events', body, active: '/events', dashboard: true }));
});

// ---- Single event: invite list + RSVP + draft invites -----------------------
router.get('/:id', (req, res) => {
  const e = get(`SELECT * FROM pa_events WHERE id=?`, [req.params.id]);
  if (!e) return res.status(404).send(layout({ title: 'Not found', body: '<div class="page-head"><h1>Event not found</h1></div><p class="empty"><a href="/events">← Events</a></p>', active: '/events' }));

  const invitees = all(`SELECT * FROM event_invitees WHERE event_id=? ORDER BY status, name`, [e.id]);
  const counts = {};
  for (const s of STATUSES) counts[s] = invitees.filter((i) => i.status === s).length;

  const inviteeRows = invitees.map((i) => `<tr>
    <td>${esc(i.name || '')}${i.org ? ` <span class="dept">${esc(i.org)}</span>` : ''}</td>
    <td>${i.email ? esc(i.email) : '<span class="muted">no email</span>'}</td>
    <td>
      <select onchange="DMU.setInviteeStatus(${i.id}, this.value)">
        ${STATUSES.map((s) => `<option value="${s}" ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </td>
    <td><button class="danger" onclick="DMU.removeInvitee(${i.id})">✕</button></td>
  </tr>`).join('');

  const inviteeTable = invitees.length
    ? `<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>${inviteeRows}</tbody></table>`
    : '<p class="empty">No invitees yet. Add MPs/peers or ad-hoc contacts from the right.</p>';

  // Add-from-Members: a quick search box (AJAX) + ad-hoc contact form.
  const addPanel = `
    <h3>Add MPs &amp; peers</h3>
    <form class="inline" onsubmit="return DMU.searchMembersForEvent(event, ${e.id})">
      <input id="mp-q" placeholder="Search name / constituency / party" size="26">
      <button>Search</button>
    </form>
    <div id="mp-results" class="mp-results"></div>
    <h3 style="margin-top:16px">Add an external contact</h3>
    <form class="event-contact" onsubmit="return DMU.addEventContact(event, ${e.id})">
      <input name="name" placeholder="Name" required>
      <input name="email" type="email" placeholder="Email">
      <input name="org" placeholder="Organisation">
      <input name="role" placeholder="Role (optional)">
      <button>Add contact</button>
    </form>`;

  const statusBar = STATUSES.map((s) =>
    `<span class="tag ${STATUS_CLS[s]}">${counts[s]} ${s}</span>`).join(' ');

  const body = `<div class="dash-head"><h1>${esc(e.title)}</h1>
      <span class="sub">${esc((e.date || '').slice(0, 10) || 'date TBC')}${e.location ? ' · ' + esc(e.location) : ''}</span>
      <span class="spacer"></span>
      <a class="kpi-link" href="/events">← All events</a>
      <a class="kpi-link" href="/events/${e.id}/invites">Draft invites →</a></div>
    <div class="event-statusbar">${statusBar}</div>
    <div class="dashgrid" style="grid-template-columns:1.6fr 1fr;">
      ${panel({ title: 'Invite list', count: invitees.length, pad: true, body: inviteeTable })}
      ${panel({ title: 'Add invitees', pad: true, body: addPanel })}
    </div>`;
  res.send(layout({ title: e.title, body, active: '/events', dashboard: true }));
});

// ---- Draft personalised invites (manual send) -------------------------------
router.get('/:id/invites', (req, res) => {
  const e = get(`SELECT * FROM pa_events WHERE id=?`, [req.params.id]);
  if (!e) return res.status(404).send(layout({ title: 'Not found', body: '<h1>Event not found</h1>', active: '/events' }));
  const invitees = all(`SELECT * FROM event_invitees WHERE event_id=? AND status IN ('shortlist','invited') ORDER BY name`, [e.id]);

  const dateStr = e.date ? new Date(e.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '[date]';
  const defaultBody = e.invite_body || `Dear {{name}},

I am writing on behalf of De Montfort University to invite you to ${e.title || '[event]'}${e.date ? `, taking place on ${dateStr}` : ''}${e.location ? ` at ${e.location}` : ''}.

[One or two lines on why this event matters and why we'd value their attendance.]

I do hope you will be able to join us. Please let me know if you would like any further details.

With best wishes,
[Your name]
DMU Public Affairs`;

  const fill = (tpl, inv) => esc(tpl.replace(/\{\{name\}\}/g, inv.name || 'colleague').replace(/\{\{event\}\}/g, e.title || ''));
  const cards = invitees.length ? invitees.map((i) => `
    <article class="card invite-card">
      <div class="card-head"><b>${esc(i.name || '')}</b> ${i.org ? `<span class="dept">${esc(i.org)}</span>` : ''}
        <span class="muted">${i.email ? esc(i.email) : 'no email on file'}</span></div>
      <pre class="invite-text" id="inv-${i.id}">${fill(defaultBody, i)}</pre>
      <div class="card-actions">
        <button onclick="DMU.copyInvite(${i.id})">Copy text</button>
        ${i.email ? `<a class="btnlink" href="mailto:${esc(i.email)}?subject=${encodeURIComponent('Invitation: ' + (e.title || ''))}&body=${encodeURIComponent(defaultBody.replace(/\{\{name\}\}/g, i.name || 'colleague').replace(/\{\{event\}\}/g, e.title || ''))}">Open in email client</a>` : ''}
        <button onclick="DMU.setInviteeStatus(${i.id},'invited',true)">Mark invited</button>
      </div>
    </article>`).join('') : '<p class="empty">No one on the shortlist to invite. Add invitees first.</p>';

  const tplForm = `<form onsubmit="return DMU.saveInviteTemplate(event, ${e.id})">
    <p class="why">Edit the template — <code>{{name}}</code> and <code>{{event}}</code> are filled per person. Nothing is sent automatically; copy each or open it in your email client.</p>
    <textarea name="invite_body" rows="8" style="width:100%">${esc(defaultBody)}</textarea>
    <button>Save template</button>
  </form>`;

  const body = `<div class="dash-head"><h1>Draft invites — ${esc(e.title)}</h1>
      <span class="spacer"></span><a class="kpi-link" href="/events/${e.id}">← Back to event</a></div>
    <div class="dashgrid" style="grid-template-columns:1fr 1.4fr;">
      ${panel({ title: 'Invite template', pad: true, body: tplForm })}
      ${panel({ title: 'Personalised invites', count: invitees.length, pad: true, body: cards })}
    </div>`;
  res.send(layout({ title: 'Draft invites', body, active: '/events', dashboard: true }));
});

module.exports = router;
