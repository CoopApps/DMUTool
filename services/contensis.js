'use strict';

/**
 * Contensis delivery API crawler. Discovers content types, then crawls
 * academic profiles, news, courses, research projects and SDG pages,
 * upserting into the relevant SQLite tables. Profile pages are optionally
 * scraped to enrich publication lists (1 request / 2s).
 *
 * Credentials come from .env (CONTENSIS_*). Falls back to the published
 * delivery credentials from the brief if the env vars are absent.
 */

const cheerio = require('cheerio');
const { getJson, getText, sleep } = require('../lib/http');
const { db, run, get, logFetch } = require('../db/database');

const ROOT = process.env.CONTENSIS_ROOT_URL || 'https://api-dmu.cloud.contensis.com';
const TOKEN = process.env.CONTENSIS_ACCESS_TOKEN || 'uGIVAIkICmZu3vz7B9rBgLu7S7OTWhusUQn1f4YgJNZ1kyon';
const PROJECT = process.env.CONTENSIS_PROJECT_ID || 'website';

const DELIVERY = `${ROOT}/api/delivery/projects/${PROJECT}`;

function authUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${DELIVERY}${path}${sep}accessToken=${TOKEN}`;
}

/** Discover and log all published content types. */
async function listContentTypes() {
  const data = await getJson(authUrl('/contentTypes?versionStatus=published&pageSize=100'));
  const items = data.items || data || [];
  return items.map((ct) => ({
    id: ct.id,
    name: (ct.entryTitleField && ct.name) || (ct.name && (ct.name['en-GB'] || ct.name)) || ct.id,
  }));
}

/** Page through all published entries of a content type. */
async function* entries(contentTypeId, pageSize = 100) {
  let pageIndex = 0;
  for (;;) {
    const path = `/entries?contentTypeId=${encodeURIComponent(contentTypeId)}` +
      `&versionStatus=published&pageIndex=${pageIndex}&pageSize=${pageSize}`;
    const data = await getJson(authUrl(path));
    const items = data.items || [];
    for (const e of items) yield e;
    const total = data.pageCount != null ? data.pageCount : Math.ceil((data.totalCount || 0) / pageSize);
    pageIndex += 1;
    if (!items.length || pageIndex >= total) break;
    await sleep(300);
  }
}

const field = (e, ...names) => {
  for (const n of names) {
    if (e[n] != null) {
      const v = e[n];
      if (typeof v === 'object' && v['en-GB'] != null) return v['en-GB'];
      return v;
    }
  }
  return null;
};

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join(' ');
  if (typeof v === 'object') return Object.values(v).map(textOf).join(' ');
  return String(v);
}

// ---- Upserts ---------------------------------------------------------------

function upsertAcademic(e) {
  const cid = e.sys && e.sys.id;
  const name = field(e, 'name', 'fullName', 'title', 'staffName');
  const department = field(e, 'department', 'school', 'subjectArea');
  const profile = textOf(field(e, 'profile', 'biography', 'personalProfile', 'researchInterests'));
  const existing = get('SELECT id FROM academics WHERE contensis_id = ?', [cid]);
  const profileUrl = field(e, 'url', 'profileUrl');
  const params = [name, field(e,'jobTitle','title'), department, field(e,'faculty'),
    field(e,'email','emailAddress'), field(e,'phone','telephone'), profileUrl, profile,
    textOf(field(e,'researchGroup')), JSON.stringify(e), new Date().toISOString()];
  if (existing) {
    run(`UPDATE academics SET name=?, title=?, department=?, faculty=?, email=?, phone=?,
         profile_url=?, profile_text=?, research_group=?, raw_json=?, last_scraped=? WHERE id=?`,
      [...params, existing.id]);
    return existing.id;
  }
  return run(`INSERT INTO academics
    (name, title, department, faculty, email, phone, profile_url, profile_text, research_group, raw_json, last_scraped, contensis_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [...params, cid]).lastInsertRowid;
}

function upsertNews(e) {
  const cid = e.sys && e.sys.id;
  const title = field(e, 'title', 'headline');
  const url = field(e, 'url') || `https://www.dmu.ac.uk/${cid}`;
  if (get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { matchText } = require('../lib/keywords');
  const summary = textOf(field(e, 'summary', 'standfirst', 'body')).slice(0, 300);
  const { groups } = matchText(`${title} ${summary}`);
  run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, summary, keyword_groups)
       VALUES (?,?,?,?,?,?,?,?)`,
    [cid, 'DMU News', 'dmu_news', title, field(e,'date','publishDate') || (e.sys && e.sys.version && e.sys.version.created),
     url, summary, groups.join(',')]);
  return true;
}

function upsertCourse(e) {
  const cid = e.sys && e.sys.id;
  const title = field(e, 'title', 'courseTitle', 'name');
  const desc = textOf(field(e, 'description', 'overview', 'summary'));
  const existing = get('SELECT id FROM courses WHERE contensis_id = ?', [cid]);
  const kws = (desc.match(/\b[A-Za-z]{5,}\b/g) || []).slice(0, 30).join(',');
  const params = [title, field(e,'award'), field(e,'level','studyLevel'), field(e,'school'),
    field(e,'department'), field(e,'url'), field(e,'studyMode','mode'), desc, kws,
    JSON.stringify(e), new Date().toISOString()];
  if (existing) {
    run(`UPDATE courses SET title=?, award=?, level=?, school=?, department=?, url=?, study_mode=?,
         description=?, keywords=?, raw_json=?, last_scraped=? WHERE id=?`, [...params, existing.id]);
    return existing.id;
  }
  return run(`INSERT INTO courses
    (title, award, level, school, department, url, study_mode, description, keywords, raw_json, last_scraped, contensis_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [...params, cid]).lastInsertRowid;
}

