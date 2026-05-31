'use strict';

/**
 * What's On (calendar) service — fetches events for the next 21 days across
 * Commons, Lords and Committees, diffs against stored events, and flags new or
 * changed keyword-matching events, incrementing the nav badge counter.
 */

const crypto = require('crypto');
const { getJson, sleep } = require('../lib/http');
const { matchText } = require('../lib/keywords');
const { db, run, get, logFetch, getContext, setContext } = require('../db/database');

const BASE = 'https://whatson-api.parliament.uk';

function hash(obj) {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex');
}

function snippet(text, n = 400) {
  if (!text) return '';
  return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function fetchEvents() {
  const start = new Date();
  const end = new Date(Date.now() + 21 * 24 * 3600 * 1000);
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  const houses = ['Commons', 'Lords'];
  const out = [];
  for (const house of houses) {
    const url = `${BASE}/calendar/events/list.json?startDate=${s}&endDate=${e}&house=${house}`;
    try {
      const data = await getJson(url);
      const items = Array.isArray(data) ? data : data.value || data.items || [];
      for (const it of items) out.push({ ...it, _house: house });
    } catch { /* keep going across houses */ }
    await sleep(1000);
  }
  return out;
}

async function run_() {
  const started_at = new Date().toISOString();
  let fetched = 0, created = 0, error = null;
  let newBadge = parseInt(getContext('new_events_count') || '0', 10);

  try {
    const events = await fetchEvents();
    for (const ev of events) {
      fetched += 1;
      // The What's On API uses PascalCase fields (Id, StartDate, StartTime, etc.).
      const startDate = ev.StartDate || ev.startDate;
      const startTime = ev.StartTime || ev.startTime || '';
      const dateIso = startDate ? (startTime ? `${startDate.slice(0, 10)}T${startTime}` : startDate) : null;
      const title = ev.Description || ev.description || ev.Title || ev.title
        || ev.Category || ev.House || 'Parliamentary event';
      const location = ev.Location || ev.location || ev.House || '';
      const extId = String(ev.Id || ev.id || `${ev._house}-${startDate}-${title}`);
      const desc = snippet([location, ev.Members && ev.Members.map ? ev.Members.map((m) => m.Name).join(', ') : ''].filter(Boolean).join(' · '));
      const { primary, groups } = matchText(`${title} ${desc}`);
      const matched = groups.length > 0 ? 1 : 0;
      const ch = hash({ title, date: dateIso, location, desc });
      ev.startDate = dateIso; ev.title = title; ev.location = location; ev.id = extId;

      const existing = get('SELECT id, content_hash FROM diary_events WHERE external_id = ?', [extId]);
      if (existing) {
        if (existing.content_hash !== ch) {
          run(`UPDATE diary_events SET title=?, description=?, date=?, house=?, event_type=?,
               location=?, url=?, keyword_group=?, keyword_match=?, is_new=?, content_hash=? WHERE id=?`,
            [title, desc, ev.startDate || ev.date, ev._house, ev.Category || ev.type || ev.category || 'Event',
             ev.location || null, ev.url || null, primary, matched, matched, ch, existing.id]);
          if (matched) newBadge += 1;
        }
      } else {
        run(`INSERT INTO diary_events
          (external_id, date, house, event_type, title, description, location, url,
           keyword_group, keyword_match, is_new, content_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [extId, ev.startDate || ev.date, ev._house, ev.Category || ev.type || ev.category || 'Event',
           title, desc, ev.location || null, ev.url || null, primary, matched, matched, ch]);
        created += 1;
        if (matched) newBadge += 1;
      }
    }
    setContext('new_events_count', newBadge);
  } catch (e) {
    error = (error ? error + '; ' : '') + e.message;
  }

  logFetch({ source: 'whatson', started_at, completed_at: new Date().toISOString(),
    items_fetched: fetched, items_new: created, error });
  return { fetched, created, error };
}

module.exports = { run: run_ };
