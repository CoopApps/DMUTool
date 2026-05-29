'use strict';

/**
 * MP profile enrichment — voting record (Commons/Lords Divisions APIs, 7-day
 * TTL) and declared interests (Register of Interests API, 30-day TTL). Cached
 * per MP in mp_cache. Used only by the MP profile view.
 */

const { getJson } = require('../lib/http');
const { get, run } = require('../db/database');

function readCache(mpId, type, ttlDays) {
  const row = get('SELECT data_json, fetched_at FROM mp_cache WHERE mp_id=? AND cache_type=?', [mpId, type]);
  if (!row) return null;
  const age = (Date.now() - new Date(row.fetched_at).getTime()) / 864e5;
  if (age > ttlDays) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}

function writeCache(mpId, type, data) {
  run(`INSERT INTO mp_cache (mp_id, cache_type, data_json, fetched_at)
       VALUES (?,?,?,datetime('now'))
       ON CONFLICT(mp_id, cache_type) DO UPDATE SET data_json=excluded.data_json, fetched_at=excluded.fetched_at`,
    [mpId, type, JSON.stringify(data)]);
}

/** Resolve a member id from the Members API by name (best-effort). */
async function resolveMemberId(mp) {
  const name = `${mp.first_name} ${mp.last_name}`.trim();
  try {
    const data = await getJson(`https://members-api.parliament.uk/api/Members/Search?Name=${encodeURIComponent(name)}&take=1`);
    const item = (data.items || [])[0];
    return item && (item.value ? item.value.id : item.id);
  } catch { return null; }
}

async function getVotingRecord(mp) {
  const cached = readCache(mp.id, 'divisions', 7);
  if (cached) return cached;
  const memberId = await resolveMemberId(mp);
  if (!memberId) return [];
  let votes = [];
  try {
    const url = `https://commonsvotes-api.parliament.uk/data/divisions/membervoting?queryParameters.memberId=${memberId}&queryParameters.take=20`;
    const data = await getJson(url);
    votes = (data || []).map((d) => ({
      title: d.PublishedDivision ? d.PublishedDivision.Title : d.Title,
      date: d.PublishedDivision ? d.PublishedDivision.Date : d.Date,
      vote: d.MemberVotedAye ? 'Aye' : 'No',
    }));
  } catch { /* leave empty */ }
  writeCache(mp.id, 'divisions', votes);
  return votes;
}

async function getInterests(mp) {
  const cached = readCache(mp.id, 'interests', 30);
  if (cached) return cached;
  const memberId = await resolveMemberId(mp);
  if (!memberId) return [];
  let interests = [];
  try {
    const url = `https://interests-api.parliament.uk/api/v1/Interests/?MemberId=${memberId}&Take=30`;
    const data = await getJson(url);
    interests = (data.items || []).map((i) => ({
      category: i.value && i.value.category && i.value.category.name,
      summary: i.value && i.value.summary,
      date: i.value && i.value.registrationDate,
    }));
  } catch { /* leave empty */ }
  writeCache(mp.id, 'interests', interests);
  return interests;
}

module.exports = { getVotingRecord, getInterests };
