'use strict';

/**
 * UKRI Gateway to Research (GtR) — DMU's actual funded projects, so drafts can
 * cite real funded research rather than just profile text. Free API, no key.
 * Resolves the DMU organisation, fetches its projects, keyword-tags them.
 */

const { getJson, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { db, get, run, logFetch } = require('../db/database');

const BASE = 'https://gtr.ukri.org/gtr/api';
const ORG_NAME = process.env.GTR_ORG_NAME || 'De Montfort University';
const HEADERS = { Accept: 'application/json' };

function snippet(t, n = 1000) {
  if (!t) return '';
  return String(t).replace(/\s+/g, ' ').trim().slice(0, n);
}

async function resolveOrgId() {
  if (process.env.GTR_ORG_ID) return process.env.GTR_ORG_ID;
  const data = await getJson(`${BASE}/organisations?q=${encodeURIComponent(ORG_NAME)}&p=1&s=10`, { headers: HEADERS });
  const orgs = data.organisation || data.organisations || [];
  const match = orgs.find((o) => (o.name || '').toLowerCase().includes('de montfort')) || orgs[0];
  return match ? match.id : null;
}

async function fetchProjects(orgId) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const data = await getJson(`${BASE}/organisations/${orgId}/projects?p=${page}&s=50`, { headers: HEADERS });
    const projects = data.project || data.projects || [];
    out.push(...projects);
    const total = (data.totalPages != null) ? data.totalPages : 1;
    if (!projects.length || page >= total) break;
    await sleep(1000);
  }
  return out;
}

function upsert(p) {
  const gtrId = p.id;
  const title = p.title;
  const abstract = snippet(p.abstractText || p.abstract);
  const funder = (p.fund && p.fund.funder && p.fund.funder.name) ||
    (p.identifiers && 'UKRI') || 'UKRI';
  const value = (p.fund && p.fund.valuePounds) || null;
  const start = p.fund && p.fund.start;
  const end = p.fund && p.fund.end;
  const url = `https://gtr.ukri.org/projects?ref=${encodeURIComponent(p.grantReference || gtrId)}`;
  const { groups } = matchText(`${title} ${abstract}`);

  const exists = get('SELECT id FROM grants WHERE gtr_id = ?', [gtrId]);
  const params = [title, abstract, funder, ORG_NAME, value, start, end, url, groups.join(','), new Date().toISOString()];
  if (exists) {
    run(`UPDATE grants SET title=?, abstract=?, funder=?, lead_org=?, value=?, start_date=?, end_date=?,
         url=?, keyword_groups=?, last_scraped=? WHERE id=?`, [...params, exists.id]);
    return false;
  }
  run(`INSERT INTO grants (title, abstract, funder, lead_org, value, start_date, end_date, url, keyword_groups, last_scraped, gtr_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...params, gtrId]);
  return true;
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const orgId = await resolveOrgId();
    if (!orgId) throw new Error(`could not resolve GtR org id for "${ORG_NAME}"`);
    const projects = await fetchProjects(orgId);
    for (const p of projects) { fetched += 1; if (upsert(p)) created += 1; }
  } catch (e) {
    error = e.message;
  }
  logFetch({ source: 'ukri', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, resolveOrgId };
