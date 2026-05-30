'use strict';

/**
 * Public DMU website crawler (the Contensis delivery API is restricted to
 * dmu.ac.uk origins, so we use the public site). Enumerates the full sitemap,
 * categorises every URL by section, then scrapes the relevant pages — courses,
 * research, SDG, news, events and policy/engagement content — into the matching
 * engine. `report()` is a dry run that just shows what's there.
 */

const cheerio = require('cheerio');
const { getText, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { db, get, run, logFetch } = require('../db/database');

const SITEMAP = process.env.DMU_SITEMAP_URL || 'https://www.dmu.ac.uk/sitemap.xml';
const DELAY = parseInt(process.env.DMU_SCRAPE_DELAY_MS || '2000', 10);
// DMU's site does strict content negotiation (Accept: application/xml -> 406)
// and prefers a browser-ish UA, so use these for all public-site requests.
const HDRS = { 'User-Agent': 'Mozilla/5.0 (compatible; DMU-Tool/1.0)', Accept: '*/*' };

/** Pull all <loc> URLs from the sitemap. */
async function sitemapUrls() {
  const { ok, status, text } = await getText(SITEMAP, { headers: HDRS });
  if (!ok) throw new Error(`sitemap -> ${status}`);
  return text.split('<loc>').slice(1).map((s) => s.split('<')[0].trim()).filter(Boolean);
}

/** Categorise a URL into a content section (or null = ignore). */
function categorise(url) {
  const p = url.toLowerCase();
  // Skip section-root / trailing-slash variants (the .aspx version is also listed).
  if (p.endsWith('/')) return null;
  if (p.includes('/study/courses/')) {
    if (/(courses\.aspx|short-courses\/about|undergraduate-courses|postgraduate-courses|foundation-courses|distance-learning|extended-education|part-time-courses|january-start|learning-beyond-registration|all-[a-z-]+\.aspx)$/.test(p)) {
      return 'course_index';
    }
    return 'course';
  }
  if (p.includes('/sdg')) return 'sdg';
  if (p.includes('/research/')) return 'research';
  if (p.includes('/about-dmu/news/')) {
    // Recent news only — the archive goes back many years.
    return /\/(202[4-9]|203\d)\//.test(p) ? 'news' : 'news_old';
  }
  if (p.includes('/events/')) return 'event';
  if (p.includes('/empowering-university') || p.includes('/community/public-engagement') ||
      p.includes('/governance/') || p.includes('/community/')) return 'engagement';
  return null;
}

// Durable reference content scraped by default; news/event are opt-in via --only.
const DEFAULT_SECTIONS = ['course', 'research', 'sdg', 'engagement', 'news'];

/** Dry run — bucket the whole sitemap and show counts + samples. */
async function report() {
  const urls = await sitemapUrls();
  const buckets = {};
  for (const u of urls) {
    const c = categorise(u) || '(ignored)';
    (buckets[c] = buckets[c] || []).push(u);
  }
  console.log(`Sitemap: ${urls.length} URLs\n`);
  for (const k of Object.keys(buckets).sort((a, b) => buckets[b].length - buckets[a].length)) {
    console.log(`${String(buckets[k].length).padStart(6)}  ${k}`);
  }
  for (const k of ['course', 'research', 'sdg', 'news', 'event', 'engagement']) {
    if (buckets[k] && buckets[k].length) {
      console.log(`\n--- sample ${k}:`);
      buckets[k].slice(0, 8).forEach((u) => console.log('   ' + u));
    }
  }
  return buckets;
}

/** Scrape a page into { title, summary, body }. */
async function scrapePage(url) {
  const { ok, text } = await getText(url, { headers: HDRS });
  if (!ok) return null;
  const $ = cheerio.load(text);
  const title = ($('h1').first().text() || $('title').text() || '')
    .replace(/\s*[-|]\s*De Montfort University.*$/i, '').replace(/\s+/g, ' ').trim();
  const summary = ($('meta[name="description"]').attr('content') || '').trim();
  $('script, style, nav, header, footer, .nav__wrapper, form').remove();
  const body = ($('main').text() || $('#main').text() || $('article').text() || $('body').text() || '')
    .replace(/\s+/g, ' ').trim().slice(0, 5000);
  return { title, summary, body };
}

function storeCourse(url, page) {
  if (get('SELECT id FROM courses WHERE url = ?', [url])) return false;
  const desc = `${page.summary} ${page.body}`.trim();
  const kws = (desc.match(/\b[A-Za-z]{5,}\b/g) || []).slice(0, 40).join(',');
  run(`INSERT INTO courses (title, url, description, keywords, last_scraped)
       VALUES (?,?,?,?, datetime('now'))`, [page.title, url, desc.slice(0, 4000), kws]);
  return true;
}
function storeResearch(url, page, sdg) {
  if (get('SELECT id FROM research_projects WHERE url = ?', [url])) return false;
  const desc = `${page.summary} ${page.body}`.trim();
  const { groups } = matchText(`${page.title} ${desc}`);
  if (sdg && !groups.includes('Sustainable development')) groups.push('Sustainable development');
  run(`INSERT INTO research_projects (title, description, url, keyword_groups, last_scraped)
       VALUES (?,?,?,?, datetime('now'))`, [page.title, desc.slice(0, 4000), url, groups.join(',')]);
  return true;
}
function storeNews(url, page) {
  if (get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { groups } = matchText(`${page.title} ${page.summary}`);
  run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, summary, keyword_groups)
       VALUES ('dmu','DMU News','dmu_news',?, datetime('now'), ?, ?, ?)`,
    [page.title, url, page.summary.slice(0, 300), groups.join(',')]);
  return true;
}
function storeEvent(url, page) {
  if (get('SELECT id FROM dmu_events WHERE url = ?', [url])) return false;
  run(`INSERT INTO dmu_events (title, description, url, keywords, last_scraped)
       VALUES (?,?,?,?, datetime('now'))`,
    [page.title, page.body.slice(0, 1000), url, (page.body.match(/\b[A-Za-z]{5,}\b/g) || []).slice(0, 30).join(',')]);
  return true;
}
function storeContent(url, section, page) {
  const desc = `${page.summary} ${page.body}`.trim();
  const { groups } = matchText(`${page.title} ${desc}`);
  run(`INSERT INTO dmu_content (url, section, title, summary, body, keyword_groups, last_scraped)
       VALUES (?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(url) DO UPDATE SET title=excluded.title, summary=excluded.summary,
         body=excluded.body, keyword_groups=excluded.keyword_groups, last_scraped=excluded.last_scraped`,
    [url, section, page.title, page.summary, desc.slice(0, 4000), groups.join(',')]);
  return true;
}

/**
 * Crawl + scrape. options.sections limits which categories to scrape;
 * options.limit caps total pages (per run). Polite DELAY between requests.
 */
async function run_({ sections = DEFAULT_SECTIONS, limit = Infinity } = {}) {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const urls = await sitemapUrls();
    const todo = urls.filter((u) => sections.includes(categorise(u)));
    for (const url of todo) {
      if (fetched >= limit) break;
      fetched += 1;
      const section = categorise(url);
      let page;
      try { page = await scrapePage(url); } catch { page = null; }
      if (page && page.title) {
        try {
          let ok = false;
          if (section === 'course') ok = storeCourse(url, page);
          else if (section === 'research') ok = storeResearch(url, page, false);
          else if (section === 'sdg') ok = storeResearch(url, page, true) && storeContent(url, 'sdg', page);
          else if (section === 'news') ok = storeNews(url, page);
          else if (section === 'event') ok = storeEvent(url, page);
          else ok = storeContent(url, section, page);
          if (ok) created += 1;
        } catch (e) { error = (error ? error + '; ' : '') + e.message; }
      }
      await sleep(DELAY);
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }
  logFetch({ source: 'dmuSite', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_, report, sitemapUrls, categorise, scrapePage };
