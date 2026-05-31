'use strict';

/**
 * Hansard service — fetches contributions per tracked keyword group and
 * upserts into parliamentary_items, deduplicating on URL.
 */

const { getJson, sleep } = require('../lib/http');
const { loadGroups } = require('../lib/keywords');
const { db, run, logFetch } = require('../db/database');
const matcher = require('./matcher');

const BASE = 'https://hansard-api.parliament.uk';
// Hansard contributions search needs the contribution type in the path.
// 'Spoken' = debates/oral contributions. Configurable via HANSARD_TYPE.
const HANSARD_TYPE = process.env.HANSARD_TYPE || 'Spoken';

function snippet(text, n = 200) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

function upsertItem(item) {
  const existing = db.prepare('SELECT id FROM parliamentary_items WHERE url = ?').get(item.url);
  if (existing) {
    run(
      `UPDATE parliamentary_items SET keyword_group=?, title=?, member_name=?, party=?,
       house=?, date=?, snippet=?, full_text=?, type=? WHERE id=?`,
      [item.keyword_group, item.title, item.member_name, item.party, item.house,
       item.date, item.snippet, item.full_text, item.type, existing.id]
    );
    return { id: existing.id, isNew: false };
  }
  const info = run(
    `INSERT INTO parliamentary_items
     (source, type, keyword_group, title, member_name, party, house, date, snippet, full_text, url, is_new)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    [item.source, item.type, item.keyword_group, item.title, item.member_name, item.party,
     item.house, item.date, item.snippet, item.full_text, item.url]
  );
  return { id: info.lastInsertRowid, isNew: true };
}

// Hansard contributions search needs the contribution type in the path.
// 'Spoken' = debates/oral contributions. Configurable via HANSARD_TYPE.
const HANSARD_TYPE = process.env.HANSARD_TYPE || 'Spoken';

async function fetchKeyword(keyword) {
  const url = `${BASE}/search/contributions/${HANSARD_TYPE}.json?queryParameters.searchTerm=${encodeURIComponent(keyword)}` +
    `&queryParameters.take=40&queryParameters.orderBy=SittingDateDesc`;
  const data = await getJson(url);
  // The contributions endpoint returns { Results: [...] } or { results: [...] }.
  return data.Results || data.results || data.Contributions || [];
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  const groups = loadGroups();

  try {
    for (const group of groups) {
      // Use the group name plus its first keyword as the search term set.
      for (const keyword of group.keywords) {
        let results = [];
        try {
          results = await fetchKeyword(keyword);
        } catch (e) {
          error = (error ? error + '; ' : '') + `${keyword}: ${e.message}`;
          await sleep(1000);
          continue;
        }
        for (const r of results) {
          fetched += 1;
          const house = r.House === 1 || r.House === 'Lords' ? 'Lords' : 'Commons';
          const id = r.ContributionExtId || r.ExternalId || r.Id;
          const url = id
            ? `https://hansard.parliament.uk/contributions/${id}`
            : r.Url || `${BASE}/contribution/${id}`;
          const text = r.ContributionText || r.SnippetText || r.Text || '';
          const item = {
            source: house,
            type: r.DebateSection || r.Section || 'Contribution',
            keyword_group: group.name,
            title: r.DebateSection || r.Title || snippet(text, 80),
            member_name: r.MemberName || r.AttributedTo || null,
            party: r.Party || null,
            house,
            date: r.SittingDate || r.Date || null,
            snippet: snippet(text),
            full_text: text,
            url,
          };
          const { id: itemId, isNew } = upsertItem(item);
          if (isNew) {
            created += 1;
            try { matcher.matchItem(itemId, 'parliamentary_item'); } catch { /* non-fatal */ }
          }
        }
        await sleep(1000); // 1 req/sec parliamentary rate limit
      }
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'hansard', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
