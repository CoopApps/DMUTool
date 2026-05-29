'use strict';

/**
 * Academic matching engine.
 *  Tier 1 — fast keyword scoring (profile x3, publications x2, department x1,
 *           course titles in school x1) run synchronously on every new item.
 *  Tier 2 — semantic matching via the Claude API, triggered on demand.
 * Also matches items to courses and to professional bodies.
 */

const { db, all, get, run } = require('../db/database');
const { loadGroups } = require('../lib/keywords');

const ITEM_QUERIES = {
  parliamentary_item: 'SELECT id, title, snippet, full_text, keyword_group FROM parliamentary_items WHERE id = ?',
  committee_inquiry: 'SELECT id, inquiry_title AS title, summary AS snippet, summary AS full_text, keyword_group FROM committee_inquiries WHERE id = ?',
  consultation: 'SELECT id, title, summary AS snippet, summary AS full_text, keyword_group FROM consultations WHERE id = ?',
  external_item: 'SELECT id, title, summary AS snippet, summary AS full_text, keyword_groups AS keyword_group FROM external_items WHERE id = ?',
};

function getItem(itemId, itemType) {
  const sql = ITEM_QUERIES[itemType];
  if (!sql) throw new Error(`Unknown item type: ${itemType}`);
  return get(sql, [itemId]);
}

/** Build the searchable terms for an item: its text + its keyword group's keywords. */
function itemTerms(item) {
  const base = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  const groups = loadGroups();
  const grp = groups.find((g) => g.name === item.keyword_group);
  const kws = grp ? grp.keywords : [];
  // Significant words from the item title/snippet (length > 3).
  const words = base.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return { words: [...new Set(words)], keywords: kws, text: base };
}

function countHits(haystack, terms) {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  let n = 0;
  for (const t of terms) if (t && h.includes(t)) n += 1;
  return n;
}

/**
 * Tier 1 keyword matching. Scores every academic, stores the top 5 (score>0)
 * in academic_matches, and also runs course matching. Returns the matches.
 */
function matchItem(itemId, itemType) {
  const item = getItem(itemId, itemType);
  if (!item) return [];
  const { words, keywords } = itemTerms(item);
  const terms = [...new Set([...words, ...keywords])];

  const academics = all('SELECT id, name, department, profile_text, publications_json FROM academics');

  // Preload course titles grouped by school/department so we can credit
  // "course titles in their school" (weight 1) per the brief.
  const deptCourses = {};
  for (const c of all('SELECT title, school, department FROM courses')) {
    for (const key of [c.school, c.department]) {
      if (!key) continue;
      const k = key.toLowerCase().trim();
      (deptCourses[k] = deptCourses[k] || []).push(c.title || '');
    }
  }

  // Accumulated human feedback for this topic boosts/suppresses academics.
  const fb = {};
  if (item.keyword_group) {
    for (const r of all('SELECT academic_id, votes FROM academic_feedback WHERE keyword_group = ?', [item.keyword_group])) {
      fb[r.academic_id] = r.votes;
    }
  }

  const scored = [];
  for (const a of academics) {
    let pubTitles = '';
    try {
      const pubs = a.publications_json ? JSON.parse(a.publications_json) : [];
      pubTitles = Array.isArray(pubs)
        ? pubs.map((p) => (typeof p === 'string' ? p : p.title || p.journal || '')).join(' ')
        : '';
    } catch { /* ignore malformed json */ }

    const courseTitles = (deptCourses[(a.department || '').toLowerCase().trim()] || []).join(' ');

    const score =
      countHits(a.profile_text, terms) * 3 +
      countHits(pubTitles, terms) * 2 +
      countHits(a.department, terms) * 1 +
      countHits(courseTitles, terms) * 1 +
      (fb[a.id] || 0) * 2;   // human feedback nudges ranking

    if (score > 0) scored.push({ academic_id: a.id, name: a.name, department: a.department, score });
  }

  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, 5);

  // Persist (replace existing keyword matches for this item).
  run('DELETE FROM academic_matches WHERE item_id=? AND item_type=? AND match_type=?',
    [itemId, itemType, 'keyword']);
  const ins = db.prepare(`INSERT OR REPLACE INTO academic_matches
    (item_id, item_type, academic_id, score, match_type, explanation)
    VALUES (?,?,?,?, 'keyword', ?)`);
  for (const m of top) {
    ins.run(itemId, itemType, m.academic_id, m.score,
      `Keyword overlap on profile, publications and department (score ${m.score}).`);
  }

  matchCourses(itemId, itemType, terms);
  matchEvents(itemId, itemType, terms);
  return top;
}

