'use strict';

/**
 * Deadline-breach alerts. Finds DMU-relevant committee inquiries and government
 * consultations whose response window has crossed a threshold (≤7 working days,
 * then ≤1 working day) and — if SMTP is configured — emails a heads-up. Each
 * item is alerted once per threshold via the `alerted_wd` column, so daily runs
 * don't re-send. On-screen, the Command Centre surfaces the same breaches
 * independently (no email required).
 */

const { all, run: dbRun, logFetch } = require('../db/database');
const email = require('./email');
const { esc } = require('../lib/render');

const interestOk = (r) => !r.relevance_checked || ['high', 'medium'].includes(r.relevance_level);
// Tightest bucket an item has entered (lower = more urgent).
function bucket(wdr) { return wdr == null ? null : wdr <= 1 ? 1 : wdr <= 7 ? 7 : null; }

function gather() {
  const inq = all(
    `SELECT id, 'committee_inquiry' AS kind, committee_name AS org, inquiry_title AS title,
            working_days_remaining AS wdr, url, alerted_wd, relevance_checked, relevance_level
     FROM committee_inquiries WHERE evidence_status='AcceptingEvidence'
       AND working_days_remaining BETWEEN 0 AND 7`);
  const cons = all(
    `SELECT id, 'consultation' AS kind, organisation AS org, title,
            working_days_remaining AS wdr, url, alerted_wd, relevance_checked, relevance_level
     FROM consultations WHERE (deadline IS NULL OR date(deadline) >= date('now'))
       AND working_days_remaining BETWEEN 0 AND 7`);
  return [...inq, ...cons].filter(interestOk);
}

function buildHtml(due) {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const rows = due.sort((a, b) => a.wdr - b.wdr).map((d) =>
    `<p style="margin:6px 0"><b style="color:#c62828">${d.wdr} working day${d.wdr === 1 ? '' : 's'} left</b> —
      ${esc(d.org || '')}: <a href="${esc(d.url || base)}">${esc(d.title)}</a>
      <span style="color:#667">(${d.kind === 'committee_inquiry' ? 'Committee inquiry' : 'Consultation'})</span></p>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:680px;color:#1c2333">
    <h1 style="font-size:18px;color:#c62828">⚠ DMU response deadlines closing</h1>
    <p style="color:#667">${due.length} relevant deadline${due.length === 1 ? '' : 's'} closing within 7 working days.</p>
    ${rows}
    <hr style="margin:18px 0;border:none;border-top:1px solid #e2e5ea">
    <p><a href="${base}/action">Open the Command Centre →</a></p>
  </div>`;
}

async function run() {
  const started_at = new Date().toISOString();
  const items = gather();
  // Alert only those that have entered a tighter bucket than last alerted.
  const due = items.filter((r) => { const b = bucket(r.wdr); return b != null && (r.alerted_wd == null || r.alerted_wd > b); });
  for (const r of due) {
    const b = bucket(r.wdr);
    const table = r.kind === 'committee_inquiry' ? 'committee_inquiries' : 'consultations';
    dbRun(`UPDATE ${table} SET alerted_wd=? WHERE id=?`, [b, r.id]);
  }
  let sent = false, error = null;
  if (due.length && email.isConfigured()) {
    try {
      await email.sendMail({ subject: `⚠ DMU: ${due.length} response deadline(s) closing soon`, html: buildHtml(due) });
      sent = true;
    } catch (e) { error = e.message; }
  } else if (due.length) {
    error = 'SMTP not configured — breaches shown on Command Centre only, not emailed.';
  }
  logFetch({ source: 'deadlineAlerts', started_at, completed_at: new Date().toISOString(),
    items_fetched: due.length, items_new: due.length, error });
  return { due: due.length, sent };
}

module.exports = { run };
