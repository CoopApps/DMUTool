'use strict';

/**
 * Runs every fetch service once, sequentially. Used for first-time population
 * and for manual "fetch everything now" runs.
 */

require('dotenv').config();
const { init } = require('../db/database');
const { seed } = require('../db/seed');

const jobs = [
  ['hansard', () => require('../services/hansard').run()],
  ['writtenQuestions', () => require('../services/writtenQuestions').run()],
  ['committees', () => require('../services/committees').run()],
  ['whatson', () => require('../services/whatson').run()],
  ['oralQuestions', () => require('../services/secondary').oralQuestions()],
  ['bills', () => require('../services/secondary').bills()],
  ['petitions', () => require('../services/secondary').petitions()],
  ['legislation', () => require('../services/secondary').legislation()],
  ['edms', () => require('../services/secondary').edms()],
  ['feeds', () => require('../services/feeds').run()],
];

async function main() {
  init();
  seed();
  for (const [name, fn] of jobs) {
    process.stdout.write(`Fetching ${name}… `);
    try {
      const r = await fn();
      console.log(`fetched ${r.fetched || 0}, new ${r.created || 0}${r.error ? `, errors: ${r.error}` : ''}`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  console.log('fetch-all complete.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
