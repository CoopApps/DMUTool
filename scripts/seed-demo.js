'use strict';

/**
 * Demo data seeder — populates a realistic snapshot across every view so the
 * app can be seen "in action" without live API access. Safe to run on a fresh
 * DB. NOT for production (relevance is set directly rather than via Claude).
 */

require('dotenv').config();
const { db, init, run, get } = require('../db/database');
const { seed } = require('../db/seed');
const matcher = require('../services/matcher');
const { normName } = require('../lib/names');

init();
seed();

const today = new Date();
const iso = (offsetDays = 0) => new Date(today.getTime() + offsetDays * 864e5).toISOString();
const day = (o = 0) => iso(o).slice(0, 10);

console.log('Seeding demo data…');

// ---- fetch_log so "last updated" + coverage show ----
for (const s of ['hansard', 'writtenQuestions', 'committees', 'govuk', 'whatson', 'thinktanks', 'guardian', 'feeds', 'contensis', 'alliance']) {
  run(`INSERT INTO fetch_log (source, started_at, completed_at, items_fetched, items_new, error)
       VALUES (?, ?, ?, ?, ?, NULL)`, [s, iso(-0.02), iso(-0.01), 40, 6]);
}

// ---- Academics ----
const ACADEMICS = [
  ['Prof Helen Carr', 'Professor of Optometry', 'Optometry', 'Health & Life Sciences', 'h.carr@dmu.ac.uk', 'research in eye health, vision screening and optometric education; myopia management', ['Myopia management in children: a longitudinal study', 'Vision screening access in deprived communities']],
  ['Dr Amir Khan', 'Associate Professor of Criminology', 'Criminal Justice', 'Business & Law', 'a.khan@dmu.ac.uk', 'policing, knife crime prevention, violence reduction and coercive interviewing techniques', ['Violence reduction units: an evaluation', 'Coercive interviewing and wrongful conviction']],
  ['Dr Sarah Mitchell', 'Reader in Online Safety', 'Computer Science', 'Computing, Engineering & Media', 's.mitchell@dmu.ac.uk', 'online extremism, radicalisation, disinformation and the Online Safety Act; SMIDGE project lead', ['Countering online radicalisation among young adults', 'Disinformation networks and platform design']],
  ['Prof David Owusu', 'Professor of Sustainable Cities', 'Architecture', 'Computing, Engineering & Media', 'd.owusu@dmu.ac.uk', 'sustainable urban design, net zero, SDG 11 sustainable cities and urban regeneration', ['Net zero retrofit in social housing', 'Place-based regeneration and community wellbeing']],
  ['Dr Priya Anand', 'Senior Lecturer in Nursing', 'Nursing & Midwifery', 'Health & Life Sciences', 'p.anand@dmu.ac.uk', 'NHS workforce, nursing education, prescribing and allied health policy', ['Nursing retention and the NHS workforce plan', 'Non-medical prescribing outcomes']],
  ['Prof James Reid', 'Professor of AI', 'Computer Science', 'Computing, Engineering & Media', 'j.reid@dmu.ac.uk', 'artificial intelligence, machine learning, data science and cyber security in education', ['Machine learning for cyber threat detection', 'AI and EdTech in higher education']],
  ['Dr Fiona Grant', 'Lecturer in Higher Education Policy', 'Education', 'Business & Law', 'f.grant@dmu.ac.uk', 'higher education funding, tuition fees, access and participation, OfS regulation', ['Access and participation in post-92 universities', 'The student finance settlement and widening participation']],
  ['Prof Mark Stephens', 'Professor of Immigration Law', 'Law', 'Business & Law', 'm.stephens@dmu.ac.uk', 'immigration rules, student visas, the graduate route and international student policy', ['The graduate route and international recruitment', 'Student visa compliance and UKVI']],
];
for (const [name, title, dept, fac, email, profile, pubs] of ACADEMICS) {
  run(`INSERT INTO academics (name, title, department, faculty, email, profile_text, publications_json, norm_name, source, profile_url)
       VALUES (?,?,?,?,?,?,?,?, 'contensis', ?)`,
    [name, title, dept, fac, email, profile, JSON.stringify(pubs), normName(name), 'https://www.dmu.ac.uk/about-dmu/academic-staff/']);
}

