'use strict';

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db/database');
const matcher = require('../services/matcher');
const draftSvc = require('../services/draft');
const { isConfigured } = require('../services/claude');

const asyncH = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('API error:', e.message);
  res.status(500).json({ error: e.message });
});

// ---- Drafting --------------------------------------------------------------
router.post('/draft', asyncH(async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set — drafting disabled.' });
  const { item_id, item_type, output_type, mp_id } = req.body;
  const result = await draftSvc.draft({ item_id, item_type, output_type, mp_id });
  // Persist each generation as a new version in the drafts history.
  const title = draftSvc.itemTitle(item_type, item_id);
  const info = run(`INSERT INTO drafts (item_type, item_id, output_type, mp_id, item_title, content, status)
    VALUES (?,?,?,?,?,?, 'generated')`,
    [item_type, item_id, output_type, mp_id || null, title, result.text]);
  res.json({ ...result, draft_id: info.lastInsertRowid });
}));

// ---- Draft history -----------------------------------------------------------
router.put('/drafts/:id', (req, res) => {
  const { content, status } = req.body;
  const fields = [], params = [];
  if (content != null) { fields.push('content=?'); params.push(content); }
  if (status != null) { fields.push('status=?'); params.push(status); }
  if (!fields.length) return res.json({ ok: true });
  fields.push("updated_at=datetime('now')");
  params.push(req.params.id);
  run(`UPDATE drafts SET ${fields.join(', ')} WHERE id=?`, params);
  res.json({ ok: true });
});

router.delete('/drafts/:id', (req, res) => {
  run('DELETE FROM drafts WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

router.get('/drafts/:id/export.docx', asyncH(async (req, res) => {
  const draft = get('SELECT * FROM drafts WHERE id=?', [req.params.id]);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  const { buildDocx, fileName } = require('../services/docxExport');
  const buffer = await buildDocx(draft);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(draft)}"`);
  res.send(buffer);
}));

// ---- Weekly briefing (on demand) -------------------------------------------
router.post('/briefing', asyncH(async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set — briefing disabled.' });
  const result = await require('../services/briefing').generate();
  res.json(result);
}));

// ---- Tier 2 semantic matching ----------------------------------------------
router.post('/match/semantic', asyncH(async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set — semantic matching disabled.' });
  const { item_id, item_type } = req.body;
  const result = await matcher.semanticMatch(item_id, item_type);
  res.json(result);
}));

// ---- Tier 1 keyword matches (read) -----------------------------------------
router.get('/match/:type/:id', (req, res) => {
  res.json(matcher.getMatches(parseInt(req.params.id, 10), req.params.type));
});

// ---- Committee submission tracker ------------------------------------------
router.post('/committees/:id/submission', (req, res) => {
  const { submitted, contributors, submission_url } = req.body;
  run(`UPDATE committee_inquiries SET submitted=?, contributors=?, submission_url=? WHERE id=?`,
    [submitted ? 1 : 0, contributors || null, submission_url || null, req.params.id]);
  res.json({ ok: true });
});

// ---- Consultation response tracker -----------------------------------------
router.post('/consultations/:id/submission', (req, res) => {
  const { submitted, contributors, submission_url } = req.body;
  run(`UPDATE consultations SET submitted=?, contributors=?, submission_url=? WHERE id=?`,
    [submitted ? 1 : 0, contributors || null, submission_url || null, req.params.id]);
  res.json({ ok: true });
});

// ---- Engagement: clear a follow-up flag ------------------------------------
router.post('/engagement/:logId/done', (req, res) => {
  run('UPDATE engagement_log SET followup = 0 WHERE id = ?', [req.params.logId]);
  res.json({ ok: true });
});

