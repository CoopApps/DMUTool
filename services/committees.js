'use strict';

/**
 * Committees service — fetches open inquiries accepting evidence, computes
 * recess-aware working days to deadline, flags new inquiries (opened in the
 * last 24h) and runs academic matching immediately on those.
 */

const { getJson, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { workingDaysUntil } = require('../lib/parliament');
const { db, run, logFetch } = require('../db/database');
const matcher = require('./matcher');

const BASE = 'https://committees-api.parliament.uk';

function snippet(text, n = 400) {
  if (!text) return '';
  const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

async function fetchOpenInquiries() {
  // CommitteeBusiness items, newest first. We keep only those currently open for
  // written submissions (openSubmissionPeriods non-empty) — i.e. live calls for
  // evidence DMU can respond to. Stop early once we're past the recent window.
  const out = [];
  const take = 30;
  for (let skip = 0; skip < 600; skip += take) {
    const url = `${BASE}/api/CommitteeBusiness?take=${take}&skip=${skip}&OrderBy=DateOpenedDescending`;
    let data;
    for (let attempt = 0; ; attempt++) {
      try { data = await getJson(url); break; }
      catch (e) { if (attempt >= 2) throw e; await sleep(3000); }
    }
    const items = data.items || data.Items || [];
    if (!items.length) break;
    const open = items.filter((it) => {
      const v = it.value || it;
      return Array.isArray(v.openSubmissionPeriods) && v.openSubmissionPeriods.length > 0;
    });
    out.push(...open);
    // Once the newest-first page is entirely closed AND old, we can stop.
    const oldestOnPage = items[items.length - 1].value || items[items.length - 1];
    const oldOpen = oldestOnPage.openDate ? new Date(oldestOnPage.openDate).getTime() : 0;
    if (skip >= 120 && oldOpen && oldOpen < Date.now() - 365 * 24 * 3600 * 1000 && !open.length) break;
    await sleep(800);
  }
  return out;
}

/** Earliest closing date among an item's open submission periods. */
function submissionDeadline(v) {
  const ends = (v.openSubmissionPeriods || [])
    .map((p) => p.endDate || p.closeDate || p.end)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d));
  if (!ends.length) return null;
  return new Date(Math.min(...ends.map((d) => d.getTime()))).toISOString();
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  const dayAgo = Date.now() - 24 * 3600 * 1000;

  try {
    const inquiries = await fetchOpenInquiries();
    for (const raw of inquiries) {
      const v = raw.value || raw;
      fetched += 1;

      // Live call for evidence: must have an open submission period.
      const accepting = Array.isArray(v.openSubmissionPeriods) && v.openSubmissionPeriods.length > 0;
      const deadline = submissionDeadline(v);
      const opened = v.openDate || v.dateOpened || v.startDate || null;
      const extId = String(v.id);
      const title = v.title || v.name || '';
      const committee = (v.committees && v.committees[0] && v.committees[0].name)
        || (v.committee && v.committee.name) || v.committeeName
        || (v.type && v.type.name) || 'Committee';
      const summary = snippet(v.description || v.summary || (v.type && v.type.description) || '');
      const url = `https://committees.parliament.uk/work/${v.id}/`;

      if (!accepting) continue;

      const wdr = await workingDaysUntil(deadline);
      const isNew = opened ? new Date(opened).getTime() > dayAgo ? 1 : 0 : 0;
      const { primary } = matchText(`${title} ${summary}`);

      const existing = db.prepare('SELECT id FROM committee_inquiries WHERE external_id = ?').get(extId);
      let inquiryId;
      if (existing) {
        run(`UPDATE committee_inquiries SET committee_name=?, inquiry_title=?, date_opened=?,
             deadline=?, working_days_remaining=?, summary=?, url=?, evidence_status=?, keyword_group=?
             WHERE id=?`,
          [committee, title, opened, deadline, wdr, summary, url, 'AcceptingEvidence', primary, existing.id]);
        inquiryId = existing.id;
      } else {
        const info = run(`INSERT INTO committee_inquiries
          (external_id, committee_name, inquiry_title, date_opened, deadline,
           working_days_remaining, summary, url, is_new, evidence_status, keyword_group)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [extId, committee, title, opened, deadline, wdr, summary, url, isNew, 'AcceptingEvidence', primary]);
        inquiryId = info.lastInsertRowid;
        created += 1;
        // Run academic matching immediately, then queue background relevance scoring.
        try { matcher.matchItem(inquiryId, 'committee_inquiry'); } catch { /* non-fatal */ }
        try { require('./relevance').enqueue('committee_inquiry', inquiryId, 1); } catch { /* non-fatal */ }
      }
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'committees', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
