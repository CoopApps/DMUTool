'use strict';

/**
 * Background task-queue worker. Drains task_queue at a polite interval so the
 * intelligent work (contextual relevance scoring) happens out-of-band — by the
 * time the officer opens the digest in the morning, new high-signal items are
 * already triaged. Self-throttling; pauses cleanly when the Claude API is
 * unconfigured.
 */

const { db, all, get, run } = require('../db/database');
const relevance = require('../services/relevance');
const claude = require('./../services/claude');

const BATCH = parseInt(process.env.QUEUE_BATCH || '3', 10);        // tasks per tick
const INTERVAL_MS = parseInt(process.env.QUEUE_INTERVAL_MS || '20000', 10);
const MAX_ATTEMPTS = 3;

let timer = null;
let draining = false;

const HANDLERS = {
  relevance: (t) => relevance.scoreItem(t.item_type, t.item_id),
  // Conceptual expert matching via Claude, run in the background for relevant items.
  semantic: (t) => require('../services/matcher').semanticMatch(t.item_id, t.item_type),
};

async function drainOnce() {
  if (draining) return;
  draining = true;
  try {
    const tasks = all(
      `SELECT * FROM task_queue WHERE status='pending' AND attempts < ?
       ORDER BY priority ASC, id ASC LIMIT ?`, [MAX_ATTEMPTS, BATCH]
    );
    for (const t of tasks) {
      // If a task needs Claude but it isn't configured, degrade gracefully.
      if ((t.kind === 'relevance' || t.kind === 'semantic') && !claude.isConfigured()) {
        if (t.kind === 'relevance') relevance.markUnscored(t.item_type, t.item_id);
        run(`UPDATE task_queue SET status='done', processed_at=datetime('now'),
             error='claude not configured — skipped' WHERE id=?`, [t.id]);
        continue;
      }
      try {
        const handler = HANDLERS[t.kind];
        if (!handler) throw new Error(`no handler for kind ${t.kind}`);
        await handler(t);
        run(`UPDATE task_queue SET status='done', processed_at=datetime('now'), attempts=attempts+1 WHERE id=?`, [t.id]);
      } catch (e) {
        const attempts = t.attempts + 1;
        run(`UPDATE task_queue SET status=?, attempts=?, error=?, processed_at=datetime('now') WHERE id=?`,
          [attempts >= MAX_ATTEMPTS ? 'error' : 'pending', attempts, e.message, t.id]);
      }
    }
  } finally {
    draining = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { drainOnce().catch((e) => console.error('[queue]', e.message)); }, INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log(`[queue] background worker started (batch ${BATCH} / ${INTERVAL_MS}ms).`);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

/** Pending-task count, for Admin. */
function pending() {
  return get(`SELECT COUNT(*) c FROM task_queue WHERE status='pending'`).c;
}

module.exports = { start, stop, drainOnce, pending };
