'use strict';

const { all } = require('../db/database');

/** Load keyword groups as [{ name, keywords: [..] }]. Cached for the process. */
let _cache = null;
let _cacheAt = 0;
const TTL = 60 * 1000;

function loadGroups(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < TTL) return _cache;
  const rows = all('SELECT name, keywords FROM keyword_groups');
  _cache = rows.map((r) => ({
    name: r.name,
    keywords: (r.keywords || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
  }));
  _cacheAt = now;
  return _cache;
}

/**
 * Determine which keyword groups a piece of text matches.
 * Returns { groups: [names], matchedKeywords: [..], primary: name|null }.
 * "primary" is the group with the most keyword hits.
 */
function matchText(text) {
  const haystack = (text || '').toLowerCase();
  const groups = [];
  const matchedKeywords = new Set();
  let primary = null;
  let best = 0;

  for (const g of loadGroups()) {
    let hits = 0;
    for (const kw of g.keywords) {
      if (kw && haystack.includes(kw)) {
        hits += 1;
        matchedKeywords.add(kw);
      }
    }
    if (hits > 0) {
      groups.push(g.name);
      if (hits > best) {
        best = hits;
        primary = g.name;
      }
    }
  }
  return { groups, matchedKeywords: [...matchedKeywords], primary };
}

/** Flat de-duplicated list of all tracked keywords across all groups. */
function allKeywords() {
  const set = new Set();
  for (const g of loadGroups()) g.keywords.forEach((k) => set.add(k));
  return [...set];
}

module.exports = { loadGroups, matchText, allKeywords };