// ---- Courses ----
for (const [title, award, school, dept] of [
  ['Optometry', 'BSc (Hons)', 'Optometry', 'Optometry'],
  ['Criminology and Criminal Justice', 'BA (Hons)', 'Criminal Justice', 'Criminal Justice'],
  ['Cyber Security', 'BSc (Hons)', 'Computer Science', 'Computer Science'],
  ['Nursing (Adult)', 'BSc (Hons)', 'Nursing & Midwifery', 'Nursing & Midwifery'],
  ['Architecture', 'BA (Hons)', 'Architecture', 'Architecture'],
]) {
  run(`INSERT INTO courses (title, award, school, department, description, keywords, url)
       VALUES (?,?,?,?,?,?,?)`, [title, award, school, dept, `${title} at DMU`, title.toLowerCase(), 'https://www.dmu.ac.uk/study/courses']);
}

// ---- DMU events + grants + research ----
run(`INSERT INTO dmu_events (title, description, date, location, url, keywords) VALUES
  ('Safer Knife Campus conference','DMU conference on knife crime prevention and violence reduction',?, 'Leicester','https://dmu.ac.uk/events/1','knife crime violence reduction')`, [day(21)]);
run(`INSERT INTO dmu_events (title, description, date, location, url, keywords) VALUES
  ('SDG 11 Sustainable Cities summit','DMU as UN hub for SDG 11',?, 'Leicester','https://dmu.ac.uk/events/2','sustainable cities net zero')`, [day(35)]);
run(`INSERT INTO grants (gtr_id, title, funder, value, keyword_groups, url) VALUES
  ('g1','SMIDGE: countering online extremism','Horizon Europe',1200000,'Online extremism','https://gtr.ukri.org/x')`);
run(`INSERT INTO grants (gtr_id, title, funder, value, keyword_groups, url) VALUES
  ('g2','Knife crime prevention in the community','UKRI',340000,'Campus safety','https://gtr.ukri.org/y')`);
run(`INSERT INTO research_projects (title, description, keyword_groups, url) VALUES
  ('Safer Knife Campus initiative','Whole-campus approach to knife crime prevention','Campus safety','https://dmu.ac.uk/r/1')`);

// ---- MPs (Commons + Lords) ----
const MPS = [
  [1, 'Sarah', 'Jones', 'Labour', 'Leicester East', 's.jones.mp@parliament.uk', 'Commons', 1],
  [2, 'David', 'Patel', 'Labour', 'Leicester West', 'd.patel.mp@parliament.uk', 'Commons', 1],
  [3, 'Emma', 'Clarke', 'Conservative', 'Charnwood', 'e.clarke.mp@parliament.uk', 'Commons', 1],
  [4, 'Michael', 'Brown', 'Liberal Democrat', 'Cambridge', 'm.brown.mp@parliament.uk', 'Commons', 1],
  [5, 'Rachel', 'Singh', 'Labour', 'Nottingham South', 'r.singh.mp@parliament.uk', 'Commons', 1],
  [200001, 'Lord', 'Smith of Finsbury', 'Crossbench', null, null, 'Lords', 1],
  [200002, 'Baroness', 'Jones of Whitchurch', 'Labour', null, null, 'Lords', 1],
];
for (const [id, fn, ln, party, con, email, house, active] of MPS) {
  run(`INSERT INTO mps (id, first_name, last_name, party, constituency, email, house, is_active)
       VALUES (?,?,?,?,?,?,?,?)`, [id, fn, ln, party, con, email, house, active]);
}
run(`INSERT INTO engagement_log (mp_id, date, type, description, notes, followup) VALUES
  (1, ?, 'meeting','Met at HE roundtable','Interested in knife crime work',1)`, [day(-40)]);
run(`INSERT INTO engagement_log (mp_id, date, type, description, followup) VALUES
  (3, ?, 'email','Sent SMIDGE briefing',0)`, [day(-250)]);

