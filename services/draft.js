'use strict';

/**
 * Drafting service — builds the institutional-voice prompt described in the
 * brief and calls the Claude API to generate the requested output type.
 */

const { all, get } = require('../db/database');
const matcher = require('./matcher');
const { callClaude } = require('./claude');

const OUTPUT_INSTRUCTIONS = {
  quote: 'a media quote — 2-3 sentences, attributed to a named academic or the VP Research',
  press_response: 'a press response — 150-200 words, institutional voice, can reference specific research',
  briefing_note: 'a briefing note — structured: context, DMU\'s position, relevant research, recommended action',
  committee_submission: 'a committee submission opening — 300-400 words, formal register, references matched academics and their publications',
  mp_email: 'an MP engagement email — personalised to the specific MP, referencing their recent contributions, proposing a meeting or briefing',
};

const ITEM_QUERIES = {
  parliamentary_item: 'SELECT id, title, full_text, member_name FROM parliamentary_items WHERE id = ?',
  committee_inquiry: 'SELECT id, inquiry_title AS title, summary AS full_text FROM committee_inquiries WHERE id = ?',
  consultation: 'SELECT id, title, summary AS full_text FROM consultations WHERE id = ?',
  external_item: 'SELECT id, title, summary AS full_text FROM external_items WHERE id = ?',
};

function dmuContextBlock() {
  const rows = all('SELECT key, value FROM dmu_context WHERE key != ?', ['new_events_count']);
  return rows.map((r) => `- ${r.value}`).join('\n');
}

async function draft({ item_id, item_type, output_type, mp_id }) {
  const sql = ITEM_QUERIES[item_type];
  if (!sql) throw new Error(`Unknown item_type: ${item_type}`);
  const item = get(sql, [item_id]);
  if (!item) throw new Error('Item not found');

  // Ensure tier-1 matches exist.
  let matches = matcher.getMatches(item_id, item_type);
  if (!matches.academics.length) {
    matcher.matchItem(item_id, item_type);
    matches = matcher.getMatches(item_id, item_type);
  }

  const academicsBlock = matches.academics
    .map((a) => `${a.name}, ${a.title || ''}, ${a.department}: ${(a.profile_text || '').slice(0, 200)}`)
    .join('\n');
  const coursesBlock = matches.courses.map((c) => c.title).join(', ');

  let mpBlock = '';
  if (output_type === 'mp_email' && mp_id) {
    const mp = get('SELECT * FROM mps WHERE id = ?', [mp_id]);
    if (mp) {
      const contributions = all(
        `SELECT title, date, source FROM parliamentary_items
         WHERE member_name LIKE ? ORDER BY date DESC LIMIT 3`,
        [`%${mp.last_name}%`]
      );
      mpBlock = `\nTarget MP: ${mp.first_name} ${mp.last_name} (${mp.party}, ${mp.constituency})\n` +
        `Recent contributions:\n${contributions.map((c) => `- ${c.date}: ${c.title} (${c.source})`).join('\n') || '- (none on record)'}\n`;
    }
  }

  const instruction = OUTPUT_INSTRUCTIONS[output_type] || OUTPUT_INSTRUCTIONS.press_response;

  const content = `You are assisting the Senior Public Affairs Officer at De Montfort University (DMU), Leicester.\n\n` +
    `DMU context:\n${dmuContextBlock()}\n\n` +
    `Parliamentary item:\n${item.title}\n${(item.full_text || '').slice(0, 3000)}\n\n` +
    `Matched DMU academics:\n${academicsBlock || '(none matched)'}\n\n` +
    `Matched DMU courses: ${coursesBlock || '(none)'}\n` +
    mpBlock +
    `\nDraft ${instruction} in DMU's institutional voice — professional, direct, evidence-grounded, not promotional.`;

  const text = await callClaude({ user: content, maxTokens: 1000 });
  return { text, output_type, matched_academics: matches.academics.length, matched_courses: matches.courses.length };
}

module.exports = { draft, OUTPUT_INSTRUCTIONS };
