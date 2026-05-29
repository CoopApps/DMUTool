'use strict';

/**
 * MP profile enrichment — voting record (Commons/Lords Divisions APIs, 7-day
 * TTL) and declared interests (Register of Interests API, 30-day TTL). Cached
 * per MP in mp_cache. Used only by the MP profile view.
 */

const { getJson, sleep } = require('../lib/http');
const { db, get, run, all, logFetch } = require('../db/database');

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

/** Resolve a member id — prefer the stored Members API id (Lords + enriched MPs). */
async function resolveMemberId(mp) {
  if (mp.member_api_id) return mp.member_api_id;
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
    const base = mp.house === 'Lords'
      ? 'https://lordsvotes-api.parliament.uk/data/Divisions/membervoting'
      : 'https://commonsvotes-api.parliament.uk/data/divisions/membervoting';
    const url = `${base}?queryParameters.memberId=${memberId}&queryParameters.take=20`;
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

/**
 * Reconcile an MP against the live Parliament Members API: portrait photo,
 * current party/constituency and active status. Cached 30 days in mp_cache
 * ('members'); also writes the portrait URL and is_active back onto the MP row.
 */
async function enrichFromMembers(mp) {
  const cached = readCache(mp.id, 'members', 30);
  if (cached) return cached;
  const memberId = await resolveMemberId(mp);
  if (!memberId) return null;
  let info = null;
  try {
    const data = await getJson(`https://members-api.parliament.uk/api/Members/${memberId}`);
    const v = data.value || data;
    const latest = v.latestHouseMembership || {};
    info = {
      memberId,
      photo_url: `https://members-api.parliament.uk/api/Members/${memberId}/Portrait?cropType=ThreeFour`,
      party: v.latestParty ? v.latestParty.name : null,
      constituency: latest.membershipFrom || null,
      is_active: latest.membershipStatus
        ? (latest.membershipStatus.statusIsActive ? 1 : 0)
        : (latest.membershipEndDate ? 0 : 1),
    };
    // Write enrichment back onto the MP row.
    run(`UPDATE mps SET photo_url = COALESCE(NULLIF(photo_url,''), ?), is_active = ?,
         party = COALESCE(party, ?), constituency = COALESCE(constituency, ?) WHERE id = ?`,
      [info.photo_url, info.is_active, info.party, info.constituency, mp.id]);
  } catch { /* leave null */ }
  if (info) writeCache(mp.id, 'members', info);
  return info;
}

/**
 * Reconcile every MP against the live House (active status + portrait).
 * Rate-limited to ~1 req/s; capped per run to stay polite. Manual source in Admin.
 */
async function refreshAll({ limit = 150 } = {}) {
  const started_at = new Date().toISOString();
  const mps = all(`SELECT * FROM mps WHERE id NOT IN
    (SELECT mp_id FROM mp_cache WHERE cache_type='members'
       AND fetched_at > datetime('now','-30 days'))
    LIMIT ?`, [limit]);
  let done = 0, error = null;
  for (const mp of mps) {
    try { if (await enrichFromMembers(mp)) done += 1; }
    catch (e) { error = (error ? error + '; ' : '') + e.message; }
    await sleep(1000);
  }
  logFetch({ source: 'mpRefresh', started_at, completed_at: new Date().toISOString(),
    items_fetched: mps.length, items_new: done, error });
  return { fetched: mps.length, created: done, error };
}

module.exports = { getVotingRecord, getInterests, enrichFromMembers, refreshAll };
