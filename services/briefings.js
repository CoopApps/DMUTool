'use strict';

/**
 * Parliamentary briefings — House of Commons Library research briefings and POST
 * (Parliamentary Office of Science & Technology) POSTnotes. Neutral expert
 * analysis on DMU's topics. No formal API; both are RSS (with Google News
 * fallback). Treated as high-signal: keyword prefilter at ingest, academic
 * matching, and background relevance scoring — stored as source_type 'briefing'.
 */

const RssParser = require('rss-parser');
const { get, run, logFetch } = require('../db/database');
const { matchText } = require('../lib/keywords');
const { sleep, USER_AGENT } = require('../lib/http');
const matcher = require('./matcher');
const relevance = require('./relevance');

const parser = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });

const SOURCES = [
  { name: 'House of Commons Library', feed: process.env.COMMONS_LIBRARY_FEED || 'https://commonslibrary.parliament.uk/feed/', domain: 'commonslibrary.parliament.uk' },
  { name: 'POST (POSTnotes)', feed: process.env.POST_FEED || 'https://post.parliament.uk/feed/', domain: 'post.parliament.uk' },
];

function snippet(t, n = 300) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function fetchFeed(src) {
  try {
    const feed = await parser.parseURL(src.feed);
    if (feed.items && feed.items.length) return feed.items;
  } catch { /* fall back */ }
  // Google News fallback scoped to the domain.
  try {
    const feed = await parser.parseURL(`https://news.google.com/rss/search?q=site:${src.domain}&hl=en-GB&gl=GB`);
    return feed.items || [];
  } catch { return []; }
}

function insert(src, it) {
  if (!it.link || get('SELECT id FROM external_items WHERE url = ?', [it.link])) return null;
  const summary = snippet(it.contentSnippet || it.content || it.summary);
  const { groups } = matchText(`${it.title} ${summary}`);
  if (!groups.length) return null;                 // keyword prefilter
  const info = run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups)
    VALUES (?,?,?,?,?,?,?,?)`,
    ['briefing', src.name, 'briefing', it.title, it.isoDate || it.pubDate, it.link, summary, groups.join(',')]);
  return info.lastInsertRowid;
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  for (const src of SOURCES) {
    try {
      const items = await fetchFeed(src);
      for (const it of items) {
        fetched += 1;
        const id = insert(src, it);
        if (id) {
          created += 1;
          try { matcher.matchItem(id, 'external_item'); } catch { /* non-fatal */ }
          try { relevance.enqueue('external_item', id, 3); } catch { /* non-fatal */ }
        }
      }
    } catch (e) {
      error = (error ? error + '; ' : '') + `${src.name}: ${e.message}`;
    }
    await sleep(2000);
  }

  logFetch({ source: 'briefings', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
