'use strict';

/**
 * University Alliance peer monitor. For each fellow UA member, tracks recent
 * public affairs activity: institutional news (Google News scoped to their
 * domain, or an RSS feed if configured) and their parliamentary footprint
 * (mentions in Hansard and written questions). Stored in ua_activity — kept
 * separate from DMU's own relevance pipeline; this is benchmarking.
 */

const RssParser = require('rss-parser');
const { getJson, sleep, USER_AGENT } = require('../lib/http');
const { all, get, run, logFetch } = require('../db/database');

const parser = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });

function snippet(t, n = 220) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function insert(member, type, { title, date, url, snippet: sn }) {
  if (!url || !title || get('SELECT id FROM ua_activity WHERE url = ?', [url])) return false;
  run(`INSERT INTO ua_activity (member, type, title, date, url, snippet) VALUES (?,?,?,?,?,?)`,
    [member, type, title, date || null, url, sn || '']);
  return true;
}

async function scanNews(m) {
  let created = 0;
  const feed = m.feed_url
    ? m.feed_url
    : `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${m.domain}`)}&hl=en-GB&gl=GB`;
  try {
    const f = await parser.parseURL(feed);
    for (const it of (f.items || []).slice(0, 15)) {
      if (insert(m.name, 'news', { title: it.title, date: it.isoDate || it.pubDate, url: it.link, snippet: snippet(it.contentSnippet || it.content) })) created += 1;
    }
  } catch { /* skip */ }
  return created;
}

async function scanHansard(m) {
  let created = 0;
  const url = `https://hansard-api.parliament.uk/search/contributions.json?queryParameters.searchTerm=${encodeURIComponent('"' + m.name + '"')}&queryParameters.take=10&queryParameters.orderBy=SittingDateDesc`;
  try {
    const data = await getJson(url);
    for (const r of (data.Results || data.results || [])) {
      const id = r.ContributionExtId || r.ExternalId || r.Id;
      insert(m.name, 'hansard', {
        title: r.DebateSection || r.Title || snippet(r.ContributionText, 80),
        date: r.SittingDate || r.Date,
        url: id ? `https://hansard.parliament.uk/contributions/${id}` : r.Url,
        snippet: snippet(r.ContributionText || r.SnippetText),
      }) && (created += 1);
    }
  } catch { /* skip */ }
  return created;
}

async function scanWritten(m) {
  let created = 0;
  const url = `https://writtenquestions-api.parliament.uk/api/writtenquestions/questions?searchTerm=${encodeURIComponent('"' + m.name + '"')}&take=10&orderBy=DateTabledDesc`;
  try {
    const data = await getJson(url);
    for (const row of (data.results || data.Results || [])) {
      const v = row.value || row;
      insert(m.name, 'written', {
        title: snippet(v.heading || v.questionText, 120),
        date: v.dateTabled || v.dateAnswered,
        url: `https://questions-statements.parliament.uk/written-questions/detail/${(v.dateTabled || '').slice(0, 10)}/${v.uin || v.id}`,
        snippet: snippet(v.questionText),
      }) && (created += 1);
    }
  } catch { /* skip */ }
  return created;
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  const members = all('SELECT * FROM ua_members WHERE is_self = 0');

  for (const m of members) {
    try {
      created += await scanNews(m);   await sleep(2000);
      created += await scanHansard(m); await sleep(1000);
      created += await scanWritten(m); await sleep(1000);
      fetched += 1;
    } catch (e) {
      error = (error ? error + '; ' : '') + `${m.short}: ${e.message}`;
    }
  }

  logFetch({ source: 'alliance', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
