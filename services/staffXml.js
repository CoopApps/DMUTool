'use strict';

/**
 * Academic data completeness (brief 3.2 + 3.4).
 *
 *  1. Staff XML feed cross-reference — fetch the full DMU academic-staff
 *     listing, and for any name NOT already in the academics table insert a
 *     stub (source='xml') carrying the profile URL. The publication scraper
 *     (contensis.enrichPublications) later fills in their profile text and
 *     publications, so staff missing from the Contensis API still get matched.
 *
 *  2. Legacy reconciliation — cross-reference academics_legacy (from the Access
 *     import) against the live academics by normalised name. Live Contensis
 *     data always takes precedence; only legacy people with no live match are
 *     inserted (source='legacy') so the expert finder still surfaces them.
 */

const cheerio = require('cheerio');
const RssParser = require('rss-parser');
const { getText, USER_AGENT } = require('../lib/http');
const { normName } = require('../lib/names');
const { db, all, get, run, logFetch } = require('../db/database');

const XML_URL = process.env.STAFF_XML_URL ||
  'https://www.dmu.ac.uk/about-dmu/academic-staff/full-listing-of-dmu-academic-staff.aspx?WhosWho_SyndicationType=1';

const rss = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });

/** Set of normalised names already present in the academics table. */
function existingNormNames() {
  const set = new Set();
  for (const r of all("SELECT norm_name FROM academics WHERE norm_name IS NOT NULL AND norm_name != ''")) {
    set.add(r.norm_name);
  }
  return set;
}

/** Parse the staff feed into [{ name, url }]. Tries RSS first, then generic XML. */
async function parseFeed(text) {
  // Attempt RSS/Atom (title + link).
  try {
    const feed = await rss.parseString(text);
    if (feed.items && feed.items.length) {
      return feed.items.map(parseItem).filter((x) => x.name);
    }
  } catch { /* not RSS — fall through */ }

  // Generic XML: try common repeating element names.
  const $ = cheerio.load(text, { xmlMode: true });
  const out = [];
  for (const sel of ['item', 'staff', 'person', 'entry', 'record', 'member']) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const name = ($el.find('name, fullname, title, displayname').first().text() || $el.attr('name') || '').trim();
      const url = ($el.find('url, link, profileurl, profile').first().text()
        || $el.find('link').attr('href') || $el.attr('url') || '').trim() || null;
      if (name) out.push({ name, url, title: null, faculty: null, summary: '' });
    });
    if (out.length) break;
  }
  return out;
}

/** Prettify a URL faculty slug, e.g. "art-design-humanities" -> "Art Design Humanities". */
function facultyFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    const i = seg.indexOf('academic-staff');
    const slug = i >= 0 ? seg[i + 1] : null;
    return slug ? slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
  } catch { return null; }
}

/** Extract { name, title, faculty, url, summary } from a feed item.
 *  description looks like "Full Name, Role at De Montfort University (DMU), Leicester, UK". */
function parseItem(it) {
  const desc = (it.contentSnippet || it.content || it.summary || '').replace(/\s+/g, ' ').trim();
  const name = (desc.split(',')[0] || '').trim() || (it.title || '').trim();
  const m = desc.match(/,\s*(.+?)\s+at De Montfort/i);
  const title = m ? m[1].trim() : null;
  return { name, title, faculty: facultyFromUrl(it.link), url: it.link || null, summary: desc };
}

/** Step 1 — cross-reference the XML staff listing (name, role, faculty from the feed). */
async function crossReferenceXml() {
  const { ok, status, text } = await getText(XML_URL, { headers: { Accept: 'application/xml,text/xml' } });
  if (!ok) return { fetched: 0, created: 0, error: `staff XML feed -> ${status}` };

  const people = await parseFeed(text);
  const existing = existingNormNames();
  let created = 0;
  const ins = db.prepare(`INSERT INTO academics (name, title, department, faculty, profile_url, profile_text, norm_name, source)
    VALUES (?,?,?,?,?,?,?, 'xml')`);
  const tx = db.transaction(() => {
    for (const p of people) {
      const nn = normName(p.name);
      if (!nn || existing.has(nn)) continue;   // already known from Contensis
      // faculty doubles as a weak department signal until profile pages are scraped.
      ins.run(p.name, p.title, p.faculty, p.faculty, p.url, p.summary || null, nn);
      existing.add(nn);
      created += 1;
    }
  });
  tx();
  return { fetched: people.length, created, error: people.length ? null : 'no staff parsed from feed' };
}

/** Step 2 — reconcile legacy academics; insert only those with no live match. */
function reconcileLegacy() {
  const existing = existingNormNames();
  const legacy = all('SELECT * FROM academics_legacy');
  let created = 0;
  const ins = db.prepare(`INSERT INTO academics
    (name, title, department, email, phone, profile_url, profile_text, norm_name, source)
    VALUES (?,?,?,?,?,?,?,?, 'legacy')`);
  const tx = db.transaction(() => {
    for (const r of legacy) {
      const nn = r.norm_name || normName(r.name);
      if (!nn || existing.has(nn)) continue;   // live data takes precedence
      const profileText = [r.interest_a, r.interest_b, r.interest_c].filter(Boolean).join('. ');
      ins.run(r.name, r.title, r.department, r.email, r.phone, r.profile_url, profileText, nn);
      existing.add(nn);
      created += 1;
    }
  });
  tx();
  return { fetched: legacy.length, created };
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const xml = await crossReferenceXml();
    fetched += xml.fetched; created += xml.created;
    if (xml.error) error = xml.error;
  } catch (e) { error = (error ? error + '; ' : '') + `xml: ${e.message}`; }

  try {
    const leg = reconcileLegacy();
    fetched += leg.fetched; created += leg.created;
  } catch (e) { error = (error ? error + '; ' : '') + `legacy: ${e.message}`; }

  logFetch({ source: 'staffXml', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, crossReferenceXml, reconcileLegacy, parseFeed };
