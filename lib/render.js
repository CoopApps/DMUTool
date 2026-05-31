'use strict';

const { getContext } = require('../db/database');

/** HTML-escape a string for safe interpolation. */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NAV = [
  ['/action', 'This week'],
  ['/digest', 'Digest'],
  ['/diary', 'Diary'],
  ['/committees', 'Committees'],
  ['/consultations', 'Consultations'],
  ['/submissions', 'Submissions'],
  ['/sector', 'Sector watch'],
  ['/mps', 'MPs'],
  ['/engagement', 'Engagement'],
  ['/appgs', 'APPGs'],
  ['/alliance', 'UA peers'],
  ['/academics', 'Academics'],
  ['/drafts', 'Drafts'],
  ['/admin', 'Admin'],
];

/** A dashboard panel: fixed header (title + count + optional actions) over an
 *  internally-scrolling body. */
function panel({ title, count, actions = '', body = '', pad = false, style = '' }) {
  const cnt = (count != null) ? `<span class="count">${count}</span>` : '';
  return `<section class="panel"${style ? ` style="${style}"` : ''}>
    <header><h2>${esc(title)} ${cnt}</h2><span class="phead-actions">${actions}</span></header>
    <div class="panel-body${pad ? ' pad' : ''}">${body}</div>
  </section>`;
}

/** Wrap page body in the shared layout. `active` is the current path prefix.
 *  Pass `dashboard:true` for the one-screen, no-page-scroll frame. */
function layout({ title, body, active = '', dashboard = false }) {
  const eventsBadge = parseInt(getContext('new_events_count') || '0', 10);
  const nav = NAV.map(([href, label]) => {
    const isActive = active && href.startsWith(active);
    const badge = href === '/diary' && eventsBadge > 0
      ? `<span class="badge">${eventsBadge}</span>` : '';
    return `<a href="${href}" class="${isActive ? 'active' : ''}">${esc(label)}${badge}</a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · DMU Parliamentary Intelligence</title>
<link rel="stylesheet" href="/css/app.css">
</head>
<body class="${dashboard ? 'dashmode' : ''}">
<header class="topbar">
  <div class="brand"><a href="/digest">DMU&nbsp;Parliamentary&nbsp;Intelligence</a></div>
  <nav class="mainnav">${nav}</nav>
  <form class="topsearch" method="get" action="/search">
    <input name="q" placeholder="Search…" aria-label="Search everything">
  </form>
</header>
<main>${body}</main>
<aside id="draft-panel" class="slideout" aria-hidden="true">
  <div class="slideout-head">
    <strong>Draft response</strong>
    <button type="button" onclick="DMU.closeDraft()" class="close">×</button>
  </div>
  <div class="slideout-body">
    <label>Output type
      <select id="draft-type">
        <option value="quote">Media quote</option>
        <option value="press_response">Press response</option>
        <option value="briefing_note">Briefing note</option>
        <option value="committee_submission">Committee submission opening</option>
        <option value="mp_email">MP engagement email</option>
      </select>
    </label>
    <textarea id="draft-text" rows="16" placeholder="Generated text will appear here…"></textarea>
    <div class="draft-meta"><span id="draft-count">0 chars</span></div>
    <div class="draft-actions">
      <button type="button" onclick="DMU.generateDraft()">Regenerate</button>
      <button type="button" onclick="DMU.saveDraft()">Save edits</button>
      <button type="button" onclick="DMU.copyDraft()">Copy</button>
      <a id="draft-export" class="csvbtn" href="#" style="display:none">Export .docx</a>
    </div>
  </div>
</aside>
<script src="/js/app.js"></script>
</body>
</html>`;
}

/** Coloured source badge. */
function badge(source) {
  const map = {
    Commons: 'commons', Lords: 'lords', 'Written Q': 'written',
    Committee: 'committee', Sector: 'sector',
  };
  const cls = map[source] || 'sector';
  return `<span class="src-badge ${cls}">${esc(source)}</span>`;
}

module.exports = { esc, layout, panel, badge, NAV };
