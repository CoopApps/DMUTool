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
  // Inquiries accepting evidence. The API paginates with take/skip.
  const out = [];
  let skip = 0;
  const take = 30;
  for (let page = 0; page < 20; page++) {
    const url = `${BASE}/api/Inquiries?Status=Open&take=${take}&skip=${skip}`;
    let data;
    for (let attempt = 0; ; attempt++) {
      try { data = await getJson(url); break; }
      catch (e) {
        if (attempt >= 2) throw e;       // give transient timeouts two retries
        await sleep(3000);
      }
    }
    const items = data.items || data.Items || [];
    out.push(...items);
    if (items.length < take) break;
    skip += take;
    await sleep(1000);
  }
  return out;
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

      // Only those accepting written evidence.
      const status = v.evidenceStatus || v.status || '';
      const accepting = /accept/i.test(status) || (v.submissions && v.submissions.open);
      const deadline = v.evidenceCloseDate || v.closeDate || v.deadline || null;
      const opened = v.openDate || v.dateOpened || v.startDate || null;
      const extId = String(v.id);
      const title = v.name || v.title || '';
      const committee = (v.committee && (v.committee.name)) ||
        (v.committees && v.committees[0] && v.committees[0].name) || v.committeeName || 'Committee';
      const summary = snippet(v.summary || v.shortDescription || v.description || '');
      const url = `https://committees.parliament.uk/work/${v.id}/`;

      if (!accepting && !deadline) continue;

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
