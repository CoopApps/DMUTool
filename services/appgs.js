'use strict';

/**
 * APPG register scraper. The Register of All-Party Parliamentary Groups has no
 * API — it's a published web register. We fetch the index, keyword-match group
 * names (most APPG relevance is clear from the name), and only fetch the detail
 * pages for matched groups to extract their purpose and officer MPs. That keeps
 * it polite and relevance-first.
 *
 * The register's HTML/URL changes periodically; INDEX URL and selectors are
 * configurable and the parser is defensive. Tune APPG_REGISTER_URL on first run.
 */

const cheerio = require('cheerio');
const { getText, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { normName } = require('../lib/names');
const { db, all, get, run, logFetch } = require('../db/database');

const INDEX_URL = process.env.APPG_REGISTER_URL ||
  'https://publications.parliament.uk/pa/cm/cmallparty/register/contents.htm';

function abs(href, base) {
  try { return new URL(href, base).toString(); } catch { return href; }
}
function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

/** Parse the index into [{ name, url }] — anchors that look like group names. */
function parseIndex(html, base) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const name = clean($(a).text());
    const href = $(a).attr('href');
    if (!name || name.length < 5 || !href) return;
    // Heuristic: APPG entries mention a group, or the link sits in the register body.
    if (!/group|all-party|appg/i.test(name) && !/register|appg|allparty/i.test(href)) return;
    const url = abs(href, base);
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, url });
  });
  return out;
}

/** Extract purpose + officer names from a group's detail page (best effort). */
function parseDetail(html) {
  const $ = cheerio.load(html);
  const bodyText = clean($('body').text());

  let purpose = '';
  const pm = bodyText.match(/Purpose[:\s]+(.+?)(?:Officers|Chair|Registrable benefits|Secretariat|Contact|$)/i);
  if (pm) purpose = clean(pm[1]).slice(0, 600);

  // Officer names: capture the block after an "Officers" heading.
  const officers = [];
  $('h1,h2,h3,h4,strong,th,td').each((_, el) => {
    if (/officers/i.test($(el).text())) {
      const container = $(el).closest('table').length ? $(el).closest('table') : $(el).parent();
      container.find('li, td, p').each((__, li) => {
        const line = clean($(li).text());
        // Lines that look like "Chair: Jane Smith MP" or "Jane Smith (Labour)".
        const m = line.match(/(?:chair|co-chair|vice-chair|secretary|treasurer)[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i);
        if (m) officers.push(clean(m[1]));
      });
    }
  });
  return { purpose, officers: [...new Set(officers)].slice(0, 12) };
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, matchedCount = 0, error = null;

  try {
    const idx = await getText(INDEX_URL);
    if (!idx.ok) throw new Error(`register index -> ${idx.status}`);
    const groups = parseIndex(idx.text, INDEX_URL);
    fetched = groups.length;

    for (const g of groups) {
      const { primary, groups: matchedGroups } = matchText(g.name);
      const matched = matchedGroups.length > 0 ? 1 : 0;

      const existing = get('SELECT id, matched FROM appgs WHERE name = ?', [g.name]);
      let id;
      if (existing) {
        run('UPDATE appgs SET url=?, keyword_group=?, matched=? WHERE id=?', [g.url, primary, matched, existing.id]);
        id = existing.id;
      } else {
        id = run('INSERT INTO appgs (name, url, keyword_group, matched) VALUES (?,?,?,?)',
          [g.name, g.url, primary, matched]).lastInsertRowid;
      }

      // Only fetch detail pages for relevant groups — polite + relevance-first.
      if (matched) {
        matchedCount += 1;
        try {
          const d = await getText(g.url);
          if (d.ok) {
            const { purpose, officers } = parseDetail(d.text);
            run(`UPDATE appgs SET purpose=?, officers_json=?, last_scraped=datetime('now') WHERE id=?`,
              [purpose, JSON.stringify(officers), id]);
          }
        } catch { /* leave detail empty */ }
        await sleep(2000); // crawl delay only on the (few) matched detail fetches
      }
    }
  } catch (e) {
    error = e.message;
  }

  logFetch({ source: 'appgs', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: matchedCount, error });
  return { fetched, matched: matchedCount, error };
}

/** Resolve officer names to MP rows where possible (for engagement links). */
function linkOfficers(officersJson) {
  let names = [];
  try { names = JSON.parse(officersJson || '[]'); } catch { return []; }
  return names.map((n) => {
    const parts = normName(n).split(' ').filter(Boolean);
    let mp = null;
    if (parts.length >= 2) {
      const first = parts[0], last = parts[parts.length - 1];
      mp = get(`SELECT id, first_name, last_name FROM mps
        WHERE lower(last_name) = ? AND lower(first_name) LIKE ? LIMIT 1`, [last, first + '%']);
    }
    return { name: n, mp };
  });
}

module.exports = { run: run_, parseIndex, parseDetail, linkOfficers };
