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

/** Enqueue a background task (idempotent). kind: 'relevance' | 'semantic'. */
function enqueue(itemType, itemId, priority = 5, kind = 'relevance') {
  if (!TABLES[itemType]) return;
  run(`INSERT INTO task_queue (kind, item_type, item_id, priority) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, item_type, item_id) DO NOTHING`, [kind, itemType, itemId, priority]);
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
    'Score how much this is in DMU\'s INTEREST overall. DMU\'s interest has THREE CO-EQUAL facets — weigh them together, none is subordinate to another:\n' +
    '(1) Institutional impact — affects DMU as an institution: funding, tuition fees, OfS regulation, international student recruitment and visas, research funding settlements, staff pay/pensions, operations, reputation;\n' +
    '(2) Sector / University Alliance alignment — technical and professional HE, skills, degree apprenticeships, applied research, civic and regional growth;\n' +
    '(3) Academic expertise & influence — DMU has genuine expertise to contribute, lead the debate, submit evidence or raise its profile. DMU\'s own expertise IS an institutional interest, equal to the others.\n' +
    'HIGH if strong on ANY facet; MEDIUM if moderate; LOW/NONE only if genuinely incidental — a passing keyword mention in an unrelated context. ' +
    `DMU expertise areas: ${dmuExpertise()}.\nDMU institutional interest profile:\n${interestsProfile()}\n` +
    'Return JSON only.';

  const user =
    `Item title: ${item.title}\n` +
    `Item text: ${(item.text || '').slice(0, 2500)}\n` +
    `DMU academics whose expertise matches (informs facet 3): ${academicsBlock}\n\n` +
    'Return {"level":"high|medium|low|none","angles":["institutional"|"sector"|"expertise"],"rationale":"one sentence naming which DMU interest(s) are at stake, or why it is incidental"}';

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
  const LABELS = { institutional: 'Institutional', sector: 'Sector/UA', expertise: 'Expertise' };
  const angles = (Array.isArray(parsed.angles) ? parsed.angles : [parsed.angle])
    .map((a) => LABELS[String(a || '').toLowerCase()]).filter(Boolean);
  const rationale = (angles.length ? `[${angles.join(' + ')}] ` : '') + (parsed.rationale || '');
  run(`UPDATE ${map.table} SET relevance_level=?, relevance_score=?, relevance_rationale=?, relevance_checked=1 WHERE id=?`,
    [level, score, rationale || null, itemId]);

  // Relevant enough to be worth a deeper conceptual expert match (Claude).
  if (level === 'high' || level === 'medium') enqueue(itemType, itemId, 6, 'semantic');
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
