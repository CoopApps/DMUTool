'use strict';

/**
 * node-cron scheduler. Each job runs its service and the service itself writes
 * to fetch_log. Schedules follow Part 8 of the brief.
 */

const cron = require('node-cron');

const hansard = require('../services/hansard');
const writtenQuestions = require('../services/writtenQuestions');
const committees = require('../services/committees');
const whatson = require('../services/whatson');
const feeds = require('../services/feeds');
const secondary = require('../services/secondary');
const contensis = require('../services/contensis');
const guardian = require('../services/guardian');
const govuk = require('../services/govuk');
const email = require('../services/email');

const TZ = process.env.TZ || 'Europe/London';

function safe(name, fn) {
  return async () => {
    console.log(`[cron] ${name} starting…`);
    try { await fn(); console.log(`[cron] ${name} done.`); }
    catch (e) { console.error(`[cron] ${name} failed:`, e.message); }
  };
}

function start() {
  const opt = { timezone: TZ };

  // Daily 07:00 — Hansard + Written Questions + Petitions + EDMs + HE feeds
  cron.schedule('0 7 * * *', safe('hansard', hansard.run), opt);
  cron.schedule('0 7 * * *', safe('writtenQuestions', writtenQuestions.run), opt);
  cron.schedule('15 7 * * *', safe('petitions', secondary.petitions), opt);
  cron.schedule('20 7 * * *', safe('edms', secondary.edms), opt);
  cron.schedule('30 7 * * *', safe('feeds', feeds.run), opt);
  cron.schedule('40 7 * * *', safe('guardian', guardian.run), opt);
  cron.schedule('45 7 * * *', safe('dmu-news', () => contensis.crawl({ mode: 'news-only' }).catch(()=>{})), opt);

  // Every 4 hours — What's On
  cron.schedule('0 */4 * * *', safe('whatson', whatson.run), opt);

  // Every 6 hours — Committees + GOV.UK consultations
  cron.schedule('0 */6 * * *', safe('committees', committees.run), opt);
  cron.schedule('30 */6 * * *', safe('govuk', govuk.run), opt);

  // Daily 07:50 — morning email digest (after the 07:00–07:40 fetches)
  cron.schedule('50 7 * * *', safe('email-digest', email.sendDigest), opt);

  // Weekly Monday — oral questions rota, bills, legislation
  cron.schedule('0 6 * * 1', safe('oralQuestions', secondary.oralQuestions), opt);
  cron.schedule('30 6 * * 1', safe('bills', secondary.bills), opt);
  cron.schedule('0 8 * * 1', safe('legislation', secondary.legislation), opt);

  // Monthly — full Contensis crawl (staff, courses, research, SDG) on the 1st
  cron.schedule('0 3 1 * *', safe('contensis-full', async () => {
    await contensis.crawl({ mode: 'full' });
    await contensis.enrichPublications();
  }), opt);

  console.log(`[cron] scheduler started (timezone ${TZ}).`);
}

module.exports = { start };
