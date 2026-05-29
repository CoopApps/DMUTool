'use strict';

/**
 * Weekly briefing — Claude synthesises the week's relevant parliamentary and
 * policy activity into a short narrative for the VC / SLT. Draws only on items
 * that passed the relevance gate (or are unscored), so it reflects signal, not
 * raw volume. Can be generated on demand (/api/briefing) or emailed weekly.
 */

const { all, get } = require('../db/database');
const claude = require('./claude');

function dmuContextBlock() {
  return all('SELECT value FROM dmu_context WHERE key != ?', ['new_events_count'])
    .map((r) => `- ${r.value}`).join('\n');
}

const RELEVANT = `(relevance_checked = 0 OR relevance_level IN ('high','medium'))`;

/** Collect the week's relevant items, grouped, for the prompt. */
function gather() {
  const parliamentary = all(
    `SELECT source, keyword_group, title, member_name, date FROM parliamentary_items
     WHERE date >= date('now','-7 days') ORDER BY keyword_group, date DESC LIMIT 60`
  );
  const inquiries = all(
    `SELECT committee_name, inquiry_title, working_days_remaining, relevance_level FROM committee_inquiries
     WHERE evidence_status='AcceptingEvidence' AND ${RELEVANT}
       AND (COALESCE(date_opened, created_at) >= date('now','-7 days')
            OR working_days_remaining BETWEEN 0 AND 15)
     ORDER BY working_days_remaining ASC LIMIT 20`
  );
  const consultations = all(
    `SELECT organisation, title, working_days_remaining FROM consultations
     WHERE ${RELEVANT} AND (deadline IS NULL OR date(deadline) >= date('now'))
       AND (is_new = 1 OR working_days_remaining BETWEEN 0 AND 15)
     ORDER BY working_days_remaining ASC LIMIT 20`
  );
  const thinktanks = all(
    `SELECT source_name, title, relevance_level FROM external_items
     WHERE source_type='think_tank' AND created_at >= datetime('now','-7 days')
       AND relevance_level IN ('high','medium')
     ORDER BY relevance_score DESC LIMIT 15`
  );
  return { parliamentary, inquiries, consultations, thinktanks };
}

function buildPrompt(data) {
  const fmt = (arr, f) => arr.length ? arr.map(f).join('\n') : '(none)';
  return `You are the Senior Public Affairs Officer's analyst at De Montfort University (DMU), Leicester.\n\n` +
    `DMU context:\n${dmuContextBlock()}\n\n` +
    `Write a concise weekly intelligence briefing ("This week in Parliament for DMU") for the Vice-Chancellor and senior leadership. ` +
    `Be analytical, not a list: lead with what matters most for DMU, group by theme, flag time-sensitive response opportunities (deadlines), ` +
    `and name relevant DMU expertise where obvious. Professional, direct, evidence-grounded, not promotional. ~350-450 words. ` +
    `End with a short "Recommended actions this week" list.\n\n` +
    `=== Parliamentary activity (last 7 days) ===\n${fmt(data.parliamentary, (i) => `- [${i.source}/${i.keyword_group}] ${i.title}${i.member_name ? ' — ' + i.member_name : ''}`)}\n\n` +
    `=== Committee inquiries (open / closing soon) ===\n${fmt(data.inquiries, (i) => `- ${i.committee_name}: ${i.inquiry_title} (${i.working_days_remaining ?? '?'} working days left)`)}\n\n` +
    `=== Government consultations (open / closing soon) ===\n${fmt(data.consultations, (c) => `- ${c.organisation || 'GOV.UK'}: ${c.title} (${c.working_days_remaining ?? '?'} working days left)`)}\n\n` +
    `=== Think-tank reports (relevant, this week) ===\n${fmt(data.thinktanks, (t) => `- ${t.source_name}: ${t.title}`)}\n`;
}

/** Generate the briefing text. Throws if Claude unconfigured. */
async function generate() {
  if (!claude.isConfigured()) throw new Error('ANTHROPIC_API_KEY not set — briefing disabled.');
  const data = gather();
  const text = await claude.callClaude({ user: buildPrompt(data), maxTokens: 1500 });
  const counts = {
    parliamentary: data.parliamentary.length, inquiries: data.inquiries.length,
    consultations: data.consultations.length, thinktanks: data.thinktanks.length,
  };
  return { text, counts };
}

/** Generate and email the weekly briefing (scheduler / Admin). */
async function sendWeekly() {
  const { logFetch } = require('../db/database');
  const started_at = new Date().toISOString();
  const email = require('./email');
  if (!claude.isConfigured() || !email.isConfigured()) {
    logFetch({ source: 'briefing', started_at, completed_at: new Date().toISOString(),
      items_fetched: 0, items_new: 0, error: 'Claude or SMTP not configured — weekly briefing skipped.' });
    return { sent: false, skipped: true };
  }
  try {
    const { text } = await generate();
    const html = `<div style="font-family:Arial,sans-serif;max-width:680px;white-space:pre-wrap;color:#1c2333">` +
      `<h1 style="color:#0a1f44;font-size:20px">DMU — Weekly Parliamentary Briefing</h1>` +
      `${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
    await email.sendMail({ subject: `DMU Weekly Parliamentary Briefing — ${new Date().toLocaleDateString('en-GB')}`, html });
    logFetch({ source: 'briefing', started_at, completed_at: new Date().toISOString(), items_fetched: 1, items_new: 1, error: null });
    return { sent: true };
  } catch (e) {
    logFetch({ source: 'briefing', started_at, completed_at: new Date().toISOString(), items_fetched: 0, items_new: 0, error: e.message });
    return { sent: false, error: e.message };
  }
}

module.exports = { generate, sendWeekly, gather };
