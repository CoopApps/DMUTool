'use strict';

/**
 * AI usage credits — what the tool's Claude-powered features are spending this
 * month, against a budget the officer sets. Read-only insight plus a budget
 * control; no AI calls happen here.
 */

const express = require('express');
const router = express.Router();
const usage = require('../services/usage');
const { layout, panel, esc } = require('../lib/render');

const FEATURE_LABELS = {
  draft: 'Drafting',
  briefing: 'Weekly briefing',
  relevance: 'Relevance triage',
  matcher: 'Academic matching',
  other: 'Other',
};
const money = (n) => '$' + (n || 0).toFixed(2);
const num = (n) => (n || 0).toLocaleString('en-GB');

router.get('/', (req, res) => {
  const s = usage.summary();
  const features = usage.byFeature();
  const recent = usage.recent(25);
  const trend = usage.monthlyTrend();

  const over = s.remaining < 0;
  const barCls = s.pct >= 100 ? 'red' : s.pct >= 80 ? 'amber' : 'green';

  // Budget meter
  const meter = `<div class="credit-meter">
    <div class="credit-figures">
      <div><span class="big ${over ? 'over' : ''}">${money(s.spend)}</span><span class="muted"> of ${money(s.budget)} this month</span></div>
      <div class="${over ? 'over' : 'muted'}">${over ? money(-s.remaining) + ' over budget' : money(s.remaining) + ' remaining'}</div>
    </div>
    <div class="credit-bar"><span class="${barCls}" style="width:${Math.min(100, s.pct).toFixed(1)}%"></span></div>
    <div class="muted small">${num(s.calls)} calls · ${num(s.inTok)} in / ${num(s.outTok)} out tokens · costs are estimates from list prices</div>
    <form class="inline" style="margin-top:10px" onsubmit="return DMU.saveBudget(event)">
      <label>Monthly budget (USD) <input name="budget" type="number" min="0" step="5" value="${s.budget}" style="width:90px"></label>
      <button>Save budget</button>
    </form>
  </div>`;

  // Per-feature breakdown
  const maxCost = Math.max(0.0001, ...features.map((f) => f.cost));
  const featRows = features.length ? features.map((f) => `<tr>
      <td>${esc(FEATURE_LABELS[f.feature] || f.feature)}</td>
      <td class="mini-bar"><span style="width:${((f.cost / maxCost) * 100).toFixed(0)}%"></span></td>
      <td class="r">${money(f.cost)}</td>
      <td class="r muted">${num(f.calls)}</td>
      <td class="r muted">${num(f.tokens)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No AI usage recorded this month yet.</td></tr>';
  const featTable = `<table><thead><tr><th>Feature</th><th></th><th class="r">Cost</th><th class="r">Calls</th><th class="r">Tokens</th></tr></thead><tbody>${featRows}</tbody></table>`;

  // Recent calls
  const recentRows = recent.length ? recent.map((r) => `<tr>
      <td class="muted small">${esc((r.ts || '').replace('T', ' ').slice(0, 16))}</td>
      <td>${esc(FEATURE_LABELS[r.feature] || r.feature || 'other')}</td>
      <td class="muted small">${esc((r.model || '').replace('claude-', ''))}</td>
      <td class="r muted">${num(r.input_tokens)}/${num(r.output_tokens)}</td>
      <td class="r">${money(r.cost_usd)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No calls yet.</td></tr>';
  const recentTable = `<table><thead><tr><th>When</th><th>Feature</th><th>Model</th><th class="r">Tok (in/out)</th><th class="r">Cost</th></tr></thead><tbody>${recentRows}</tbody></table>`;

  // Trend
  const trendRows = trend.map((t) => `<tr><td>${esc(t.month)}</td><td class="r">${money(t.cost)}</td><td class="r muted">${num(t.calls)} calls</td></tr>`).join('');
  const trendTable = trend.length > 1 ? `<table><thead><tr><th>Month</th><th class="r">Spend</th><th class="r">Calls</th></tr></thead><tbody>${trendRows}</tbody></table>` : '<p class="muted">Trend appears once there is more than one month of usage.</p>';

  const body = `<div class="dash-head"><h1>Usage credits</h1>
      <span class="sub">What the tool's AI features are spending this month</span>
      <span class="spacer"></span></div>
    <div class="dashgrid" style="grid-template-columns:1fr 1fr;">
      ${panel({ title: 'This month', pad: true, body: meter })}
      ${panel({ title: 'By feature', pad: true, body: featTable })}
    </div>
    <div class="dashgrid" style="grid-template-columns:1.5fr 1fr;">
      ${panel({ title: 'Recent calls', count: recent.length, pad: true, body: recentTable })}
      ${panel({ title: 'Monthly trend', pad: true, body: trendTable })}
    </div>`;
  res.send(layout({ title: 'Usage credits', body, active: '/usage', dashboard: true }));
});

module.exports = router;