// ---- Engagement: export the target list as CSV -----------------------------
router.get('/engagement/targets.csv', (req, res) => {
  const { targetList } = require('./engagement');
  const rows = targetList(req.query.group || '');
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = ['First name', 'Last name', 'Party', 'Constituency', 'Email', 'Relevant activity (90d)'];
  const lines = [header.map(esc).join(',')];
  for (const m of rows) {
    lines.push([m.first_name, m.last_name, m.party, m.constituency, m.email, m.activity].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="dmu-target-mps${req.query.group ? '-' + req.query.group.replace(/\W+/g, '-') : ''}.csv"`);
  res.send(lines.join('\r\n'));
});

// ---- MP contact logging ----------------------------------------------------
router.post('/mps/:id/log', (req, res) => {
  const { date, type, description, notes, followup } = req.body;
  run(`INSERT INTO engagement_log (mp_id, date, type, description, notes, followup)
       VALUES (?,?,?,?,?,?)`,
    [req.params.id, date || new Date().toISOString(), type, description, notes, followup ? 1 : 0]);
  res.json({ ok: true });
});

// ---- Academic search (API form) --------------------------------------------
router.post('/academics/search', (req, res) => {
  const q = (req.body.q || '').trim();
  if (!q) return res.json({ results: [] });
  const like = `%${q}%`;
  const results = all(
    `SELECT id, name, title, department, email, phone, profile_url
     FROM academics WHERE name LIKE ? OR department LIKE ? OR profile_text LIKE ? LIMIT 20`,
    [like, like, like]
  );
  res.json({ results });
});

// ---- Admin: keyword groups -------------------------------------------------
router.post('/admin/groups', (req, res) => {
  const { name, keywords } = req.body;
  run(`INSERT INTO keyword_groups (name, keywords) VALUES (?,?)
       ON CONFLICT(name) DO UPDATE SET keywords=excluded.keywords`, [name, keywords || '']);
  res.json({ ok: true });
});
router.put('/admin/groups/:id', (req, res) => {
  run('UPDATE keyword_groups SET keywords=? WHERE id=?', [req.body.keywords || '', req.params.id]);
  res.json({ ok: true });
});
router.delete('/admin/groups/:id', (req, res) => {
  run('DELETE FROM keyword_groups WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---- Admin: professional bodies --------------------------------------------
router.put('/admin/bodies/:id', (req, res) => {
  run('UPDATE professional_bodies SET departments_json=?, scrape_selectors=? WHERE id=?',
    [req.body.departments_json || null, req.body.scrape_selectors || null, req.params.id]);
  res.json({ ok: true });
});

// ---- Admin: dmu context ----------------------------------------------------
router.post('/admin/context', (req, res) => {
  const { key, value } = req.body;
  run(`INSERT INTO dmu_context (key, value, last_updated) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, last_updated=datetime('now')`, [key, value || '']);
  res.json({ ok: true });
});

// ---- Admin: manual source run ----------------------------------------------
const SOURCE_RUNNERS = {
  hansard: () => require('../services/hansard').run(),
  writtenQuestions: () => require('../services/writtenQuestions').run(),
  committees: () => require('../services/committees').run(),
  whatson: () => require('../services/whatson').run(),
  feeds: () => require('../services/feeds').run(),
  guardian: () => require('../services/guardian').run(),
  govuk: () => require('../services/govuk').run(),
  email: () => require('../services/email').sendDigest(),
  mpRefresh: () => require('../services/mpProfile').refreshAll(),
  staffXml: () => require('../services/staffXml').run(),
  dmuEvents: () => require('../services/contensis').crawl({ mode: 'events-only' }),
  thinktanks: () => require('../services/thinktanks').run(),
  briefing: () => require('../services/briefing').sendWeekly(),
  bills: () => require('../services/secondary').bills(),
  petitions: () => require('../services/secondary').petitions(),
  legislation: () => require('../services/secondary').legislation(),
  edms: () => require('../services/secondary').edms(),
  oralQuestions: () => require('../services/secondary').oralQuestions(),
  contensis: () => require('../services/contensis').crawl({ mode: 'full' }),
};
router.post('/admin/run/:source', asyncH(async (req, res) => {
  const runner = SOURCE_RUNNERS[req.params.source];
  if (!runner) return res.status(404).json({ error: 'Unknown source' });
  const result = await runner();
  res.json({ ok: true, result });
}));

module.exports = router;
