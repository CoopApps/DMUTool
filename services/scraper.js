'use strict';

/**
 * Generic HTML news-listing scraper using cheerio. Each source may carry its
 * own CSS selector config (JSON) in the DB; falls back to sensible defaults.
 * Respects a 2-second crawl delay (enforced by the caller). On 403/block,
 * the caller falls back to Google News RSS.
 */

const cheerio = require('cheerio');
const { getText } = require('../lib/http');

const DEFAULT_SELECTORS = {
  item: 'article, .news-item, .listing-item, li.news, .card',
  title: 'h2 a, h3 a, h2, h3, .title a, a',
  date: 'time, .date, .published',
  summary: 'p, .summary, .excerpt',
  link: 'a',
};

function parseSelectors(json) {
  if (!json) return DEFAULT_SELECTORS;
  try { return { ...DEFAULT_SELECTORS, ...JSON.parse(json) }; } catch { return DEFAULT_SELECTORS; }
}

function absolute(href, base) {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return href; }
}

/**
 * Scrape a listing page. Returns { ok, status, items: [{title,date,summary,url}] }.
 */
async function scrapeListing(url, selectorsJson) {
  const sel = parseSelectors(selectorsJson);
  const { ok, status, text } = await getText(url);
  if (!ok) return { ok: false, status, items: [] };

  const $ = cheerio.load(text);
  const items = [];
  $(sel.item).each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find(sel.title).first();
    const title = titleEl.text().trim();
    if (!title) return;
    const href = titleEl.is('a') ? titleEl.attr('href') : $el.find(sel.link).first().attr('href');
    const dateRaw = $el.find(sel.date).first().attr('datetime') || $el.find(sel.date).first().text().trim();
    const summary = $el.find(sel.summary).first().text().trim().slice(0, 300);
    items.push({
      title,
      url: absolute(href, url),
      date: dateRaw || null,
      summary,
    });
  });
  return { ok: true, status, items: items.slice(0, 20) };
}

module.exports = { scrapeListing, DEFAULT_SELECTORS };
