'use strict';

/**
 * Secondary watch-panel sources: Bills, Petitions, Statutory Instruments
 * (legislation.gov.uk Atom), Oral Questions rota and Early Day Motions.
 * All land in external_items with a distinguishing source_type.
 */

const RssParser = require('rss-parser');
const { getJson, getText, sleep, USER_AGENT } = require('../lib/http');
const { loadGroups, matchText } = require('../lib/keywords');
const { all, get, run, logFetch, setContext } = require('../db/database');

const parser = new RssParser({ headers: { 'User-Agent': USER_AGENT }, timeout: 15000 });

function snippet(t, n = 300) {
  if (!t) return '';
  return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function insert({ source_name, source_type, title, date, url, summary, meta }) {
  if (!url || get('SELECT id FROM external_items WHERE url = ?', [url])) return false;
  const { groups } = matchText(`${title} ${summary}`);
  run(`INSERT INTO external_items
    (source_id, source_name, source_type, title, date, url, summary, keyword_groups, meta_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [source_type, source_name, source_type, title, date, url, summary, groups.join(','),
     meta ? JSON.stringify(meta) : null]);
  return true;
}

// ---- Bills (weekly) --------------------------------------------------------
async function bills() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    for (const g of loadGroups()) {
      for (const kw of g.keywords) {
        const url = `https://bills-api.parliament.uk/api/v1/Bills?SearchTerm=${encodeURIComponent(kw)}&take=20`;
        let data;
        try { data = await getJson(url); } catch (e) { error = (error||'')+`${kw}:${e.message};`; await sleep(1000); continue; }
        for (const b of data.items || []) {
          fetched += 1;
          if (insert({
            source_name: 'UK Parliament Bills', source_type: 'bill',
            title: b.shortTitle || b.title, date: b.lastUpdate || null,
            url: `https://bills.parliament.uk/bills/${b.billId}`,
            summary: snippet(b.longTitle || b.summary),
            meta: { stage: b.currentStage && b.currentStage.description, group: g.name },
          })) created += 1;
        }
        await sleep(1000);
      }
    }
  } catch (e) { error = (error||'') + e.message; }
  logFetch({ source: 'bills', started_at, completed_at: new Date().toISOString(), items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

// ---- Petitions (daily, sig > 5000) ----------------------------------------
async function petitions() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const data = await getJson('https://petition.parliament.uk/petitions.json?state=open');
    for (const p of data.data || []) {
      fetched += 1;
      const attr = p.attributes || {};
      const sig = attr.signature_count || 0;
      if (sig <= 5000) continue;
      const text = `${attr.action} ${attr.background || ''}`;
      const { groups } = matchText(text);
      if (!groups.length) continue;
      const url = `https://petition.parliament.uk/petitions/${p.id}`;
      // Record signature trajectory every run (even for known petitions).
      run('INSERT INTO petition_signatures (petition_url, signatures) VALUES (?, ?)', [url, sig]);
      const prev = get(`SELECT signatures FROM petition_signatures WHERE petition_url = ?
        ORDER BY recorded_at DESC LIMIT 1 OFFSET 1`, [url]);
      const delta = prev ? sig - prev.signatures : null;
      const existing = get('SELECT id FROM external_items WHERE url = ?', [url]);
      if (existing) {
        // Keep the live count + trajectory fresh on the stored item.
        run('UPDATE external_items SET meta_json = ? WHERE id = ?',
          [JSON.stringify({ signatures: sig, state: attr.state, delta }), existing.id]);
      } else if (insert({
        source_name: 'Petitions', source_type: 'petition',
        title: attr.action, date: attr.created_at,
        url,
        summary: snippet(attr.background),
        meta: { signatures: sig, state: attr.state, delta },
      })) created += 1;
    }
  } catch (e) { error = (error||'') + e.message; }
  logFetch({ source: 'petitions', started_at, completed_at: new Date().toISOString(), items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

// ---- Statutory Instruments (weekly, Atom per keyword) ----------------------
async function legislation() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    for (const g of loadGroups()) {
      for (const kw of g.keywords) {
        const url = `https://www.legislation.gov.uk/uksi/data.feed?text=${encodeURIComponent(kw)}&results-count=10`;
        try {
          const { ok, text } = await getText(url, { headers: { Accept: 'application/atom+xml' } });
          if (!ok) { await sleep(1000); continue; }
          const feed = await parser.parseString(text);
          for (const it of feed.items || []) {
            fetched += 1;
            if (insert({
              source_name: 'legislation.gov.uk (SI)', source_type: 'legislation',
              title: it.title, date: it.isoDate || it.pubDate, url: it.link,
              summary: snippet(it.contentSnippet || it.content), meta: { group: g.name },
            })) created += 1;
          }
        } catch (e) { error = (error||'')+`${kw}:${e.message};`; }
        await sleep(1000);
      }
    }
  } catch (e) { error = (error||'') + e.message; }
  logFetch({ source: 'legislation', started_at, completed_at: new Date().toISOString(), items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

// ---- Early Day Motions (daily) --------------------------------------------
async function edms() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    for (const g of loadGroups()) {
      for (const kw of g.keywords) {
        const url = `https://oralquestions-api.parliament.uk/EarlyDayMotions/list?parameters.searchTerm=${encodeURIComponent(kw)}&parameters.take=20`;
        let data;
        try { data = await getJson(url); } catch (e) { error=(error||'')+`${kw}:${e.message};`; await sleep(1000); continue; }
        for (const row of data.Response || data.response || []) {
          fetched += 1;
          if (insert({
            source_name: 'Early Day Motions', source_type: 'edm',
            title: row.Title, date: row.DateTabled,
            url: `https://edm.parliament.uk/early-day-motion/${row.Id}`,
            summary: snippet(row.MotionText), meta: { signatures: row.SignatureCount, group: g.name },
          })) created += 1;
        }
        await sleep(1000);
      }
    }
  } catch (e) { error = (error||'') + e.message; }
  logFetch({ source: 'edms', started_at, completed_at: new Date().toISOString(), items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

// ---- Oral Questions rota (weekly) -----------------------------------------
const KEY_DEPARTMENTS = ['Home Office', 'Department for Education',
  'Department for Science, Innovation and Technology', 'Department of Health and Social Care'];

async function oralQuestions() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const url = `https://oralquestions-api.parliament.uk/oralquestiontimes/list?parameters.answeringDateStart=${today}&parameters.answeringDateEnd=${end}`;
    const data = await getJson(url);
    for (const row of data.Response || data.response || []) {
      fetched += 1;
      const dept = row.AnsweringBody || row.AnsweringBodyName || '';
      if (!KEY_DEPARTMENTS.some((d) => dept.toLowerCase().includes(d.toLowerCase().slice(0, 12)))) continue;
      const u = `https://oralquestions.parliament.uk/?id=${row.Id}`;
      if (insert({
        source_name: 'Oral Questions rota', source_type: 'oral_question',
        title: `${dept} oral questions`, date: row.AnsweringWhen || row.Date, url: u,
        summary: `Departmental question time for ${dept}.`,
        meta: { department: dept, deadline: row.DeadlineWhen || null },
      })) created += 1;
    }
  } catch (e) { error = (error||'') + e.message; }
  logFetch({ source: 'oralQuestions', started_at, completed_at: new Date().toISOString(), items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { bills, petitions, legislation, edms, oralQuestions };
