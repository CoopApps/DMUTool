'use strict';

/**
 * Seeds default reference data: keyword groups, professional bodies,
 * external news sources, and core DMU institutional context.
 * Idempotent — safe to run repeatedly.
 */

const { db, init, run, get, setContext } = require('./database');

const KEYWORD_GROUPS = [
  ['International students', 'UKVI, student visa, international students, Tier 4, overseas students, visa processing, immigration rules, graduate route'],
  ['Campus safety', 'knife crime, offensive weapons, round-tipped knives, bladed articles, violence reduction, safer streets'],
  ['Online extremism', 'online harms, radicalisation, extremism, disinformation, Online Safety Act, adults online, SMIDGE, online safety'],
  ['Research funding', 'Horizon Europe, research funding, R&D, university research, science funding, innovation funding, UKRI'],
  ['Higher education', 'universities, higher education, tuition fees, student finance, TEF, REF, OfS, Access and Participation'],
  ['AI and technology', 'artificial intelligence, machine learning, quantum computing, cyber security, data science, EdTech'],
  ['Criminal justice', 'coercive interviewing, criminal justice, policing, forensic, wrongful conviction'],
  ['Sustainable development', 'SDG, sustainable cities, net zero, urban regeneration, climate, sustainability'],
  ['Health and nursing', 'nursing, midwifery, allied health, NHS workforce, healthcare education, prescribing'],
  ['Optometry', 'optometry, optometrist, optical, eye health, dispensing optician, vision'],
];

// name, url, feed_url(null=scrape), scrape_selectors, departments, keyword_groups
const PROFESSIONAL_BODIES = [
  ['General Optical Council', 'https://optical.org/news', null, '{"item":"article, .news-item","title":"h2, h3 a","date":"time","summary":"p","link":"a"}', '["Optometry","Allied Health"]', '["Optometry","Health and nursing"]'],
  ['College of Optometrists', 'https://www.college-optometrists.org/news', null, null, '["Optometry"]', '["Optometry"]'],
  ['Nursing and Midwifery Council', 'https://www.nmc.org.uk/news', null, null, '["Nursing","Midwifery"]', '["Health and nursing"]'],
  ['Royal Pharmaceutical Society', 'https://www.rpharms.com/news', null, null, '["Pharmacy"]', '["Health and nursing"]'],
  ['British Psychological Society', 'https://www.bps.org.uk/news', null, null, '["Psychology"]', '["Health and nursing","Criminal justice"]'],
  ['Chartered Institute of Legal Executives', 'https://www.cilex.org.uk/news', null, null, '["Law"]', '["Criminal justice"]'],
  ['Law Society', 'https://www.lawsociety.org.uk/topics', null, null, '["Law"]', '["Criminal justice"]'],
  ['BCS', 'https://www.bcs.org/articles', null, null, '["Computer Science"]', '["AI and technology"]'],
  ['Royal Institute of British Architects', 'https://www.architecture.com/knowledge-and-resources/knowledge-landing-page/riba-news', null, null, '["Architecture"]', '["Sustainable development"]'],
  ['Chartered Institute of Building', 'https://www.ciob.org/news', null, null, '["Architecture","Engineering"]', '["Sustainable development"]'],
  ['Institution of Engineering and Technology', 'https://www.theiet.org/news', null, null, '["Engineering"]', '["AI and technology"]'],
  ['Chartered Management Institute', 'https://www.managers.org.uk/knowledge-and-insights', null, null, '["Business","Management"]', '["Higher education"]'],
  ['Chartered Institute of Marketing', 'https://www.cim.co.uk/content-hub', null, null, '["Marketing"]', '["Higher education"]'],
  ['ICAEW', 'https://www.icaew.com/insights', null, null, '["Accounting","Finance"]', '["Higher education"]'],
  ['Royal College of Nursing', 'https://www.rcn.org.uk/news-and-events/news', null, null, '["Nursing"]', '["Health and nursing"]'],
  ['CILIP', 'https://www.cilip.org.uk/news', null, null, '["Library","Information Science"]', '["Higher education"]'],
  ['Design Council', 'https://www.designcouncil.org.uk/news', null, null, '["Design","Fashion"]', '["Sustainable development"]'],
];

