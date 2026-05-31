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
  const keys = ['mission_group', 'institutional_interests', 'key_research', 'sdg11_hub', 'policy_unit'];
  return keys.map((k) => {
    const r = get('SELECT value FROM dmu_context WHERE key = ?', [k]);
    return r ? `- ${r.value}` : null;
  }).filter(Boolean).join('\n');
}

/**
 * No-Claude fallback. When the API key is absent we still want a curated,
 * prioritised feed — not a flat "everything is medium" dump. This ranks an
 * item from signals we already have for free: whether it matched a tracked DMU
 * topic (keyword prefilter) and how strong the DMU expert match is. Honestly
 * labelled "[keyword match]" so it's never mistaken for the Claude judgement.
 */
function heuristicScore(itemType, itemId) {
  const map = TABLES[itemType];
  if (!map) return null;
  if (!get(`SELECT 1 FROM ${map.table} WHERE id = ?`, [itemId])) return null;

  // Ensure tier-1 expert matches exist, then read the expertise signal.
  let sig = matcher.expertiseSignal(itemId, itemType);
  if (!sig.count) { try { matcher.matchItem(itemId, itemType); sig = matcher.expertiseSignal(itemId, itemType); } catch { /* ignore */ } }

  const groupCol = map.table === 'external_items' ? 'keyword_groups' : 'keyword_group';
  const gRow = get(`SELECT ${groupCol} AS g FROM ${map.table} WHERE id = ?`, [itemId]);
  const group = gRow && gRow.g ? String(gRow.g).split(',')[0].trim() : null;

  let level, bits = [];
  if (sig.strong) { level = 'high'; bits.push(`strong DMU expertise (${sig.count} academic${sig.count === 1 ? '' : 's'} match)`); }
  else if (group) {
    level = 'medium'; bits.push(`matches DMU topic “${group}”`);
    if (sig.count) bits.push(`${sig.count} possible expert${sig.count === 1 ? '' : 's'}`);
  } else { level = 'low'; bits.push('keyword match only, no DMU expert'); }

  const score = LEVEL_SCORE[level];
  const rationale = `[keyword match] ${bits.join('; ')}`;
  run(`UPDATE ${map.table} SET relevance_level=?, relevance_score=?, relevance_rationale=?, relevance_checked=1 WHERE id=?`,
    [level, score, rationale, itemId]);
  return { level, score, rationale };
}

/** Score one item. Returns { level, score, rationale } or null on skip. */
async function scoreItem(itemType, itemId) {
  const map = TABLES[itemType];
  if (!map) throw new Error(`Unknown item type: ${itemType}`);
  // No money in the Claude account → fall back to the free heuristic gate.
  if (!claude.isConfigured()) return heuristicScore(itemType, itemId);
  const item = get(`SELECT id, ${map.title} AS title, ${map.text} AS text FROM ${map.table} WHERE id = ?`, [itemId]);
  if (!item) return null;

  // Make sure tier-1 matches exist so we can show the model who at DMU fits.
  let matches = matcher.getMatches(itemId, itemType, { limit: 5 }).academics;
  if (!matches.length) { matcher.matchItem(itemId, itemType); matches = matcher.getMatches(itemId, itemType, { limit: 5 }).academics; }

  const academicsBlock = matches.length
    ? matches.map((a) => `${a.name} (${a.department})`).join('; ')
    : '(no DMU academic with genuine expertise on this)';

  const system =
    'You are the curation filter for the De Montfort University (DMU) public affairs team. DMU is a UK university; ' +
    'its public affairs work has exactly TWO functions, and an item is only relevant if it serves one of them:\n' +
    '(A) CORPORATE — it affects DMU as an institution or the HE sector it operates in: university funding, tuition fees, ' +
    'OfS regulation, international student recruitment and visas, research funding settlements, staff pay/pensions, ' +
    'free speech duties, the University Alliance / professional-and-technical-HE agenda, skills and degree apprenticeships, ' +
    'DMU\'s civic role in Leicester.\n' +
    '(B) POLICY IMPACT — it falls in an area where DMU has GENUINE research/policy STRENGTH and could credibly influence ' +
    'the debate or give evidence. DMU\'s strengths: ' + dmuExpertise() + '.\n\n' +
    'DEFAULT IS "none". Most parliamentary business is NOT DMU\'s concern — be a strict curator, not a keyword matcher. ' +
    'A topic merely being mentioned, or a loose word overlap with an academic, is NOT relevance. If DMU is neither ' +
    'affected as an institution NOR a credible expert voice, return "none" (e.g. a question on fisheries: DMU is not a ' +
    'fishing body and has no fisheries expertise → none). Naming a non-expert academic would damage DMU\'s credibility, ' +
    'so only treat the policy-impact facet as present if a listed academic genuinely works on this exact subject.\n' +
    'HIGH = clearly serves a function and is actionable; MEDIUM = genuinely relevant but lower priority; ' +
    'LOW = tangential; NONE = not DMU\'s business.\n' +
    `DMU institutional context:\n${interestsProfile()}\n` +
    'Return JSON only.';

  const user =
    `Item title: ${item.title}\n` +
    `Item text: ${(item.text || '').slice(0, 2500)}\n` +
    `DMU academics keyword-flagged as possibly relevant (judge whether any GENUINELY works on this — ignore loose overlaps): ${academicsBlock}\n\n` +
    'Return {"level":"high|medium|low|none","angles":["corporate"|"policy"],"rationale":"one sentence: which function it serves and why, or why DMU has no stake"}';

  let parsed;
  try {
    const out = await claude.callClaude({ system, user, maxTokens: 300, model: claude.FAST_MODEL });
    const m = out.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : out);
  } catch (e) {
    throw new Error(`relevance parse failed: ${e.message}`);
  }

  const level = ['high', 'medium', 'low', 'none'].includes((parsed.level || '').toLowerCase())
    ? parsed.level.toLowerCase() : 'low';
  const score = LEVEL_SCORE[level];
  const LABELS = { corporate: 'Corporate', policy: 'Policy impact',
    institutional: 'Corporate', sector: 'Corporate', expertise: 'Policy impact' };
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

/** How many items were triaged by the free heuristic (awaiting an AI re-judge). */
function heuristicCount() {
  let n = 0;
  for (const [type, map] of Object.entries(TABLES)) {
    const r = get(`SELECT COUNT(*) c FROM ${map.table} WHERE relevance_rationale LIKE '[keyword match]%'`);
    n += r ? r.c : 0;
  }
  return n;
}

/**
 * Bridge from keyword-only mode to AI curation. Re-queues every item that was
 * scored by the heuristic so that, once the Claude key is funded, the existing
 * backlog gets properly re-judged (not just new items going forward). Returns
 * the number re-queued. itemType filter optional.
 */
function reassessHeuristic() {
  let queued = 0;
  for (const [type, map] of Object.entries(TABLES)) {
    const rows = all(`SELECT id FROM ${map.table} WHERE relevance_rationale LIKE '[keyword match]%'`);
    for (const r of rows) {
      run(`UPDATE ${map.table} SET relevance_checked=0 WHERE id=?`, [r.id]);
      enqueue(type, r.id, 5, 'relevance');
      queued += 1;
    }
  }
  return queued;
}

module.exports = { enqueue, scoreItem, heuristicScore, markUnscored, heuristicCount, reassessHeuristic, TABLES };
