'use strict';

/**
 * Re-queue high-signal items for the Claude relevance gate + auto expert match.
 * Needed once after adding ANTHROPIC_API_KEY, because items ingested while the
 * key was missing were marked "unscored" and skipped. The running server's
 * background queue then processes them.
 *
 *   node scripts/rescore.js     (run with the server STOPPED, then npm start)
 */

require('dotenv').config();
const { init, all, run } = require('../db/database');
const relevance = require('../services/relevance');

init();

const claude = require('../services/claude');
if (!claude.isConfigured()) {
  console.error('ANTHROPIC_API_KEY not set in .env — add it first.');
  process.exit(1);
}

const TARGETS = [
  ['committee_inquiry', 'committee_inquiries', null],
  ['consultation', 'consultations', null],
  ['external_item', 'external_items', "source_type IN ('think_tank','briefing','govuk')"],
];

let queued = 0;
for (const [type, table, where] of TARGETS) {
  const rows = all(`SELECT id FROM ${table}${where ? ' WHERE ' + where : ''}`);
  for (const r of rows) {
    run(`UPDATE ${table} SET relevance_checked = 0 WHERE id = ?`, [r.id]);
    run('DELETE FROM task_queue WHERE item_type = ? AND item_id = ?', [type, r.id]);
    relevance.enqueue(type, r.id, 2);
    queued += 1;
  }
}
console.log(`Re-queued ${queued} items for relevance + expert scoring.`);
console.log('Start the server (npm start) and the background queue will work through them.');
