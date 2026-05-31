'use strict';

/**
 * Score the relevance backlog now — runs the Claude curation gate over all
 * unscored items so the curated digest fills promptly instead of trickling in
 * via the background queue. Uses the fast (Haiku) model and modest concurrency.
 *
 *   node scripts/score-backlog.js            # high-signal items (committees,
 *                                              consultations, think-tanks, briefings)
 *   node scripts/score-backlog.js --parl     # also parliamentary items (bigger/costlier)
 *   node scripts/score-backlog.js --limit 200
 */

require('dotenv').config();
const { init, all } = require('../db/database');
const relevance = require('../services/relevance');
const claude = require('../services/claude');

init();

if (!claude.isConfigured()) {
  console.error('ANTHROPIC_API_KEY not set — add it to .env first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const includeParl = args.includes('--parl');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const CONCURRENCY = parseInt(process.env.SCORE_CONCURRENCY || '4', 10);

function targets() {
  const out = [];
  out.push(...all(`SELECT id FROM committee_inquiries WHERE relevance_checked = 0`).map((r) => ['committee_inquiry', r.id]));
  out.push(...all(`SELECT id FROM consultations WHERE relevance_checked = 0`).map((r) => ['consultation', r.id]));
  out.push(...all(`SELECT id FROM external_items WHERE relevance_checked = 0
                   AND source_type IN ('think_tank','briefing','govuk')`).map((r) => ['external_item', r.id]));
  if (includeParl) {
    out.push(...all(`SELECT id FROM parliamentary_items WHERE relevance_checked = 0
                     AND date >= date('now','-30 days')`).map((r) => ['parliamentary_item', r.id]));
  }
  return out.slice(0, LIMIT === Infinity ? undefined : LIMIT);
}

async function main() {
  const jobs = targets();
  console.log(`Scoring ${jobs.length} items via ${claude.FAST_MODEL} (concurrency ${CONCURRENCY})…`);
  let done = 0, high = 0, med = 0, none = 0, err = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const [type, id] = jobs[cursor++];
      try {
        const r = await relevance.scoreItem(type, id);
        if (r) { if (r.level === 'high') high++; else if (r.level === 'medium') med++; else none++; }
      } catch { err++; }
      if (++done % 25 === 0) console.log(`  …${done}/${jobs.length}  (high ${high}, medium ${med}, none/low ${none})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Done — ${done} scored. Relevant: ${high} high, ${med} medium. Filtered out: ${none}. Errors: ${err}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
