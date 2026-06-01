'use strict';

const { getContext, get } = require('../db/database');

/** Human "x ago" from a SQLite datetime ('YYYY-MM-DD HH:MM:SS', UTC). */
function timeAgo(sqlDt) {
  if (!sqlDt) return null;
  const then = Date.parse(sqlDt.replace(' ', 'T') + 'Z');
  if (isNaN(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "updated 2h ago" chip from the last successful fetch of the given sources. */
function freshness(sources) {
  let row;
  if (sources && sources.length) {
    const ph = sources.map(() => '?').join(',');
    row = get(`SELECT MAX(completed_at) AS at FROM fetch_log WHERE error IS NULL AND source IN (${ph})`, sources);
  } else {
    row = get(`SELECT MAX(completed_at) AS at FROM fetch_log WHERE error IS NULL`);
  }
  const ago = row && row.at ? timeAgo(row.at) : null;
  return ago ? `<span class="freshness" title="last successful data fetch">updated ${ago}</span>` : '';
}

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

// Grouped navigation — a few top-level menus instead of 14 flat links.
const NAV_GROUPS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Command centre', href: '/action' },
  { label: 'Parliament', items: [
    ['/digest', 'Daily digest'], ['/diary', 'Diary'], ['/committees', 'Committees'],
    ['/consultations', 'Consultations'], ['/submissions', 'Submissions'] ] },
  { label: 'Sector', items: [
    ['/sector', 'Sector watch'], ['/appgs', 'APPGs'], ['/alliance', 'UA peers'] ] },
  { label: 'Stakeholders', items: [
    ['/mps', 'MPs'], ['/engagement', 'Engagement'], ['/events', 'Events'] ] },
  { label: 'DMU', items: [
    ['/academics', 'Academics'], ['/drafts', 'Drafts'] ] },
  { label: 'Admin', items: [
    ['/admin', 'Settings & sources'], ['/usage', 'Usage credits'] ] },
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
  const diaryBadge = (href) => href === '/diary' && eventsBadge > 0 ? `<span class="badge">${eventsBadge}</span>` : '';
  const isOn = (href) => active && href.startsWith(active);
  const nav = NAV_GROUPS.map((g) => {
    if (g.href) {
      return `<a href="${g.href}" class="navtop ${isOn(g.href) ? 'active' : ''}">${esc(g.label)}</a>`;
    }
    const groupActive = g.items.some(([href]) => isOn(href));
    const sub = g.items.map(([href, label]) =>
      `<a href="${href}" class="${isOn(href) ? 'active' : ''}">${esc(label)}${diaryBadge(href)}</a>`).join('');
    const groupBadge = g.items.some(([h]) => h === '/diary') && eventsBadge > 0 ? `<span class="badge">${eventsBadge}</span>` : '';
    return `<div class="navgroup ${groupActive ? 'active' : ''}">
      <button class="navtop" type="button">${esc(g.label)}${groupBadge} <span class="caret">▾</span></button>
      <div class="navmenu">${sub}</div></div>`;
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

module.exports = { esc, layout, panel, badge, freshness, NAV };