// ---- Parliamentary items ----
const PARL = [
  ['Commons', 'Campus safety', 'Debate on knife crime and violence reduction', 'Sarah Jones', 'Labour', -2],
  ['Commons', 'Higher education', 'Oral questions: tuition fees and student finance', 'Emma Clarke', 'Conservative', -3],
  ['Written Q', 'International students', 'Written question on the graduate route and visa processing', 'Michael Brown', 'Liberal Democrat', -1],
  ['Lords', 'Online extremism', 'Lords debate on the Online Safety Act implementation', 'Lord Smith of Finsbury', 'Crossbench', -4],
  ['Commons', 'Health and nursing', 'Statement on the NHS workforce plan and nursing retention', 'Rachel Singh', 'Labour', -5],
  ['Commons', 'Sector funding & regulation', 'Debate on OfS conditions of registration and financial sustainability', 'Emma Clarke', 'Conservative', -6],
  ['Commons', 'Skills, technical & civic', 'Westminster Hall debate on degree apprenticeships', 'David Patel', 'Labour', -2],
  ['Written Q', 'Research funding', 'Written question on UKRI and Horizon Europe association', 'Michael Brown', 'Liberal Democrat', -7],
];
let pi = 0;
for (const [src, kg, title, member, party, off] of PARL) {
  const info = run(`INSERT INTO parliamentary_items (source, type, keyword_group, title, member_name, party, house, date, snippet, full_text, url, is_new)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [src, 'Debate', kg, title, member, party, src === 'Lords' ? 'Lords' : 'Commons', iso(off),
     `${title}. The Minister responded setting out the Government's position and next steps.`,
     `${title}. The Minister responded setting out the Government's position. Members raised concerns about funding, regulation and the impact on universities and students.`,
     `https://hansard.parliament.uk/x/${++pi}`, off >= -1 ? 1 : 0]);
  matcher.matchItem(info.lastInsertRowid, 'parliamentary_item');
}

// ---- Committee inquiries (relevance set directly for demo) ----
const COMMITTEES = [
  ['Home Affairs Committee', 'Inquiry into knife crime and serious violence', 'Campus safety', 5, 'high', '[Institutional + Expertise] Directly aligns with DMU\'s Safer Knife Campus work and criminology expertise.', 1],
  ['Education Committee', 'The future of higher education funding', 'Higher education', 11, 'high', '[Institutional] Affects DMU\'s core funding and the post-92 sector.', 0],
  ['Science, Innovation and Technology Committee', 'Governance of artificial intelligence', 'AI and technology', 18, 'medium', '[Expertise + Sector/UA] DMU has AI and cyber expertise to contribute.', 0],
  ['Health and Social Care Committee', 'NHS workforce: recruitment and retention', 'Health and nursing', 3, 'high', '[Institutional + Expertise] DMU nursing programmes and workforce research are directly relevant.', 1],
];
for (const [cttee, title, kg, wdr, lvl, rationale, isNew] of COMMITTEES) {
  const id = run(`INSERT INTO committee_inquiries
    (external_id, committee_name, inquiry_title, date_opened, deadline, working_days_remaining, summary, url, is_new, evidence_status, keyword_group, relevance_level, relevance_score, relevance_rationale, relevance_checked)
    VALUES (?,?,?,?,?,?,?,?,?, 'AcceptingEvidence', ?,?,?,?,1)`,
    [`c-${cttee}`.slice(0, 40) + Math.random(), cttee, title, day(isNew ? 0 : -10), day(wdr + 2),
     wdr, `The Committee invites written evidence on ${title.toLowerCase()}, including the impact on universities, funding and communities.`,
     'https://committees.parliament.uk/work/x/', isNew, kg, lvl, lvl === 'high' ? 1 : 0.66, rationale]).lastInsertRowid;
  matcher.matchItem(id, 'committee_inquiry');
}
// mark one committee as submitted for the register
run(`UPDATE committee_inquiries SET submitted=1, contributors='Prof Helen Carr, Dr Amir Khan', submission_url='https://dmu.ac.uk/submission.pdf' WHERE inquiry_title LIKE 'Inquiry into knife crime%'`);

