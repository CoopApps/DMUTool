'use strict';

/**
 * Semantic matching via Voyage AI embeddings. Embeds each academic profile and
 * each item into a vector; matching is then cosine similarity (meaning, not word
 * overlap) — so "serious youth violence" finds the knife-crime experts.
 *
 * Embeddings are computed in batches (scripts/embed.js) and stored as BLOBs;
 * match time is pure local cosine — no API calls, fast and free. Requires
 * VOYAGE_API_KEY; everything degrades gracefully when it's absent.
 */

const { fetch, sleep } = require('../lib/http');
const { db, all, get, run } = require('../db/database');

const API = 'https://api.voyageai.com/v1/embeddings';
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3.5-lite';
const BATCH = parseInt(process.env.VOYAGE_BATCH || '64', 10);     // free tier: set ~8
const DELAY = parseInt(process.env.VOYAGE_DELAY_MS || '0', 10);   // free tier: set ~21000 (3 req/min)

const ITEM_TABLES = {
  parliamentary_item: { table: 'parliamentary_items', text: "title || ' ' || COALESCE(full_text, snippet, '')" },
  committee_inquiry: { table: 'committee_inquiries', text: "inquiry_title || ' ' || COALESCE(summary,'')" },
  consultation: { table: 'consultations', text: "title || ' ' || COALESCE(summary,'')" },
  external_item: { table: 'external_items', text: "title || ' ' || COALESCE(summary,'')" },
};

function isConfigured() { return !!process.env.VOYAGE_API_KEY; }

const clip = (t, n = 1600) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Embed an array of texts. Retries on 429 (rate limit) with backoff. */
async function embedBatch(texts, inputType, attempt = 0) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (res.status === 429 && attempt < 6) {
    const wait = Math.min(60000, 20000 * Math.pow(1.5, attempt));
    console.log(`  rate-limited (429) — waiting ${Math.round(wait / 1000)}s…`);
    await sleep(wait);
    return embedBatch(texts, inputType, attempt + 1);
  }
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const vecToBuf = (vec) => { const f = Float32Array.from(vec); return Buffer.from(f.buffer, f.byteOffset, f.byteLength); };
const bufToVec = (buf) => new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function academicText(a) {
  let pubs = '';
  try { pubs = (JSON.parse(a.publications_json || '[]') || []).slice(0, 20)
    .map((p) => (typeof p === 'string' ? p : p.title || '')).join('. '); } catch { /* ignore */ }
  return clip([a.name, a.title, a.department, a.faculty, a.profile_text, pubs].filter(Boolean).join('. '));
}

/** Embed all academics that don't yet have a vector. Returns count embedded. */
async function embedAcademics() {
  const rows = all(`SELECT id, name, title, department, faculty, profile_text, publications_json
                    FROM academics WHERE embedding IS NULL`);
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vecs = await embedBatch(chunk.map(academicText), 'document');
    const upd = db.prepare('UPDATE academics SET embedding = ? WHERE id = ?');
    const tx = db.transaction(() => chunk.forEach((r, j) => upd.run(vecToBuf(vecs[j]), r.id)));
    tx();
    done += chunk.length;
    console.log(`  academics embedded ${done}/${rows.length}`);
    if (DELAY) await sleep(DELAY);
  }
  return done;
}

/** Embed items in a table that don't yet have a vector. */
async function embedItems(itemType) {
  const map = ITEM_TABLES[itemType];
  const rows = all(`SELECT id, ${map.text} AS txt FROM ${map.table} WHERE embedding IS NULL`);
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vecs = await embedBatch(chunk.map((r) => clip(r.txt)), 'query');
    const upd = db.prepare(`UPDATE ${map.table} SET embedding = ? WHERE id = ?`);
    const tx = db.transaction(() => chunk.forEach((r, j) => upd.run(vecToBuf(vecs[j]), r.id)));
    tx();
    done += chunk.length;
    if (done % 256 === 0 || done === rows.length) console.log(`  ${itemType} embedded ${done}/${rows.length}`);
    if (DELAY) await sleep(DELAY);
  }
  return done;
}

/** In-memory academic vector cache (rebuilt when academics change). */
let _cache = null;
function academicVectors() {
  if (_cache) return _cache;
  _cache = all('SELECT id, embedding FROM academics WHERE embedding IS NOT NULL')
    .map((r) => ({ id: r.id, vec: bufToVec(r.embedding) }));
  return _cache;
}
function clearCache() { _cache = null; }

/** Store the top-N semantic matches for one item (from its stored embedding). */
function matchItemEmbeddings(itemId, itemType, topN = 8) {
  const map = ITEM_TABLES[itemType];
  if (!map) return [];
  const row = get(`SELECT embedding FROM ${map.table} WHERE id = ?`, [itemId]);
  if (!row || !row.embedding) return [];
  const itemVec = bufToVec(row.embedding);
  const scored = academicVectors()
    .map((a) => ({ academic_id: a.id, sim: cosine(itemVec, a.vec) }))
    .sort((x, y) => y.sim - x.sim)
    .slice(0, topN);

  run("DELETE FROM academic_matches WHERE item_id=? AND item_type=? AND match_type='embedding'", [itemId, itemType]);
  const ins = db.prepare(`INSERT OR REPLACE INTO academic_matches
    (item_id, item_type, academic_id, score, match_type, explanation)
    VALUES (?,?,?,?, 'embedding', ?)`);
  for (const m of scored) {
    ins.run(itemId, itemType, m.academic_id, +(m.sim * 10).toFixed(3),
      `Semantic match (similarity ${(m.sim * 100).toFixed(0)}%).`);
  }
  return scored;
}

module.exports = {
  isConfigured, embedAcademics, embedItems, matchItemEmbeddings,
  academicVectors, clearCache, cosine, ITEM_TABLES,
};
