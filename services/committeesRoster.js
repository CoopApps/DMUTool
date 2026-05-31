'use strict';

/**
 * Committee roster — the standing/select committees themselves: name, house,
 * the departments they scrutinise, their current membership, and what they're
 * actively investigating (open committee business). Complements committees.js
 * (which tracks calls for evidence). Flags committees relevant to DMU topics.
 */

const { getJson, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { db, run, get, logFetch } = require('../db/database');

const BASE = 'https://committees-api.parliament.uk';

function snippet(t, n = 300) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function fetchCommittees() {
  const out = [];
  const take = 30;
  for (let skip = 0; skip < 300; skip += take) {
    const data = await getJson(`${BASE}/api/Committees?take=${take}&skip=${skip}`);
    const items = (data.items || []).map((x) => x.value || x);
    out.push(...items);
    if (items.length < take) break;
    await sleep(500);
  }
  // Active committees only (no endDate), de-dupe.
  return out.filter((c) => !c.endDate);
}

async function fetchMembers(id) {
  try {
    const data = await getJson(`${BASE}/api/Committees/${id}/Members`);
    return (data.items || data || []).map((x) => {
      const v = x.value || x;
      return { name: v.name || (v.member && v.member.nameDisplayAs), role: v.role || null,
        party: v.party || (v.member && v.member.latestParty && v.member.latestParty.name) };
    }).filter((m) => m.name);
  } catch { return []; }
}

async function fetchCurrentWork(id) {
  try {
    const data = await getJson(`${BASE}/api/CommitteeBusiness?CommitteeId=${id}&take=8`);
    return (data.items || []).map((x) => {
      const v = x.value || x;
      return { id: v.id, title: v.title,
        open: Array.isArray(v.openSubmissionPeriods) && v.openSubmissionPeriods.length > 0 };
    }).filter((w) => w.title);
  } catch { return []; }
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const committees = await fetchCommittees();
    for (const c of committees) {
      fetched += 1;
      const departments = (c.scrutinisingDepartments || [])
        .map((d) => d.name || d.department || d).filter(Boolean).join(', ');
      const { groups } = matchText(`${c.name} ${departments}`);
      // Only enrich (members + current work) for plausibly DMU-relevant committees —
      // keeps the API load reasonable. Heuristic: select/departmental committees.
      const looksRelevant = groups.length > 0 || /education|science|health|home affairs|justice|business|culture|housing|work and pensions|environment|public accounts|treasury/i.test(c.name);

      let members = [], studies = [];
      if (looksRelevant) {
        members = await fetchMembers(c.id); await sleep(400);
        studies = await fetchCurrentWork(c.id); await sleep(400);
      }

      const url = `https://committees.parliament.uk/committee/${c.id}/`;
      const exists = get('SELECT id FROM committees WHERE id = ?', [c.id]);
      const params = [c.name, c.house, c.category && (c.category.name || c.category),
        departments, JSON.stringify(members), JSON.stringify(studies),
        looksRelevant ? 1 : 0, url, new Date().toISOString()];
      if (exists) {
        run(`UPDATE committees SET name=?, house=?, category=?, departments=?, members_json=?,
             studies_json=?, relevant=?, url=?, last_scraped=? WHERE id=?`, [...params, c.id]);
      } else {
        run(`INSERT INTO committees (name, house, category, departments, members_json, studies_json, relevant, url, last_scraped, id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`, [...params, c.id]);
        created += 1;
      }
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }
  logFetch({ source: 'committeesRoster', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