/** Score courses by keyword overlap in title + description. Stores top 5. */
function matchCourses(itemId, itemType, terms) {
  const courses = all('SELECT id, title, description, keywords FROM courses');
  const scored = [];
  for (const c of courses) {
    const score = countHits(`${c.title} ${c.description} ${c.keywords}`, terms);
    if (score > 0) scored.push({ course_id: c.id, score });
  }
  scored.sort((x, y) => y.score - x.score);
  run('DELETE FROM course_matches WHERE item_id=? AND item_type=?', [itemId, itemType]);
  const ins = db.prepare(`INSERT OR REPLACE INTO course_matches (item_id, item_type, course_id, score)
    VALUES (?,?,?,?)`);
  for (const m of scored.slice(0, 5)) ins.run(itemId, itemType, m.course_id, m.score);
  return scored.slice(0, 5);
}

/** Score upcoming DMU events by keyword overlap. Stores top 3 future events. */
function matchEvents(itemId, itemType, terms) {
  // Only consider events that haven't already happened (date null or future).
  const events = all(`SELECT id, title, description, keywords, date FROM dmu_events
    WHERE date IS NULL OR date('now') <= date(date)`);
  const scored = [];
  for (const ev of events) {
    const score = countHits(`${ev.title} ${ev.description} ${ev.keywords}`, terms);
    if (score > 0) scored.push({ event_id: ev.id, score });
  }
  scored.sort((x, y) => y.score - x.score);
  run('DELETE FROM event_matches WHERE item_id=? AND item_type=?', [itemId, itemType]);
  const ins = db.prepare(`INSERT OR REPLACE INTO event_matches (item_id, item_type, event_id, score)
    VALUES (?,?,?,?)`);
  for (const m of scored.slice(0, 3)) ins.run(itemId, itemType, m.event_id, m.score);
  return scored.slice(0, 3);
}

/** Fetch stored matches (academics + courses + events) joined to their records. */
function getMatches(itemId, itemType, { limit = 5 } = {}) {
  const academics = all(
    `SELECT am.score, am.match_type, am.confidence, am.explanation,
            a.id, a.name, a.title, a.department, a.email, a.profile_url, a.profile_text
     FROM academic_matches am JOIN academics a ON a.id = am.academic_id
     WHERE am.item_id=? AND am.item_type=?
     ORDER BY (am.match_type='semantic') DESC, am.score DESC LIMIT ?`,
    [itemId, itemType, limit]
  );
  const courses = all(
    `SELECT cm.score, c.id, c.title, c.award, c.url, c.department
     FROM course_matches cm JOIN courses c ON c.id = cm.course_id
     WHERE cm.item_id=? AND cm.item_type=? ORDER BY cm.score DESC LIMIT 5`,
    [itemId, itemType]
  );
  const events = all(
    `SELECT em.score, e.id, e.title, e.date, e.location, e.url
     FROM event_matches em JOIN dmu_events e ON e.id = em.event_id
     WHERE em.item_id=? AND em.item_type=? ORDER BY em.score DESC LIMIT 3`,
    [itemId, itemType]
  );
  const bodies = matchProfessionalBodies(academics);
  return { academics, courses, events, professional_bodies: bodies };
}

/** For each matched academic's department, surface the relevant professional body
 *  and its most recent external item. */
function matchProfessionalBodies(academics) {
  const depts = [...new Set(academics.map((a) => a.department).filter(Boolean))];
  if (!depts.length) return [];
  const bodies = all('SELECT id, name, departments_json FROM professional_bodies');
  const out = [];
  const seen = new Set();
  for (const b of bodies) {
    let bdepts = [];
    try { bdepts = JSON.parse(b.departments_json || '[]'); } catch { /* ignore */ }
    const match = depts.find((d) => bdepts.some((bd) => d && d.toLowerCase().includes(bd.toLowerCase())));
    if (match && !seen.has(b.id)) {
      seen.add(b.id);
      const latest = get(
        `SELECT title, url, date FROM external_items WHERE source_name = ? ORDER BY date DESC LIMIT 1`,
        [b.name]
      );
      out.push({ body: b.name, department: match, latest });
    }
  }
  return out;
}

