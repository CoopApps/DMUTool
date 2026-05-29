'use strict';

/**
 * GOV.UK Search API (no key required).
 *   GET https://www.gov.uk/api/search.json?q={keyword}&...
 *
 * Two outputs:
 *  - Open consultations -> consultations table (deadline-tracked, matched,
 *    draftable — modelled on the committee tracker).
 *  - Announcements / policy papers / press releases -> external_items as
 *    source_type 'govuk' for the Sector watch "Government" tab.
 */

const { getJson, sleep } = require('../lib/http');
const { loadGroups, matchText } = require('../lib/keywords');
const { workingDaysUntil } = require('../lib/parliament');
const { db, get, run, logFetch } = require('../db/database');
const matcher = require('./matcher');

const BASE = 'https://www.gov.uk/api/search.json';
const FIELDS = ['title', 'description', 'link', 'public_timestamp', 'organisations',
  'content_store_document_type', 'end_date', 'closing_date'].join(',');

function abs(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `https://www.gov.uk${link}`;
}
function snippet(t, n = 400) {
  if (!t) return '';
  return String(t).replace(/\s+/g, ' ').trim().slice(0, n);
}
function orgOf(r) {
  const o = (r.organisations || [])[0];
  return o ? (o.title || o.acronym || o.slug) : null;
}

async function search(keyword, docTypes, count = 20) {
  const params = new URLSearchParams({ q: keyword, count: String(count),
    order: '-public_timestamp', fields: FIELDS });
  for (const dt of docTypes) params.append('filter_content_store_document_type', dt);
  const data = await getJson(`${BASE}?${params.toString()}`);
  return data.results || [];
}

async function upsertConsultation(r, group) {
  const url = abs(r.link);
  const extId = r.link || url;
  const deadline = r.end_date || r.closing_date || null;
  const wdr = await workingDaysUntil(deadline);
  const opened = r.public_timestamp || null;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const isNew = opened && new Date(opened).getTime() > dayAgo ? 1 : 0;
  const { primary } = matchText(`${r.title} ${r.description || ''}`);

  const existing = get('SELECT id FROM consultations WHERE external_id = ?', [extId]);
  if (existing) {
    run(`UPDATE consultations SET title=?, organisation=?, summary=?, url=?, opened=?,
         deadline=?, working_days_remaining=?, keyword_group=? WHERE id=?`,
      [r.title, orgOf(r), snippet(r.description), url, opened, deadline, wdr,
       primary || group.name, existing.id]);
    return { id: existing.id, isNew: false };
  }
  const info = run(`INSERT INTO consultations
    (external_id, title, organisation, summary, url, opened, deadline,
     working_days_remaining, keyword_group, is_new)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [extId, r.title, orgOf(r), snippet(r.description), url, opened, deadline, wdr,
     primary || group.name, isNew]);
  return { id: info.lastInsertRowid, isNew: true };
}

function insertAnnouncement(r) {
  const url = abs(r.link);
  if (!url || get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { groups } = matchText(`${r.title} ${r.description || ''}`);
  if (!groups.length) return false; // awareness panel — only keep matches
  run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups, meta_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    ['govuk', orgOf(r) || 'GOV.UK', 'govuk', r.title, r.public_timestamp, url,
     snippet(r.description, 300), groups.join(','),
     JSON.stringify({ doc_type: r.content_store_document_type })]);
  return true;
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  try {
    for (const group of loadGroups()) {
      for (const keyword of group.keywords) {
        // Consultations
        try {
          const cons = await search(keyword, ['open_consultation', 'consultation']);
          for (const r of cons) {
            fetched += 1;
            const { id, isNew } = await upsertConsultation(r, group);
            if (isNew) {
              created += 1;
              try { matcher.matchItem(id, 'consultation'); } catch { /* non-fatal */ }
              try { require('./relevance').enqueue('consultation', id, 2); } catch { /* non-fatal */ }
            }
          }
        } catch (e) { error = (error ? error + '; ' : '') + `${keyword}/cons: ${e.message}`; }
        await sleep(1000);

        // Announcements / policy papers
        try {
          const ann = await search(keyword, ['news_story', 'press_release', 'policy_paper']);
          for (const r of ann) { fetched += 1; if (insertAnnouncement(r)) created += 1; }
        } catch (e) { error = (error ? error + '; ' : '') + `${keyword}/ann: ${e.message}`; }
        await sleep(1000);
      }
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'govuk', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, search };
