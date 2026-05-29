'use strict';

/**
 * Think-tank report scanner. RSS-first, scrape fallback, Google News RSS
 * fallback. Every candidate report passes the keyword prefilter at ingest; the
 * high-signal ones are then queued for the background relevance gate, so only
 * reports genuinely relevant to DMU surface — defence/foreign-policy noise from
 * the long list silently drops out.
 *
 * Polite: a per-run cap, 2s between network calls, oldest-checked first, and an
 * adaptive cadence that backs off sources that never produce relevant hits.
 */

const RssParser = require('rss-parser');
const { all, get, run, logFetch } = require('../db/database');
const { matchText, loadGroups } = require('../lib/keywords');
const { scrapeListing } = require('./scraper');
const { sleep, USER_AGENT } = require('../lib/http');
const matcher = require('./matcher');
const relevance = require('./relevance');

const parser = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
const PER_RUN = parseInt(process.env.THINKTANK_PER_RUN || '40', 10);

function snippet(t, n = 300) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Keywords to bias a Google News query — the think tank's groups, else all. */
function keywordsFor(tt) {
  let groups = [];
  try { groups = JSON.parse(tt.keyword_groups_json || '[]'); } catch { /* ignore */ }
  const defs = loadGroups();
  const picked = groups.length ? defs.filter((g) => groups.includes(g.name)) : defs;
  // A handful of representative phrases keeps the query short.
  return picked.flatMap((g) => g.keywords.slice(0, 3));
}

/** Fetch candidate items for a think tank, trying feed -> scrape -> Google News. */
async function fetchCandidates(tt) {
  // 1) RSS feed
  if (tt.feed_url) {
    try {
      const feed = await parser.parseURL(tt.feed_url);
      if (feed.items && feed.items.length) {
        return { ok: true, via: 'rss', items: feed.items.map((it) => ({
          title: it.title, url: it.link, date: it.isoDate || it.pubDate, summary: snippet(it.contentSnippet || it.content) })) };
      }
    } catch { /* fall through */ }
  }
  // 2) scrape listing page
  if (tt.url) {
    try {
      const res = await scrapeListing(tt.url, tt.scrape_selectors);
      if (res.ok && res.items.length) return { ok: true, via: 'scrape', items: res.items };
    } catch { /* fall through */ }
  }
  // 3) Google News RSS, scoped to the domain + biased keywords
  const domain = domainOf(tt.url || '');
  if (domain) {
    const kws = keywordsFor(tt).map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR ');
    const q = `site:${domain}${kws ? ` (${kws})` : ''}`;
    try {
      const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB`);
      return { ok: true, via: 'gnews', items: (feed.items || []).map((it) => ({
        title: it.title, url: it.link, date: it.isoDate || it.pubDate, summary: snippet(it.contentSnippet) })) };
    } catch { /* nothing worked */ }
  }
  return { ok: false, via: null, items: [] };
}

function insertReport(tt, it) {
  if (!it.url || get('SELECT id FROM external_items WHERE url = ?', [it.url])) return null;
  const { groups } = matchText(`${it.title} ${it.summary}`);
  if (!groups.length) return null;                 // keyword prefilter — drop non-matches
  const info = run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups, meta_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [`thinktank:${tt.id}`, tt.name, 'think_tank', it.title, it.date, it.url, it.summary,
     groups.join(','), JSON.stringify({ via: it.via })]);
  return info.lastInsertRowid;
}

/** Adaptive due-check: always when keen, less often once a source keeps missing. */
function isDue(tt) {
  if (!tt.last_checked) return true;
  const ageDays = (Date.now() - new Date(tt.last_checked).getTime()) / 864e5;
  if (tt.miss_streak >= 8) return ageDays >= 14;   // long-dormant: fortnightly
  if (tt.miss_streak >= 4) return ageDays >= 4;    // quiet: every few days
  return ageDays >= 1;                             // active: daily
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  // Scannable sources, oldest-checked first, capped per run.
  const candidates = all(
    `SELECT * FROM think_tanks WHERE status IN ('active','unvalidated')
     ORDER BY (last_checked IS NULL) DESC, last_checked ASC`
  ).filter(isDue).slice(0, PER_RUN);

  for (const tt of candidates) {
    let hits = 0;
    try {
      const res = await fetchCandidates(tt);
      // Validation: a successful fetch (even with 0 items) means the source is
      // reachable; only mark dead when every strategy errored.
      const newStatus = res.ok ? 'active' : (tt.status === 'unvalidated' ? 'dead' : tt.status);
      for (const it of res.items) {
        fetched += 1;
        const id = insertReport(tt, { ...it, via: res.via });
        if (id) {
          hits += 1; created += 1;
          try { matcher.matchItem(id, 'external_item'); } catch { /* non-fatal */ }
          try { relevance.enqueue('external_item', id, 3); } catch { /* non-fatal */ }
        }
      }
      run(`UPDATE think_tanks SET status=?, last_checked=datetime('now'),
           last_hit=CASE WHEN ?>0 THEN datetime('now') ELSE last_hit END,
           hit_count=hit_count+?, miss_streak=CASE WHEN ?>0 THEN 0 ELSE miss_streak+1 END
           WHERE id=?`, [newStatus, hits, hits, hits, tt.id]);
    } catch (e) {
      error = (error ? error + '; ' : '') + `${tt.name}: ${e.message}`;
      run(`UPDATE think_tanks SET last_checked=datetime('now'), miss_streak=miss_streak+1 WHERE id=?`, [tt.id]);
    }
    await sleep(2000);   // polite crawl delay
  }

  logFetch({ source: 'thinktanks', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error, scanned: candidates.length };
}

module.exports = { run: run_, fetchCandidates, isDue };
