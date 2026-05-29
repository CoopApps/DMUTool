'use strict';

/**
 * Contensis crawler CLI.
 *   node scripts/crawl-contensis.js            # discover content types only
 *   node scripts/crawl-contensis.js --full     # full crawl + publication scrape
 *   node scripts/crawl-contensis.js --enrich   # only scrape publication lists
 */

require('dotenv').config();
const { init } = require('../db/database');
const contensis = require('../services/contensis');

async function main() {
  init();
  const arg = process.argv[2];

  if (arg === '--enrich') {
    const n = await contensis.enrichPublications();
    console.log(`Enriched publications for ${n} academics.`);
    return;
  }

  if (arg === '--full') {
    const res = await contensis.crawl({ mode: 'full' });
    console.log('Crawl result:', res);
    console.log('Cross-referencing staff XML feed + reconciling legacy academics…');
    const xref = await require('../services/staffXml').run();
    console.log('Cross-reference result:', xref);
    console.log('Scraping publication lists from profile pages…');
    const n = await contensis.enrichPublications();
    console.log(`Enriched ${n} academics.`);
    return;
  }

  // Default: discovery step only.
  console.log('Discovering content types (no entries crawled). Re-run with --full to crawl.\n');
  await contensis.crawl({ mode: 'discover' });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