// ---- Consultations ----
const CONS = [
  ['Department for Education', 'Consultation on the Lifelong Learning Entitlement', 'Sector funding & regulation', 8, 'high', '[Institutional + Sector/UA] LLE reshapes course funding — central to DMU and UA.'],
  ['Home Office', 'Review of the Graduate Route', 'International students', 14, 'high', '[Institutional] International recruitment is a major revenue and operational concern.'],
  ['DSIT', 'AI regulation: a pro-innovation approach', 'AI and technology', 22, 'medium', '[Expertise + Sector/UA] DMU AI expertise relevant; lower direct institutional impact.'],
];
for (const [org, title, kg, wdr, lvl, rationale] of CONS) {
  const id = run(`INSERT INTO consultations
    (external_id, title, organisation, summary, url, opened, deadline, working_days_remaining, keyword_group, is_new, relevance_level, relevance_score, relevance_rationale, relevance_checked)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    [`con-${title}`.slice(0, 30) + Math.random(), title, org,
     `The Government seeks views on ${title.toLowerCase()} and its impact on providers and students.`,
     'https://www.gov.uk/government/consultations/x', day(-5), day(wdr + 2), wdr, kg, wdr <= 8 ? 1 : 0, lvl, lvl === 'high' ? 1 : 0.66, rationale]).lastInsertRowid;
  matcher.matchItem(id, 'consultation');
}

// ---- External items: think tanks, briefings, sector, govuk, petitions, oral q ----
const EXT = [
  ['think_tank', 'Education Policy Institute', 'Annual report on higher education access', 'Higher education', 'high', '[Institutional + Expertise] Access and participation directly relevant to DMU.'],
  ['think_tank', 'Institute for Strategic Dialogue', 'New research on online radicalisation', 'Online extremism', 'high', '[Expertise] Aligns with DMU SMIDGE project.'],
  ['think_tank', 'Centre for Cities', 'Report on civic universities and regional growth', 'Sustainable development', 'medium', '[Sector/UA] Aligns with UA civic agenda.'],
  ['briefing', 'House of Commons Library', 'Research briefing: international students and the graduate route', 'International students', 'high', '[Institutional] Briefing on a core recruitment issue.'],
  ['briefing', 'POST (POSTnotes)', 'POSTnote: AI and online safety', 'AI and technology', 'medium', '[Expertise] Relevant to DMU AI and online safety work.'],
  ['he_news', 'Times Higher Education', 'Universities warn on financial sustainability', 'Sector funding & regulation', null, null],
  ['govuk', 'Department for Education', 'New guidance on degree apprenticeships funding', 'Skills, technical & civic', null, null],
];
for (const [type, src, title, kg, lvl, rationale] of EXT) {
  const id = run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, summary, keyword_groups, relevance_level, relevance_score, relevance_rationale, relevance_checked)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [type, src, type, title, iso(-1), `https://example.org/${Math.random()}`,
     `${title}. Analysis of the implications for universities and the sector.`, kg,
     lvl, lvl === 'high' ? 1 : lvl === 'medium' ? 0.66 : null, rationale, lvl ? 1 : 0]).lastInsertRowid;
  if (lvl) matcher.matchItem(id, 'external_item');
}
// petition with trajectory
run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, summary, keyword_groups, meta_json)
  VALUES ('petition','Petitions','petition','Increase funding for university mental health services',?, 'https://petition.parliament.uk/petitions/1','Petition background', 'Higher education', ?)`,
  [iso(-3), JSON.stringify({ signatures: 18452, state: 'open', delta: 1240 })]);
// oral question session
run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, meta_json)
  VALUES ('oral_question','Oral Questions rota','oral_question','Home Office oral questions',?, 'https://oralquestions.parliament.uk/?id=1', ?)`,
  [iso(12), JSON.stringify({ department: 'Home Office' })]);
run(`INSERT INTO external_items (source_id, source_name, source_type, title, date, url, meta_json)
  VALUES ('oral_question','Oral Questions rota','oral_question','Department for Education oral questions',?, 'https://oralquestions.parliament.uk/?id=2', ?)`,
  [iso(8), JSON.stringify({ department: 'Department for Education' })]);

