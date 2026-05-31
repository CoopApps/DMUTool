'use strict';

/**
 * Remove demo/sample rows accidentally seeded by scripts/seed-demo.js, leaving
 * the real crawled/fetched data intact. Targets the demo data's distinctive
 * markers only.  node scripts/cleanup-demo.js
 */

require('dotenv').config();
const { init, db, run, get } = require('../db/database');
init();

const before = (t) => get(`SELECT COUNT(*) c FROM ${t}`).c;

const steps = [
  ['parliamentary_items', "DELETE FROM parliamentary_items WHERE url LIKE 'https://hansard.parliament.uk/x/%'"],
  ['committee_inquiries', "DELETE FROM committee_inquiries WHERE external_id LIKE 'c-%'"],
  ['consultations', "DELETE FROM consultations WHERE external_id LIKE 'con-%'"],
  ['external_items', "DELETE FROM external_items WHERE url LIKE 'https://example.org/%' OR url LIKE 'https://uapeer/%' OR url IN ('https://petition.parliament.uk/petitions/1','https://oralquestions.parliament.uk/?id=1','https://oralquestions.parliament.uk/?id=2')"],
  ['ua_activity', "DELETE FROM ua_activity WHERE url LIKE 'https://uapeer/%'"],
  ['academics', "DELETE FROM academics WHERE profile_url = 'https://www.dmu.ac.uk/about-dmu/academic-staff/'"],
  ['courses', "DELETE FROM courses WHERE url = 'https://www.dmu.ac.uk/study/courses' AND description LIKE '% at DMU'"],
  ['dmu_events', "DELETE FROM dmu_events WHERE url IN ('https://dmu.ac.uk/events/1','https://dmu.ac.uk/events/2')"],
  ['grants', "DELETE FROM grants WHERE gtr_id IN ('g1','g2')"],
  ['research_projects', "DELETE FROM research_projects WHERE url = 'https://dmu.ac.uk/r/1'"],
  ['appgs', "DELETE FROM appgs WHERE url IN ('https://appg/1','https://appg/2')"],
  ['mps', "DELETE FROM mps WHERE id IN (1,2,3,4,5,200001,200002)"],
  ['engagement_log', "DELETE FROM engagement_log WHERE mp_id IN (1,2,3,4,5)"],
  ['drafts', "DELETE FROM drafts WHERE item_title IN ('Inquiry into knife crime and serious violence','Oral questions: tuition fees and student finance')"],
];

let removed = 0;
for (const [table, sql] of steps) {
  const b = before(table);
  run(sql);
  const a = before(table);
  if (b - a) { console.log(`  ${table}: removed ${b - a}`); removed += b - a; }
}
// Drop now-orphaned matches.
run(`DELETE FROM academic_matches WHERE academic_id NOT IN (SELECT id FROM academics)`);
run(`DELETE FROM course_matches WHERE course_id NOT IN (SELECT id FROM courses)`);
console.log(`Cleanup complete — removed ${removed} demo rows.`);
