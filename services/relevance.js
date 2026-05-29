'use strict';

/**
 * Contextual relevance gate. The cheap keyword prefilter already happens at
 * ingest (an item only gets a keyword_group if it mentions tracked terms).
 * This adds the *intelligent* second tier: a background Claude judgement of
 * whether the item is genuinely about DMU's expertise — or just an incidental
 * keyword mention in an unrelated context.
 *
 * Runs off the task_queue (jobs/queue.js), auto-enqueued for high-signal item
 * types only. Writes relevance_level / score / rationale back onto the item.
 */

const { db, all, get, run } = require('../db/database');
const { loadGroups } = require('../lib/keywords');
const matcher = require('./matcher');
const claude = require('./claude');

const TABLES = {
  parliamentary_item: { table: 'parliamentary_items', title: 'title', text: 'full_text' },
  committee_inquiry: { table: 'committee_inquiries', title: 'inquiry_title', text: 'summary' },
  consultation: { table: 'consultations', title: 'title', text: 'summary' },
  external_item: { table: 'external_items', title: 'title', text: 'summary' },
};

const LEVEL_SCORE = { high: 1, medium: 0.66, low: 0.33, none: 0 };

/** Enqueue an item for background relevance scoring (idempotent). */
function enqueue(itemType, itemId, priority = 5) {
  if (!TABLES[itemType]) return;
  run(`INSERT INTO task_queue (kind, item_type, item_id, priority) VALUES ('relevance', ?, ?, ?)
       ON CONFLICT(kind, item_type, item_id) DO NOTHING`, [itemType, itemId, priority]);
}

function dmuExpertise() {
  return loadGroups().map((g) => g.name).join(', ');
}

/** DMU's institutional-interest profile (editable in Admin → DMU context). */
function interestsProfile() {
  const keys = ['mission_group', 'institutional_interests', 'key_research', 'sdg11_hub'];
  return keys.map((k) => {
    const r = get('SELECT value FROM dmu_context WHERE key = ?', [k]);
    return r ? `- ${r.value}` : null;
  }).filter(Boolean).join('\n');
}

/** Score one item. Returns { level, score, rationale } or null on skip. */
async function scoreItem(itemType, itemId) {
  const map = TABLES[itemType];
  if (!map) throw new Error(`Unknown item type: ${itemType}`);
  const item = get(`SELECT id, ${map.title} AS title, ${map.text} AS text FROM ${map.table} WHERE id = ?`, [itemId]);
  if (!item) return null;

  // Make sure tier-1 matches exist so we can show the model who at DMU fits.
  let matches = matcher.getMatches(itemId, itemType, { limit: 5 }).academics;
  if (!matches.length) { matcher.matchItem(itemId, itemType); matches = matcher.getMatches(itemId, itemType, { limit: 5 }).academics; }

  const academicsBlock = matches.length
    ? matches.map((a) => `${a.name} (${a.department})`).join('; ')
    : '(no keyword-matched academics)';

  const system =
    'You triage parliamentary and policy content for the De Montfort University (DMU) public affairs team. ' +
    'Relevance is about DMU\'s INTERESTS as a university and as a member of University Alliance — NOT only where it has academic expertise. ' +
    'Judge relevance through three lenses, any one of which can make an item relevant:\n' +
    '(1) Expertise — a DMU academic could comment or submit evidence;\n' +
    '(2) Institutional impact — it affects DMU as an institution: funding, tuition fees, OfS regulation, international student recruitment and visas, research funding, staff pay/pensions, operations, reputation;\n' +
    '(3) Sector / University Alliance alignment — technical and professional HE, skills, degree apprenticeships, applied research, civic and regional growth.\n' +
    'An item can be HIGH relevance with NO academic match if it materially affects DMU institutionally or aligns with the UA agenda. ' +
    'Be strict only about genuinely incidental keyword mentions in unrelated contexts. ' +
    `DMU areas of expertise: ${dmuExpertise()}.\nDMU institutional interest profile:\n${interestsProfile()}\n` +
    'Return JSON only.';

  const user =
    `Item title: ${item.title}\n` +
    `Item text: ${(item.text || '').slice(0, 2500)}\n` +
    `Keyword-matched DMU academics (may be empty — absence does NOT lower institutional relevance): ${academicsBlock}\n\n` +
    'Return {"level":"high|medium|low|none","angle":"expertise|institutional|sector","rationale":"one sentence naming the DMU interest at stake, or why it is incidental"}';

  let parsed;
  try {
    const out = await claude.callClaude({ system, user, maxTokens: 300 });
    const m = out.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : out);
  } catch (e) {
    throw new Error(`relevance parse failed: ${e.message}`);
  }

  const level = ['high', 'medium', 'low', 'none'].includes((parsed.level || '').toLowerCase())
    ? parsed.level.toLowerCase() : 'low';
  const score = LEVEL_SCORE[level];
  const angleLabel = { expertise: 'Expertise', institutional: 'Institutional', sector: 'Sector/UA' }[(parsed.angle || '').toLowerCase()];
  const rationale = (angleLabel ? `[${angleLabel}] ` : '') + (parsed.rationale || '');
  run(`UPDATE ${map.table} SET relevance_level=?, relevance_score=?, relevance_rationale=?, relevance_checked=1 WHERE id=?`,
    [level, score, rationale || null, itemId]);
  return { level, score, rationale };
}

/** A degraded, no-API fallback: mark as checked at neutral relevance. */
function markUnscored(itemType, itemId) {
  const map = TABLES[itemType];
  if (!map) return;
  run(`UPDATE ${map.table} SET relevance_checked=1, relevance_level=COALESCE(relevance_level,'medium'),
       relevance_score=COALESCE(relevance_score,0.5) WHERE id=?`, [itemId]);
}

module.exports = { enqueue, scoreItem, markUnscored, TABLES };
