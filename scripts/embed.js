'use strict';

/**
 * Embed academics + all items via Voyage, then compute semantic matches.
 *   node scripts/embed.js
 * Re-runnable: only embeds rows that don't yet have a vector.
 */

require('dotenv').config();
const { init, all } = require('../db/database');
const emb = require('../services/embeddings');

init();

async function main() {
  if (!emb.isConfigured()) {
    console.error('VOYAGE_API_KEY not set — add it to .env to enable semantic matching.');
    process.exit(1);
  }
  console.log('Embedding academics…');
  await emb.embedAcademics();
  emb.clearCache();

  let totalMatched = 0;
  for (const itemType of Object.keys(emb.ITEM_TABLES)) {
    const map = emb.ITEM_TABLES[itemType];
    console.log(`Embedding ${itemType}…`);
    await emb.embedItems(itemType);
    console.log(`Matching ${itemType}…`);
    const ids = all(`SELECT id FROM ${map.table} WHERE embedding IS NOT NULL`);
    for (const r of ids) { emb.matchItemEmbeddings(r.id, itemType); totalMatched += 1; }
    console.log(`  matched ${ids.length} ${itemType}s`);
  }
  console.log(`Done — semantic matches computed for ${totalMatched} items.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