// name, source_type, feed_url, scrape_url, scrape_selectors, refresh
const EXTERNAL_SOURCES = [
  ['Times Higher Education', 'he_news', 'https://www.timeshighereducation.com/news/rss.xml', null, null, 'daily'],
  ['HEPI', 'he_news', 'https://hepi.ac.uk/category/blog/feed', null, null, 'daily'],
  ['Office for Students', 'he_news', 'https://www.officeforstudents.org.uk/news-blog-and-events/news-and-blog/feed/', null, null, 'daily'],
  ['Universities UK', 'he_news', null, 'https://www.universitiesuk.ac.uk/latest/news', null, 'daily'],
  ['UKRI news', 'he_news', 'https://www.ukri.org/news/feed/', null, null, 'daily'],
  ['Wonkhe', 'he_news', 'https://wonkhe.com/feed/', null, null, 'daily'],
  ['SRHE blog', 'he_news', 'https://srheblog.com/feed', null, null, 'weekly'],
  ['Research Professional News', 'outlet', 'https://news.google.com/rss/search?q=site:researchprofessional.com&hl=en-GB&gl=GB', null, null, 'daily'],
  ['Guardian Higher Education', 'outlet', 'https://www.theguardian.com/education/higher-education/rss', null, null, 'daily'],
  ['BBC Education', 'outlet', 'https://feeds.bbci.co.uk/news/education/rss.xml', null, null, 'daily'],
  ['Pharmaceutical Journal', 'outlet', 'https://pharmaceutical-journal.com/feed', null, null, 'daily'],
  ['Optometry Today', 'outlet', null, 'https://www.optometry.co.uk/news', null, 'daily'],
];

const DMU_CONTEXT = [
  ['sdg11_hub', 'DMU is the only UK university appointed as UN global academic hub for SDG 11 (Sustainable Cities and Communities).'],
  ['key_research', 'Key research areas: online extremism (SMIDGE project, Horizon Europe funded), knife crime prevention (Safer Knife Campus initiative), optometry, nursing, AI and computer science, architecture and sustainable design, criminal justice.'],
  ['campuses', 'International campuses: Dubai, Cambodia, Kazakhstan, London.'],
  ['rankings', 'TEF Silver rated; ranked in QS World University Rankings for Art and Design, Computer Science, and Economics.'],
  ['institutional_voice', 'Professional, direct, evidence-grounded, not promotional.'],
  ['new_events_count', '0'],
];

function seed() {
  init();

  const insGroup = db.prepare(
    `INSERT INTO keyword_groups (name, keywords) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET keywords = excluded.keywords`
  );
  for (const [name, keywords] of KEYWORD_GROUPS) insGroup.run(name, keywords);

  // Professional bodies — only insert if absent (preserve admin edits).
  const pbExists = db.prepare('SELECT id FROM professional_bodies WHERE name = ?');
  const insPb = db.prepare(
    `INSERT INTO professional_bodies (name, url, feed_url, scrape_selectors, departments_json, keyword_groups_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const row of PROFESSIONAL_BODIES) {
    if (!pbExists.get(row[0])) insPb.run(...row);
  }

  const esExists = db.prepare('SELECT id FROM external_sources WHERE name = ?');
  const insEs = db.prepare(
    `INSERT INTO external_sources (name, source_type, feed_url, scrape_url, scrape_selectors, refresh)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const row of EXTERNAL_SOURCES) {
    if (!esExists.get(row[0])) insEs.run(...row);
  }

  for (const [key, value] of DMU_CONTEXT) {
    // Don't clobber the live event counter on re-seed.
    if (key === 'new_events_count' && get('SELECT id FROM dmu_context WHERE key = ?', [key])) continue;
    setContext(key, value);
  }

  console.log('Seed complete:');
  console.log(`  keyword_groups:      ${get('SELECT COUNT(*) c FROM keyword_groups').c}`);
  console.log(`  professional_bodies: ${get('SELECT COUNT(*) c FROM professional_bodies').c}`);
  console.log(`  external_sources:    ${get('SELECT COUNT(*) c FROM external_sources').c}`);
  console.log(`  dmu_context:         ${get('SELECT COUNT(*) c FROM dmu_context').c}`);
}

if (require.main === module) seed();

module.exports = { seed };
