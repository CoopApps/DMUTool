'use strict';

/**
 * TheyWorkForYou API (mySociety). Free key from
 * https://www.theyworkforyou.com/api/key — set TWFY_API_KEY in .env.
 * Resolves an MP by constituency to get person_id, party, office and a link to
 * their voting-record / positions page. Cached 7 days in mp_cache ('twfy').
 * Skips gracefully when no key is configured.
 */

const { getJson } = require('../lib/http');
const { get, run } = require('../db/database');

const BASE = 'https://www.theyworkforyou.com/api';

function readCache(mpId) {
  const row = get(`SELECT data_json, fetched_at FROM mp_cache WHERE mp_id=? AND cache_type='twfy'`, [mpId]);
  if (!row) return null;
  if ((Date.now() - new Date(row.fetched_at).getTime()) / 864e5 > 7) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}
function writeCache(mpId, data) {
  run(`INSERT INTO mp_cache (mp_id, cache_type, data_json, fetched_at)
       VALUES (?, 'twfy', ?, datetime('now'))
       ON CONFLICT(mp_id, cache_type) DO UPDATE SET data_json=excluded.data_json, fetched_at=excluded.fetched_at`,
    [mpId, JSON.stringify(data)]);
}

function isConfigured() {
  return !!process.env.TWFY_API_KEY;
}

async function getProfile(mp) {
  if (!isConfigured()) return null;
  const cached = readCache(mp.id);
  if (cached) return cached;
  if (!mp.constituency) return null;

  try {
    const url = `${BASE}/getMP?key=${process.env.TWFY_API_KEY}` +
      `&constituency=${encodeURIComponent(mp.constituency)}&output=js`;
    const data = await getJson(url);
    const person = Array.isArray(data) ? data[0] : data;
    if (!person || person.error) return null;
    const profile = {
      person_id: person.person_id,
      full_name: person.full_name,
      party: person.party,
      office: (person.office || []).map((o) => o.position).filter(Boolean),
      image: person.image ? `https://www.theyworkforyou.com${person.image}` : null,
      votes_url: person.person_id
        ? `https://www.theyworkforyou.com/mp/${person.person_id}/votes` : null,
      url: person.person_id ? `https://www.theyworkforyou.com/mp/${person.person_id}` : null,
    };
    writeCache(mp.id, profile);
    return profile;
  } catch {
    return null;
  }
}

module.exports = { getProfile, isConfigured };
