'use strict';

/**
 * Written Questions & Answers service — queries the writtenquestions-api by
 * keyword across questions, answers and written ministerial statements.
 * Upserts into parliamentary_items (source = "Written Q"), dedup on URL.
 */

const { getJson, sleep } = require('../lib/http');
const { loadGroups } = require('../lib/keywords');
const { db, run, logFetch } = require('../db/database');
const matcher = require('./matcher');

const BASE = 'https://writtenquestions-api.parliament.uk';

function snippet(text, n = 200) {
  if (!text) return '';
  const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

function upsert(item) {
  const existing = db.prepare('SELECT id FROM parliamentary_items WHERE url = ?').get(item.url);
  if (existing) {
    run(`UPDATE parliamentary_items SET keyword_group=?, title=?, member_name=?, party=?,
         house=?, date=?, snippet=?, full_text=?, type=? WHERE id=?`,
      [item.keyword_group, item.title, item.member_name, item.party, item.house,
       item.date, item.snippet, item.full_text, item.type, existing.id]);
    return { id: existing.id, isNew: false };
  }
  const info = run(`INSERT INTO parliamentary_items
    (source, type, keyword_group, title, member_name, party, house, date, snippet, full_text, url, is_new)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    [item.source, item.type, item.keyword_group, item.title, item.member_name, item.party,
     item.house, item.date, item.snippet, item.full_text, item.url]);
  return { id: info.lastInsertRowid, isNew: true };
}

async function fetchKeyword(keyword) {
  const url = `${BASE}/api/writtenquestions/questions?searchTerm=${encodeURIComponent(keyword)}` +
    `&take=40&orderBy=DateTabledDesc&expandMember=true`;
  const data = await getJson(url);
  return data.results || data.Results || [];
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;

  try {
    for (const group of loadGroups()) {
      for (const keyword of group.keywords) {
        let results = [];
        try {
          results = await fetchKeyword(keyword);
        } catch (e) {
          error = (error ? error + '; ' : '') + `${keyword}: ${e.message}`;
          await sleep(1000);
          continue;
        }
        for (const r of results) {
          fetched += 1;
          const v = r.value || r;
          const id = v.id || v.uin;
          const answered = !!(v.answerText || v.dateAnswered);
          const text = v.questionText || v.heading || '';
          const url = `https://questions-statements.parliament.uk/written-questions/detail/${v.dateTabled ? v.dateTabled.slice(0,10) : ''}/${v.uin || id}`;
          const member = v.askingMember || v.member || {};
          const item = {
            source: 'Written Q',
            type: answered ? 'answer' : 'question',
            keyword_group: group.name,
            title: snippet(v.heading || text, 120),
            member_name: member.name || member.nameDisplayAs || null,
            party: member.party || null,
            house: v.house || 'Commons',
            date: v.dateTabled || v.dateAnswered || null,
            snippet: snippet(v.answerText || text),
            full_text: [text, v.answerText].filter(Boolean).join('\n\nAnswer:\n'),
            url,
          };
          const { id: itemId, isNew } = upsert(item);
          if (isNew) {
            created += 1;
            try { matcher.matchItem(itemId, 'parliamentary_item'); } catch { /* non-fatal */ }
          }
        }
        await sleep(1000);
      }
    }
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'writtenQuestions', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
