'use strict';

/**
 * Lords coverage. The Access database is Commons-only; this pulls current
 * members of the House of Lords from the Parliament Members API into the same
 * `mps` table (house='Lords'), so the MP tracker, engagement target lists and
 * contribution matching cover peers too. Idempotent: Lords rows use an id range
 * offset from the Access ids, and store the Members API id for divisions/interests.
 */

const { getJson, sleep } = require('../lib/http');
const { run, get, logFetch } = require('../db/database');

const LORDS_ID_OFFSET = 200000; // keep Lords ids clear of Access (Commons) ids

const TITLES = /^(the\s+)?(rt\s+hon\s+)?(lord|lady|baroness|baron|earl|viscount|countess|duke|duchess|marquess|the lord bishop of|lord bishop of|bishop of|archbishop of)\b/i;

/** Split a peer's display name into a (title, surname-ish remainder) for the
 *  existing first_name/last_name columns — best-effort, for display + matching. */
function parsePeerName(display) {
  const d = (display || '').trim();
  const m = d.match(TITLES);
  if (!m) return { first: '', last: d };
  const title = d.slice(0, m[0].length).trim();
  const rest = d.slice(m[0].length).trim();   // e.g. "Smith of Finsbury"
  return { first: title, last: rest || d };
}

async function fetchLords() {
  const out = [];
  const take = 20;
  for (let skip = 0; skip < 2000; skip += take) {
    const url = `https://members-api.parliament.uk/api/Members/Search?House=2&IsCurrentMember=true&skip=${skip}&take=${take}`;
    let data;
    try { data = await getJson(url); } catch (e) { throw new Error(`Members API: ${e.message}`); }
    const items = data.items || [];
    for (const it of items) out.push(it.value || it);
    const total = data.totalResults != null ? data.totalResults : 0;
    if (!items.length || skip + take >= total) break;
    await sleep(1000); // ~1 req/s
  }
  return out;
}

async function refreshLords() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const peers = await fetchLords();
    const stmt = run; // alias
    const upsert = require('../db/database').db.prepare(`INSERT INTO mps
      (id, first_name, last_name, party, constituency, email, phone, photo_url, notes, is_active, house, member_api_id)
      VALUES (@id, @first, @last, @party, NULL, NULL, NULL, @photo, NULL, 1, 'Lords', @memberId)
      ON CONFLICT(id) DO UPDATE SET first_name=@first, last_name=@last, party=@party,
        photo_url=@photo, is_active=1, house='Lords', member_api_id=@memberId`);
    for (const p of peers) {
      fetched += 1;
      const memberId = p.id;
      const { first, last } = parsePeerName(p.nameDisplayAs || p.nameListAs || '');
      const existed = get('SELECT id FROM mps WHERE id = ?', [LORDS_ID_OFFSET + memberId]);
      upsert.run({
        id: LORDS_ID_OFFSET + memberId,
        first, last,
        party: p.latestParty ? p.latestParty.name : null,
        photo: `https://members-api.parliament.uk/api/Members/${memberId}/Portrait?cropType=ThreeFour`,
        memberId,
      });
      if (!existed) created += 1;
    }
  } catch (e) {
    error = e.message;
  }
  logFetch({ source: 'lordsRefresh', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { refreshLords, parsePeerName, LORDS_ID_OFFSET };
