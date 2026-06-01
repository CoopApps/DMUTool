'use strict';

/**
 * AI usage metering — "Claude credits". Every Claude API call is recorded with
 * its token counts and an estimated USD cost, so the officer can see what the
 * tool's AI features (drafting, briefings, triage) are consuming and track it
 * against a monthly budget. Recording is best-effort: a metering failure must
 * never break the underlying feature.
 */

const { all, get, run } = require('../db/database');

// Approximate list prices in USD per 1M tokens. These are estimates for
// budgeting only — adjust if Anthropic pricing changes. Matched by substring
// so dated model IDs (e.g. claude-sonnet-4-20250514) resolve correctly.
const PRICING = [
  [/opus/i,   { in: 15, out: 75 }],
  [/sonnet/i, { in: 3,  out: 15 }],
  [/haiku/i,  { in: 1,  out: 5  }],
];
const FALLBACK = { in: 3, out: 15 };

function priceFor(model) {
  const hit = PRICING.find(([re]) => re.test(model || ''));
  return hit ? hit[1] : FALLBACK;
}

function costUsd(model, inTok, outTok) {
  const p = priceFor(model);
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

/** Record a single call. Swallows errors so it can never break a feature. */
function record({ feature = 'other', model, input_tokens = 0, output_tokens = 0 }) {
  try {
    const cost = costUsd(model, input_tokens, output_tokens);
    run(`INSERT INTO ai_usage (feature, model, input_tokens, output_tokens, cost_usd)
         VALUES (?,?,?,?,?)`, [feature, model, input_tokens, output_tokens, cost]);
    return cost;
  } catch (_) { return 0; }
}

// ---- Settings ---------------------------------------------------------------
const DEFAULT_BUDGET = 50; // USD/month, until the officer sets their own.

function getBudget() {
  const row = get(`SELECT value FROM app_settings WHERE key='ai_monthly_budget'`);
  const n = row ? parseFloat(row.value) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_BUDGET;
}
function setBudget(usd) {
  const n = Math.max(0, parseFloat(usd) || 0);
  run(`INSERT INTO app_settings (key, value) VALUES ('ai_monthly_budget', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(n)]);
  return n;
}

// ---- Reporting --------------------------------------------------------------
// Current calendar month, used for the budget window.
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function summary() {
  const since = monthStart();
  const m = get(`SELECT COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost,
      COALESCE(SUM(input_tokens),0) inTok, COALESCE(SUM(output_tokens),0) outTok
      FROM ai_usage WHERE ts >= ?`, [since]);
  const budget = getBudget();
  return {
    budget,
    spend: m.cost,
    remaining: budget - m.cost,
    pct: budget > 0 ? Math.min(100, (m.cost / budget) * 100) : 0,
    calls: m.calls,
    inTok: m.inTok,
    outTok: m.outTok,
  };
}

function byFeature() {
  return all(`SELECT feature, COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost,
      COALESCE(SUM(input_tokens+output_tokens),0) tokens
      FROM ai_usage WHERE ts >= ? GROUP BY feature ORDER BY cost DESC`, [monthStart()]);
}

function recent(limit = 20) {
  return all(`SELECT * FROM ai_usage ORDER BY id DESC LIMIT ?`, [limit]);
}

// Last 6 months of total spend, for a simple trend.
function monthlyTrend() {
  return all(`SELECT substr(ts,1,7) month, COALESCE(SUM(cost_usd),0) cost, COUNT(*) calls
      FROM ai_usage GROUP BY month ORDER BY month DESC LIMIT 6`);
}

module.exports = { record, costUsd, getBudget, setBudget, summary, byFeature, recent, monthlyTrend };