function upsertResearch(e) {
  const cid = e.sys && e.sys.id;
  const title = field(e, 'title', 'name', 'projectTitle');
  const desc = textOf(field(e, 'description', 'summary', 'overview'));
  const existing = get('SELECT id FROM research_projects WHERE contensis_id = ?', [cid]);
  const params = [title, desc, (desc.match(/\b[A-Za-z]{5,}\b/g)||[]).slice(0,30).join(','), field(e,'url'),
    JSON.stringify(e), new Date().toISOString()];
  if (existing) {
    run(`UPDATE research_projects SET title=?, description=?, keywords=?, url=?, raw_json=?, last_scraped=? WHERE id=?`,
      [...params, existing.id]);
    return existing.id;
  }
  return run(`INSERT INTO research_projects (title, description, keywords, url, raw_json, last_scraped, contensis_id)
    VALUES (?,?,?,?,?,?,?)`, [...params, cid]).lastInsertRowid;
}

// ---- Profile page scraping (publications) ----------------------------------

async function enrichPublications(limit = Infinity) {
  const rows = db.prepare(
    `SELECT id, profile_url FROM academics WHERE profile_url IS NOT NULL
     AND (publications_json IS NULL OR publications_json = '')`
  ).all().slice(0, limit === Infinity ? undefined : limit);
  let enriched = 0;
  for (const a of rows) {
    try {
      const { ok, text } = await getText(a.profile_url);
      if (ok) {
        const $ = cheerio.load(text);
        const pubs = [];
        // Heuristic: a "Publications" heading followed by a list.
        $('h2, h3').each((_, h) => {
          if (/publication/i.test($(h).text())) {
            $(h).nextUntil('h2, h3').find('li, p').each((__, li) => {
              const t = $(li).text().trim();
              if (t.length > 15) pubs.push(t);
            });
          }
        });
        if (pubs.length) {
          run('UPDATE academics SET publications_json=? WHERE id=?',
            [JSON.stringify(pubs.slice(0, 100)), a.id]);
          enriched += 1;
        }
      }
    } catch { /* skip */ }
    await sleep(2000); // 1 request / 2s
  }
  return enriched;
}

// ---- Type classification ---------------------------------------------------

function classify(name) {
  const n = (name || '').toLowerCase();
  if (/(staff|academic|profile|person|people|expert)/.test(n)) return 'academic';
  if (/(news|article|press)/.test(n)) return 'news';
  if (/(course|programme|program|degree)/.test(n)) return 'course';
  if (/(research|project|institute|centre|center)/.test(n)) return 'research';
  if (/(sdg|sustainab)/.test(n)) return 'sdg';
  return null;
}

/**
 * Crawl. mode: 'discover' just lists types; otherwise crawls known categories.
 * options.incrementalNews limits news to the last day.
 */
async function crawl({ mode = 'full', typeMap = null } = {}) {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  try {
    const types = await listContentTypes();
    console.log(`Discovered ${types.length} content types:`);
    for (const t of types) console.log(`  ${t.id}  —  ${t.name}`);
    if (mode === 'discover') {
      logFetch({ source: 'contensis:discover', started_at, completed_at: new Date().toISOString(),
        items_fetched: types.length, items_new: 0, error: null });
      return { types };
    }

    // Build category -> [typeId] map (allow explicit override from env/typeMap).
    const cats = { academic: [], news: [], course: [], research: [], sdg: [] };
    for (const t of types) {
      const c = (typeMap && typeMap[t.id]) || classify(t.name) || classify(t.id);
      if (c && cats[c]) cats[c].push(t.id);
    }

    for (const tid of cats.academic) {
      for await (const e of entries(tid)) { fetched++; upsertAcademic(e); created++; }
    }
    for (const tid of cats.course) {
      for await (const e of entries(tid)) { fetched++; if (upsertCourse(e)) created++; }
    }
    for (const tid of cats.research) {
      for await (const e of entries(tid)) { fetched++; if (upsertResearch(e)) created++; }
    }
    for (const tid of cats.sdg) {
      for await (const e of entries(tid)) { fetched++; if (upsertResearch(e)) created++; }
    }
    for (const tid of cats.news) {
      for await (const e of entries(tid)) { fetched++; if (upsertNews(e)) created++; }
    }
  } catch (e) {
    error = e.message;
  }

  logFetch({ source: 'contensis', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { listContentTypes, crawl, enrichPublications, entries };
