'use strict';

/**
 * Build an iCalendar (.ics) feed of the time-sensitive things the tool tracks:
 * committee + consultation response deadlines, and oral-question submission
 * cut-offs. Subscribe/import into Outlook or Google Calendar.
 */

const { all } = require('../db/database');
const { sittingDaysBefore } = require('../lib/parliament');

function fmtDate(d) {
  // All-day VALUE=DATE format: YYYYMMDD
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}
function esc(t) {
  return String(t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}
function uid(prefix, id) { return `${prefix}-${id}@dmu-parliamentary`; }

function vevent({ uid: u, date, summary, description, url }) {
  const d = fmtDate(date);
  if (!d) return '';
  return [
    'BEGIN:VEVENT',
    `UID:${u}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : '',
    url ? `URL:${esc(url)}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

async function buildIcs() {
  const events = [];

  for (const q of all(`SELECT id, committee_name, inquiry_title, deadline, url FROM committee_inquiries
      WHERE evidence_status='AcceptingEvidence' AND deadline IS NOT NULL AND date(deadline) >= date('now')
        AND (relevance_checked=0 OR relevance_level IN ('high','medium'))`)) {
    events.push(vevent({ uid: uid('cttee', q.id), date: q.deadline,
      summary: `Deadline: ${q.committee_name} — ${q.inquiry_title}`,
      description: 'Committee evidence deadline', url: q.url }));
  }

  for (const c of all(`SELECT id, organisation, title, deadline, url FROM consultations
      WHERE deadline IS NOT NULL AND date(deadline) >= date('now')
        AND (relevance_checked=0 OR relevance_level IN ('high','medium'))`)) {
    events.push(vevent({ uid: uid('cons', c.id), date: c.deadline,
      summary: `Consultation closes: ${c.organisation || 'GOV.UK'} — ${c.title}`,
      description: 'Government consultation deadline', url: c.url }));
  }

  for (const o of all(`SELECT id, title, date, meta_json, url FROM external_items
      WHERE source_type='oral_question' AND date >= date('now') ORDER BY date ASC LIMIT 12`)) {
    if (!o.date) continue;
    let dept = o.title;
    try { const m = JSON.parse(o.meta_json || '{}'); if (m.department) dept = m.department; } catch { /* ignore */ }
    const cutoff = await sittingDaysBefore(new Date(o.date), 3);
    events.push(vevent({ uid: uid('oral', o.id), date: cutoff.toISOString(),
      summary: `Oral Q deadline (12:30): ${dept}`,
      description: `Submission cut-off for ${dept} oral questions (session ${(o.date || '').slice(0, 10)})`, url: o.url }));
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DMU Parliamentary Intelligence//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:DMU Parliamentary deadlines',
    ...events.filter(Boolean),
    'END:VCALENDAR',
  ].join('\r\n');
}

module.exports = { buildIcs };
