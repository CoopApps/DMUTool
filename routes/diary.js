'use strict';

const express = require('express');
const router = express.Router();
const { all, setContext, ageNewFlags } = require('../db/database');
const { layout, esc } = require('../lib/render');
const { getRecesses, sittingDaysBefore, workingDaysUntil } = require('../lib/parliament');

function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

router.get('/', async (req, res) => {
  ageNewFlags();
  // Clear the "new events" badge on visit.
  setContext('new_events_count', '0');

  const offset = parseInt(req.query.week || '0', 10);
  const base = startOfWeek(new Date());
  base.setUTCDate(base.getUTCDate() + offset * 7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d);
  }
  const weekStart = days[0].toISOString().slice(0, 10);
  const weekEnd = days[6].toISOString().slice(0, 10);

  const events = all(
    `SELECT * FROM diary_events WHERE date(date) BETWEEN ? AND ? ORDER BY date ASC`,
    [weekStart, weekEnd]
  );
  const recesses = await getRecesses();

  const byDay = {};
  for (const e of events) {
    const k = (e.date || '').slice(0, 10);
    (byDay[k] = byDay[k] || []).push(e);
  }

  const cols = await Promise.all(days.map(async (d) => {
    const key = d.toISOString().slice(0, 10);
    const inRecess = recesses.some((r) => d >= r.start && d <= r.end);
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const dayEvents = byDay[key] || [];
    const cards = await Promise.all(dayEvents.map(async (e) => {
      const matchClass = e.keyword_match ? `matched group-${(e.keyword_group||'').replace(/\W/g,'')}` : '';
      let oral = '';
      if (/oral question/i.test(e.event_type || '') || /question time/i.test(e.title || '')) {
        const deadline = await sittingDaysBefore(new Date(e.date), 3);
        const wd = await workingDaysUntil(deadline);
        oral = `<div class="oral">Submit by ${deadline.toISOString().slice(0,10)} (${wd} working days)</div>`;
      }
      return `<div class="event ${matchClass}" onclick="this.classList.toggle('open')">
        <span class="ev-house">${esc(e.house || '')}</span>
        <span class="ev-time">${esc((e.date || '').slice(11,16))}</span>
        <div class="ev-title">${esc(e.title || '')}</div>
        <div class="ev-desc">${esc(e.description || '')}</div>${oral}
      </div>`;
    }));
    const cls = inRecess ? 'recess' : isWeekend ? 'weekend' : '';
    return `<div class="day ${cls}">
      <div class="day-head">${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}${inRecess ? ' · recess' : ''}</div>
      ${cards.join('') || '<p class="empty">—</p>'}
    </div>`;
  }));

  const body = `<div class="page-head"><h1>Parliamentary diary</h1>
    <div class="weeknav">
      <a href="/diary?week=${offset-1}">← Previous</a>
      <span>${weekStart} – ${weekEnd}</span>
      <a href="/diary?week=${offset+1}">Next →</a>
    </div></div>
    <div class="diary-grid">${cols.join('')}</div>`;

  res.send(layout({ title: 'Diary', body, active: '/diary' }));
});

module.exports = router;
