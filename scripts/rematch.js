'use strict';

/**
 * Re-run academic/course/event matching over all stored items. Useful after the
 * profile scraper enriches academics (research interests + publications), since
 * matches are normally computed once at ingest.
 *
 *   node scripts/rematch.js
 */

require('dotenv').config();
const { init, all } = require('../db/database');
const matcher = require('../services/matcher');

init();

const SOURCES = [
  ['parliamentary_items', 'parliamentary_item'],
  ['committee_inquiries', 'committee_inquiry'],
  ['consultations', 'consultation'],
  ['external_items', 'external_item'],
];

let total = 0;
for (const [table, type] of SOURCES) {
  const rows = all(`SELECT id FROM ${table}`);
  for (const r of rows) {
    try { matcher.matchItem(r.id, type); total += 1; } catch { /* skip */ }
  }
  console.log(`  rematched ${rows.length} ${type}s`);
}
console.log(`Rematch complete — ${total} items rescored against the current academic data.`);