// ---- Diary events (this week) ----
const sow = new Date(today); sow.setUTCDate(sow.getUTCDate() - ((sow.getUTCDay() + 6) % 7));
for (const [d, house, type, title, kg, match] of [
  [1, 'Commons', 'Debate', 'Knife crime and serious violence', 'Campus safety', 1],
  [2, 'Lords', 'Question', 'Online Safety Act implementation', 'Online extremism', 1],
  [2, 'Commons', 'Oral Questions', 'Education questions', 'Higher education', 1],
  [3, 'Commons', 'Committee', 'Education Committee evidence session', 'Higher education', 1],
  [4, 'Lords', 'Debate', 'General debate on rural affairs', null, 0],
]) {
  const dt = new Date(sow); dt.setUTCDate(dt.getUTCDate() + d); dt.setUTCHours(10, 30, 0, 0);
  run(`INSERT INTO diary_events (external_id, date, house, event_type, title, description, keyword_group, keyword_match)
    VALUES (?,?,?,?,?,?,?,?)`, [`ev-${d}-${title}`, dt.toISOString(), house, type, title, `${title} in the ${house}.`, kg, match]);
}

// ---- APPGs ----
run(`INSERT INTO appgs (name, url, purpose, officers_json, keyword_group, matched, last_scraped) VALUES
  ('All-Party Parliamentary Group on Knife Crime and Violence Reduction','https://appg/1','To reduce knife crime and serious violence through evidence-based policy.', ?, 'Campus safety', 1, ?)`,
  [JSON.stringify(['Sarah Jones MP', 'Emma Clarke MP']), iso(-7)]);
run(`INSERT INTO appgs (name, url, purpose, officers_json, keyword_group, matched, last_scraped) VALUES
  ('All-Party Parliamentary Group for Universities','https://appg/2','To promote the interests of universities in Parliament.', ?, 'Higher education', 1, ?)`,
  [JSON.stringify(['David Patel MP', 'Michael Brown MP']), iso(-7)]);

// ---- UA peer activity ----
const UA = [
  ['Coventry University', 'news', 'Coventry opens new health innovation campus', -1],
  ['University of Derby', 'hansard', 'University of Derby cited in skills debate', -2],
  ['UWE Bristol', 'news', 'UWE launches degree apprenticeship expansion', -3],
  ['Teesside University', 'written', 'Teesside referenced in written question on levelling up', -4],
  ['Birmingham City University', 'news', 'BCU announces civic agreement with city council', -2],
  ['Oxford Brookes University', 'news', 'Brookes secures research funding for net zero', -5],
];
for (const [member, type, title, off] of UA) {
  run(`INSERT INTO ua_activity (member, type, title, date, url, snippet) VALUES (?,?,?,?,?,?)`,
    [member, type, title, day(off), `https://uapeer/${Math.random()}`, `${title}.`]);
}

// ---- Drafts ----
run(`INSERT INTO drafts (item_type, item_id, output_type, item_title, content, status) VALUES
  ('committee_inquiry', 1, 'committee_submission', 'Inquiry into knife crime and serious violence',
   'De Montfort University welcomes the opportunity to submit evidence to the Committee''s inquiry into knife crime and serious violence.\n\nDMU''s Safer Knife Campus initiative, led by Dr Amir Khan, has demonstrated measurable reductions in violence through a whole-campus approach. We would be pleased to give oral evidence.', 'approved')`);
run(`INSERT INTO drafts (item_type, item_id, output_type, item_title, content, status) VALUES
  ('parliamentary_item', 2, 'quote', 'Oral questions: tuition fees and student finance',
   '"The current funding settlement leaves post-92 universities like DMU carrying real financial pressure while doing the most for widening participation," said a DMU spokesperson.', 'generated')`);

console.log('Demo data seeded:');
for (const t of ['academics', 'mps', 'parliamentary_items', 'committee_inquiries', 'consultations', 'external_items', 'diary_events', 'dmu_events', 'grants', 'appgs', 'ua_activity', 'drafts', 'academic_matches']) {
  console.log(`  ${t}: ${get(`SELECT COUNT(*) c FROM ${t}`).c}`);
}
