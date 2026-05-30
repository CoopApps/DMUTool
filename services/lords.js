'use strict';

/**
 * People coverage from the Parliament Members API. Pulls current members of
 * either House into the `mps` table so the tracker, engagement and contribution
 * matching are populated even without the Access database (which only adds
 * historic Commons contacts/engagement). Idempotent.
 *
 *  - Commons: stored under the member's real API id (house='Commons').
 *  - Lords:   stored under an offset id so they never clash with Access ids.
 *
 * The Access import (scripts/migrate.js) remains the way to load the historic
 * engagement log; this gives a live, accurate member list on any platform.
 */

const { getJson, sleep } = require('../lib/http');
const { db, run, get, logFetch } = require('../db/database');

const LORDS_ID_OFFSET = 200000;

const TITLES = /^(the\s+)?(rt\s+hon\s+)?(lord|lady|baroness|baron|earl|viscount|countess|duke|duchess|marquess|the lord bishop of|lord bishop of|bishop of|archbishop of)\b/i;

function parsePeerName(display) {
  const d = (display || '').trim();
  const m = d.match(TITLES);
  if (!m) return { first: '', last: d };
  const title = d.slice(0, m[0].length).trim();
  const rest = d.slice(m[0].length).trim();
  return { first: title, last: rest || d };
}

/** Split a Commons display name ("Sarah Jones") into first / last. */
function parseCommonsName(display) {
  const parts = (display || '').trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: display || '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

async function fetchMembers(house) {
  const out = [];
  const take = 20;
  for (let skip = 0; skip < 3000; skip += take) {
    const url = `https://members-api.parliament.uk/api/Members/Search?House=${house}&IsCurrentMember=true&skip=${skip}&take=${take}`;
    let data;
    try { data = await getJson(url); } catch (e) { throw new Error(`Members API: ${e.message}`); }
    const items = data.items || [];
    for (const it of items) out.push(it.value || it);
    const total = data.totalResults != null ? data.totalResults : 0;
    if (!items.length || skip + take >= total) break;
    await sleep(1000);
  }
  return out;
}

const upsertStmt = () => db.prepare(`INSERT INTO mps
  (id, first_name, last_name, party, constituency, email, phone, photo_url, notes, is_active, house, member_api_id)
  VALUES (@id, @first, @last, @party, @constituency, NULL, NULL, @photo, NULL, 1, @house, @memberId)
  ON CONFLICT(id) DO UPDATE SET first_name=@first, last_name=@last, party=@party,
    constituency=@constituency, photo_url=@photo, is_active=1, house=@house, member_api_id=@memberId`);

async function refresh(house, label) {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const members = await fetchMembers(house);
    const upsert = upsertStmt();
    for (const p of members) {
      fetched += 1;
      const memberId = p.id;
      const isLords = house === 2;
      const { first, last } = isLords
        ? parsePeerName(p.nameDisplayAs || p.nameListAs || '')
        : parseCommonsName(p.nameDisplayAs || p.nameListAs || '');
      const id = isLords ? LORDS_ID_OFFSET + memberId : memberId;
      const existed = get('SELECT id FROM mps WHERE id = ?', [id]);
      upsert.run({
        id, first, last,
        party: p.latestParty ? p.latestParty.name : null,
        constituency: (p.latestHouseMembership && p.latestHouseMembership.membershipFrom) || null,
        photo: `https://members-api.parliament.uk/api/Members/${memberId}/Portrait?cropType=ThreeFour`,
        house: isLords ? 'Lords' : 'Commons',
        memberId,
      });
      if (!existed) created += 1;
    }
  } catch (e) {
    error = e.message;
  }
  logFetch({ source: label, started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

const refreshLords = () => refresh(2, 'lordsRefresh');
const refreshCommons = () => refresh(1, 'commonsRefresh');

module.exports = { refreshLords, refreshCommons, parsePeerName, parseCommonsName, LORDS_ID_OFFSET };
