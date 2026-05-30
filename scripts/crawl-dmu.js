'use strict';

/**
 * Public DMU website crawler CLI.
 *   node scripts/crawl-dmu.js --report           # dry run: sitemap breakdown, no scraping
 *   node scripts/crawl-dmu.js                     # scrape all relevant sections
 *   node scripts/crawl-dmu.js --only course,sdg   # scrape specific sections
 *   node scripts/crawl-dmu.js --limit 50          # cap pages (testing)
 */

require('dotenv').config();
const { init } = require('../db/database');
const dmuSite = require('../services/dmuSite');

init();

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const limitIdx = args.indexOf('--limit');
const sections = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : undefined;
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

async function main() {
  if (args.includes('--report')) {
    await dmuSite.report();
    return;
  }
  console.log('Crawling DMU public site (this is rate-limited; can take a while)…');
  const res = await dmuSite.run({
    ...(sections ? { sections } : {}),
    ...(limit ? { limit } : {}),
  });
  console.log('Done:', res);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
