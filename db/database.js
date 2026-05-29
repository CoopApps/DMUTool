'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dmu.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialise the schema from schema.sql if it has not been applied yet.
 * Also (re)builds the FTS5 virtual table used by the academic expert finder.
 */
function init() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // FTS5 full-text index over academics for the expert finder.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS academics_fts USING fts5(
      name, title, department, profile_text, publications,
      content='academics', content_rowid='id'
    );
  `);

  // Triggers to keep the FTS index in sync with the academics table.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS academics_ai AFTER INSERT ON academics BEGIN
      INSERT INTO academics_fts(rowid, name, title, department, profile_text, publications)
      VALUES (new.id, new.name, new.title, new.department, new.profile_text, new.publications_json);
    END;
    CREATE TRIGGER IF NOT EXISTS academics_ad AFTER DELETE ON academics BEGIN
      INSERT INTO academics_fts(academics_fts, rowid, name, title, department, profile_text, publications)
      VALUES ('delete', old.id, old.name, old.title, old.department, old.profile_text, old.publications_json);
    END;
    CREATE TRIGGER IF NOT EXISTS academics_au AFTER UPDATE ON academics BEGIN
      INSERT INTO academics_fts(academics_fts, rowid, name, title, department, profile_text, publications)
      VALUES ('delete', old.id, old.name, old.title, old.department, old.profile_text, old.publications_json);
      INSERT INTO academics_fts(rowid, name, title, department, profile_text, publications)
      VALUES (new.id, new.name, new.title, new.department, new.profile_text, new.publications_json);
    END;
  `);
}

// ---- Generic helpers -------------------------------------------------------

const get = (sql, params = []) => db.prepare(sql).get(params);
const all = (sql, params = []) => db.prepare(sql).all(params);
const run = (sql, params = []) => db.prepare(sql).run(params);

/** Write a fetch_log entry. Returns the row id. */
function logFetch({ source, started_at, completed_at, items_fetched = 0, items_new = 0, error = null }) {
  return run(
    `INSERT INTO fetch_log (source, started_at, completed_at, items_fetched, items_new, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [source, started_at, completed_at, items_fetched, items_new, error]
  ).lastInsertRowid;
}

/** Read a single dmu_context value by key. */
function getContext(key) {
  const row = get('SELECT value FROM dmu_context WHERE key = ?', [key]);
  return row ? row.value : null;
}

/** Upsert a dmu_context key/value pair. */
function setContext(key, value) {
  run(
    `INSERT INTO dmu_context (key, value, last_updated) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, last_updated = datetime('now')`,
    [key, String(value)]
  );
}

/**
 * Expire the "New" flag on items older than 24 hours. Parliamentary items and
 * diary events age on created_at; committee inquiries and consultations age on
 * when they opened (the brief defines "new" = opened in the last 24h).
 * Cheap, idempotent — safe to call on each relevant page load.
 */
function ageNewFlags() {
  run(`UPDATE parliamentary_items SET is_new = 0 WHERE is_new = 1 AND created_at < datetime('now','-1 day')`);
  run(`UPDATE diary_events SET is_new = 0 WHERE is_new = 1 AND created_at < datetime('now','-1 day')`);
  run(`UPDATE committee_inquiries SET is_new = 0 WHERE is_new = 1 AND
       COALESCE(date_opened, created_at) < datetime('now','-1 day')`);
  run(`UPDATE consultations SET is_new = 0 WHERE is_new = 1 AND
       COALESCE(opened, created_at) < datetime('now','-1 day')`);
}

module.exports = { db, init, get, all, run, logFetch, getContext, setContext, ageNewFlags, DB_PATH };
