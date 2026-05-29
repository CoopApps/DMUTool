'use strict';

/**
 * Parliamentary calendar helpers — working-days calculation that is aware of
 * weekends and recess periods. Recess dates are fetched from the egg-timer API
 * (https://api.parliament.uk/egg-timer) and cached in-process for the day.
 */

const { getJson } = require('./http');

const EGG_TIMER_URL = 'https://api.parliament.uk/egg-timer/recesses';

let _recessCache = null;
let _recessCacheDay = null;

/** Returns array of { start: Date, end: Date } recess periods. */
async function getRecesses() {
  const today = new Date().toISOString().slice(0, 10);
  if (_recessCache && _recessCacheDay === today) return _recessCache;
  try {
    const data = await getJson(EGG_TIMER_URL);
    const list = Array.isArray(data) ? data : data.recesses || data.value || [];
    _recessCache = list
      .map((r) => ({
        start: new Date(r.start || r.startDate || r.Start),
        end: new Date(r.end || r.endDate || r.End),
      }))
      .filter((r) => !isNaN(r.start) && !isNaN(r.end));
  } catch {
    // Network/format failure — degrade gracefully to weekends-only.
    _recessCache = [];
  }
  _recessCacheDay = today;
  return _recessCache;
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function inRecess(d, recesses) {
  return recesses.some((r) => d >= r.start && d <= r.end);
}

function isSittingDay(d, recesses) {
  return !isWeekend(d) && !inRecess(d, recesses);
}

/**
 * Count working (sitting) days from `from` up to and including `to`.
 * Returns a negative number if the deadline has passed.
 */
async function workingDaysUntil(deadline, from = new Date()) {
  if (!deadline) return null;
  const target = new Date(deadline);
  if (isNaN(target)) return null;
  const recesses = await getRecesses();

  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()));

  if (end < start) {
    // Deadline passed — count backwards as negative.
    let n = 0;
    const cur = new Date(end);
    while (cur < start) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      if (isSittingDay(cur, recesses)) n += 1;
    }
    return -n;
  }

  let n = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isSittingDay(cur, recesses)) n += 1;
  }
  return n;
}

/** Date that is N sitting days before the given date (e.g. oral question deadlines). */
async function sittingDaysBefore(date, n) {
  const recesses = await getRecesses();
  const cur = new Date(date);
  let counted = 0;
  while (counted < n) {
    cur.setUTCDate(cur.getUTCDate() - 1);
    if (isSittingDay(cur, recesses)) counted += 1;
  }
  return cur;
}

module.exports = { getRecesses, workingDaysUntil, sittingDaysBefore, isSittingDay, isWeekend };
