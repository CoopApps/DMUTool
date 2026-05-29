'use strict';

/**
 * Guardian Open Platform (content API) service.
 *
 *   GET https://content.guardianapis.com/search?q={query}&api-key=...
 *
 * Unlike the Guardian Higher Education RSS feed (kept separately), this queries
 * the whole Guardian by tracked keywords across all sections. One call per
 * keyword group (keywords OR-ed together) keeps us well inside the free tier
 * (1 req/s, 500/day). New items run keyword matching and land in external_items
 * as an "outlet". Awareness only — no academic matching (Sector watch panel).
 *
 * Requires GUARDIAN_API_KEY in the environment; skips gracefully when absent.
 */

const { getJson, sleep } = require('../lib/http');
const { loadGroups, matchText } = require('../lib/keywords');
const { get, run, logFetch } = require('../db/database');

const BASE = 'https://content.guardianapis.com/search';
const SOURCE_NAME = 'The Guardian';

function snippet(t, n = 300) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Build a Guardian `q` from a group's keywords (phrases quoted, OR-joined). */
function buildQuery(keywords) {
  return keywords
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' OR ');
}

function insertItem({ title, date, url, summary, byline, section }) {
  if (!url || get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { groups } = matchText(`${title} ${summary}`);
  run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups, meta_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    ['guardian', SOURCE_NAME, 'outlet', title, date, url, summary, groups.join(','),
     JSON.stringify({ byline: byline || null, section: section || null })]);
  return true;
}

async function run_() {
  const started_at = new Date().toISOString();
  const apiKey = process.env.GUARDIAN_API_KEY;

  if (!apiKey) {
    // Graceful skip — record it so Admin shows why nothing was fetched.
    logFetch({ source: 'guardian', started_at, completed_at: new Date().toISOString(),
      items_fetched: 0, items_new: 0, error: 'GUARDIAN_API_KEY not set — Guardian API skipped.' });
    return { fetched: 0, created: 0, skipped: true };
  }

  let fetched = 0, created = 0, error = null;
  // Look back a few days so a daily run never misses cross-day publishing.
  const fromDate = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);

  try {
    for (const group of loadGroups()) {
      if (!group.keywords.length) continue;
      const params = new URLSearchParams({
        q: buildQuery(group.keywords),
        'api-key': apiKey,
        'from-date': fromDate,
        'order-by': 'newest',
        'page-size': '20',
        'show-fields': 'trailText,standfirst,byline',
      });
      let data;
      try {
        data = await getJson(`${BASE}?${params.toString()}`);
      } catch (e) {
        error = (error ? error + '; ' : '') + `${group.name}: ${e.message}`;
        await sleep(1000);
        continue;
      }
      const results = (data.response && data.response.results) || [];
      for (const r of results) {
        fetched += 1;
        const f = r.fields || {};
        if (insertItem({
          title: r.webTitle,
          date: r.webPublicationDate,
          url: r.webUrl,
          summary: snippet(f.trailText || f.standfirst),
          byline: f.byline,
          section: r.sectionName,
        })) created += 1;
      }
      await sleep(1000); // free tier: 1 req/s
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'guardian', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, buildQuery };
