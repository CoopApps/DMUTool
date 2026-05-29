'use strict';

/**
 * Thin wrapper around the Claude API (Anthropic SDK) used by the semantic
 * matcher and the drafting panel. Reads ANTHROPIC_API_KEY from the environment.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — Claude features are disabled.');
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Single-turn call. Returns the concatenated text content.
 * @param {{system?:string, user:string, maxTokens?:number, model?:string}} opts
 */
async function callClaude({ system, user, maxTokens = 1000, model = MODEL }) {
  const resp = await client().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return resp.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

module.exports = { callClaude, isConfigured, MODEL };
