'use strict';

/**
 * Thin wrapper around the Claude API (Anthropic SDK) used by the semantic
 * matcher and the drafting panel. Reads ANTHROPIC_API_KEY from the environment.
 */

const Anthropic = require('@anthropic-ai/sdk');

// Quality model for drafting / expert reasoning.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
// Cheaper, fast model for high-volume triage (relevance gate). ~10x cheaper.
const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5-20251001';

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — Claude features are disabled.');
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Single-turn call. Returns the concatenated text content. The `feature` label
 * is recorded against usage metering so spend can be attributed (draft,
 * briefing, relevance, matcher, …).
 * @param {{system?:string, user:string, maxTokens?:number, model?:string, feature?:string}} opts
 */
async function callClaude({ system, user, maxTokens = 1000, model = MODEL, feature = 'other' }) {
  const resp = await client().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  // Best-effort usage metering — never let it break the call. Required lazily
  // to avoid a circular dependency (usage → database, not the SDK).
  try {
    const u = resp.usage || {};
    require('./usage').record({
      feature, model,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
    });
  } catch (_) { /* metering is non-critical */ }
  return resp.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

module.exports = { callClaude, isConfigured, MODEL, FAST_MODEL };