/**
 * Tier 2 semantic matching via the Claude API. Cached for 7 days per item.
 * Returns { matches, cached }.
 */
async function semanticMatch(itemId, itemType) {
  // Cache check: skip API if recent semantic matches exist.
  const recent = get(
    `SELECT COUNT(*) c FROM academic_matches
     WHERE item_id=? AND item_type=? AND match_type='semantic'
       AND created_at > datetime('now','-7 days')`,
    [itemId, itemType]
  );
  if (recent && recent.c > 0) {
    return { matches: getMatches(itemId, itemType).academics.filter((m) => m.match_type === 'semantic'), cached: true };
  }

  // Ensure tier-1 has run so we have candidates.
  let candidates = all(
    `SELECT a.id, a.name, a.department, a.profile_text, a.publications_json
     FROM academic_matches am JOIN academics a ON a.id = am.academic_id
     WHERE am.item_id=? AND am.item_type=? AND am.match_type='keyword'
     ORDER BY am.score DESC LIMIT 20`,
    [itemId, itemType]
  );
  if (!candidates.length) {
    matchItem(itemId, itemType);
    candidates = all(
      `SELECT a.id, a.name, a.department, a.profile_text, a.publications_json
       FROM academic_matches am JOIN academics a ON a.id = am.academic_id
       WHERE am.item_id=? AND am.item_type=? AND am.match_type='keyword'
       ORDER BY am.score DESC LIMIT 20`,
      [itemId, itemType]
    );
  }
  if (!candidates.length) return { matches: [], cached: false };

  const item = getItem(itemId, itemType);
  const { callClaude } = require('./claude');

  const profilesText = candidates.map((a) => {
    let pubs = '';
    try {
      const arr = JSON.parse(a.publications_json || '[]');
      pubs = arr.slice(0, 5).map((p) => (typeof p === 'string' ? p : p.title || '')).join('; ');
    } catch { /* ignore */ }
    return `- ${a.name} (id:${a.id}), ${a.department}: ${(a.profile_text || '').slice(0, 200)} | Recent: ${pubs}`;
  }).join('\n');

  const system = 'You are matching parliamentary content to academic expertise at De Montfort University, Leicester. ' +
    'Given the parliamentary item and academic profiles below, identify the 3-5 strongest matches. ' +
    'Consider conceptual connections beyond exact keyword matches. For each match provide: academic name, ' +
    'department, a single sentence explaining the relevance, and a confidence level (high/medium/low). Return JSON only.';

  const user = `Parliamentary item: ${item.title} — ${(item.full_text || item.snippet || '').slice(0, 2000)}\n\n` +
    `Academics database (top 20 by keyword score):\n${profilesText}\n\n` +
    `Return a JSON array of objects: [{"academic_id": <id>, "name": "...", "department": "...", "explanation": "...", "confidence": "high|medium|low"}]`;

  let parsed = [];
  try {
    const text = await callClaude({ system, user, maxTokens: 1000 });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (e) {
    return { matches: [], cached: false, error: e.message };
  }

  run('DELETE FROM academic_matches WHERE item_id=? AND item_type=? AND match_type=?',
    [itemId, itemType, 'semantic']);
  const ins = db.prepare(`INSERT OR REPLACE INTO academic_matches
    (item_id, item_type, academic_id, score, match_type, confidence, explanation)
    VALUES (?,?,?,?, 'semantic', ?, ?)`);
  const confScore = { high: 3, medium: 2, low: 1 };
  for (const m of parsed) {
    if (!m.academic_id) continue;
    ins.run(itemId, itemType, m.academic_id, confScore[(m.confidence || '').toLowerCase()] || 1,
      m.confidence || 'medium', m.explanation || '');
  }

  return { matches: getMatches(itemId, itemType).academics.filter((x) => x.match_type === 'semantic'), cached: false };
}

module.exports = { matchItem, matchCourses, matchEvents, getMatches, semanticMatch, matchProfessionalBodies };
