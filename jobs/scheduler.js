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
const staffXml = require('../services/staffXml');
const thinktanks = require('../services/thinktanks');
const briefings = require('../services/briefings');
const appgs = require('../services/appgs');
const briefing = require('../services/briefing');

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
  cron.schedule('0 9 * * *', safe('thinktanks', thinktanks.run), opt);   // daily adaptive sweep
  cron.schedule('30 7 * * *', safe('briefings', briefings.run), opt);    // Commons Library + POSTnotes
  cron.schedule('0 5 * * 1', safe('appgs', appgs.run), opt);             // weekly (register changes ~6-weekly)
  cron.schedule('0 6 * * *', safe('alliance', () => require('../services/alliance').run()), opt); // UA peers, daily
  cron.schedule('45 7 * * *', safe('dmu-news', () => contensis.crawl({ mode: 'news-only' }).catch(()=>{})), opt);

  // Every 4 hours — What's On
  cron.schedule('0 */4 * * *', safe('whatson', whatson.run), opt);

  // Every 6 hours — Committees + GOV.UK consultations
  cron.schedule('0 */6 * * *', safe('committees', committees.run), opt);
  cron.schedule('30 */6 * * *', safe('govuk', govuk.run), opt);

  // Daily 07:50 — morning email digest (after the 07:00–07:40 fetches)
  cron.schedule('50 7 * * *', safe('email-digest', email.sendDigest), opt);

  // Weekly Monday 08:15 — Claude weekly briefing email for the SLT
  cron.schedule('15 8 * * 1', safe('weekly-briefing', briefing.sendWeekly), opt);

  // Weekly Monday — oral questions rota, bills, legislation
  cron.schedule('0 6 * * 1', safe('oralQuestions', secondary.oralQuestions), opt);
  cron.schedule('30 6 * * 1', safe('bills', secondary.bills), opt);
  cron.schedule('0 8 * * 1', safe('legislation', secondary.legislation), opt);

  // Weekly Monday — refresh upcoming DMU events (Contensis, events only)
  cron.schedule('30 4 * * 1', safe('dmu-events', () => contensis.crawl({ mode: 'events-only' })), opt);

  // Monthly — refresh current members from the Members API (2nd of the month)
  cron.schedule('0 4 2 * *', safe('lords', () => require('../services/lords').refreshLords()), opt);
  cron.schedule('30 4 2 * *', safe('commons', () => require('../services/lords').refreshCommons()), opt);

  // Monthly — refresh DMU's UKRI funded projects (3rd of the month)
  cron.schedule('0 4 3 * *', safe('ukri', () => require('../services/ukri').run()), opt);

  // Monthly — full Contensis crawl (staff, courses, research, SDG) on the 1st
  cron.schedule('0 3 1 * *', safe('contensis-full', async () => {
    await contensis.crawl({ mode: 'full' });
    await staffXml.run();          // cross-reference XML + reconcile legacy
    await contensis.enrichPublications();   // also enriches new XML stubs
  }), opt);

  console.log(`[cron] scheduler started (timezone ${TZ}).`);
}

module.exports = { start };
