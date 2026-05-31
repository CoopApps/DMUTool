'use strict';

/**
 * External feed ingestion — RSS feeds (rss-parser) plus HTML scraping
 * (scraper.js) for sites without RSS. New items run keyword matching on
 * ingest and land in external_items. Professional-body feeds are tagged so
 * the matcher can surface sector context. 2s delay between scrape requests;
 * 403/block falls back to Google News RSS.
 */

const RssParser = require('rss-parser');
const { db, all, get, run, logFetch } = require('../db/database');
const { matchText } = require('../lib/keywords');
const { scrapeListing } = require('./scraper');
const { sleep, USER_AGENT } = require('../lib/http');

const parser = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 15000 });

// Capture a meaningful chunk of the story (not just a teaser) so each item can
// be judged for DMU relevance without opening the link. Cut on a sentence or
// word boundary rather than mid-word.
function snippet(text, n = 600) {
  if (!text) return '';
  const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= n) return clean;
  const cut = clean.slice(0, n);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > n * 0.6) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function insertItem({ source_id, source_name, source_type, title, date, url, summary }) {
  if (!url) return false;
  if (get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { groups } = matchText(`${title} ${summary}`);
  run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups)
    VALUES (?,?,?,?,?,?,?,?)`,
    [String(source_id), source_name, source_type, title, date, url, summary, groups.join(',')]);
  return true;
}

async function ingestRss(source) {
  let created = 0, fetched = 0;
  const feed = await parser.parseURL(source.feed_url);
  for (const it of feed.items || []) {
    fetched += 1;
    const ok = insertItem({
      source_id: source.id,
      source_name: source.name,
      source_type: source.source_type,
      title: it.title || '',
      date: it.isoDate || it.pubDate || null,
      url: it.link,
      summary: snippet(it.contentSnippet || it.content || it.summary),
    });
    if (ok) created += 1;
  }
  return { fetched, created };
}

async function ingestScrape(source) {
  let created = 0, fetched = 0;
  const target = source.scrape_url || source.url;
  let res = await scrapeListing(target, source.scrape_selectors);

  // Fall back to Google News if blocked or empty.
  if (!res.ok || res.items.length === 0) {
    const domain = domainOf(target);
    if (domain) {
      const gnews = `https://news.google.com/rss/search?q=site:${domain}&hl=en-GB&gl=GB`;
      try {
        const feed = await parser.parseURL(gnews);
        res = { ok: true, items: (feed.items || []).map((it) => ({
          title: it.title, url: it.link, date: it.isoDate || it.pubDate, summary: snippet(it.contentSnippet),
        })) };
      } catch { /* leave as-is */ }
    }
  }

  for (const it of res.items) {
    fetched += 1;
    const ok = insertItem({
      source_id: source.id,
      source_name: source.name,
      source_type: source.source_type || 'professional_body',
      title: it.title,
      date: it.date,
      url: it.url,
      summary: it.summary,
    });
    if (ok) created += 1;
  }
  return { fetched, created };
}

/** Run all RSS external_sources + scrape professional_bodies + scrape sources. */
async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  // 1) external_sources (HE news + outlets)
  for (const s of all('SELECT * FROM external_sources')) {
    try {
      let r;
      if (s.feed_url) {
        try {
          r = await ingestRss(s);
        } catch (feedErr) {
          // RSS URL wrong/blocked — fall back to scraping (incl. Google News).
          if (s.scrape_url) r = await ingestScrape(s);
          else throw feedErr;
        }
      } else {
        r = await ingestScrape(s);
      }
      fetched += r.fetched; created += r.created;
    } catch (e) {
      error = (error ? error + '; ' : '') + `${s.name}: ${e.message}`;
    }
    await sleep(2000);
  }

  // 2) professional bodies
  for (const b of all('SELECT * FROM professional_bodies')) {
    const src = { id: b.id, name: b.name, source_type: 'professional_body',
      feed_url: b.feed_url, scrape_url: b.url, url: b.url, scrape_selectors: b.scrape_selectors };
    try {
      const r = src.feed_url ? await ingestRss(src) : await ingestScrape(src);
      fetched += r.fetched; created += r.created;
    } catch (e) {
      error = (error ? error + '; ' : '') + `${b.name}: ${e.message}`;
    }
    await sleep(2000);
  }

  logFetch({ source: 'feeds', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, ingestRss, ingestScrape };
