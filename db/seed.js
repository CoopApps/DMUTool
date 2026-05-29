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
  ['Sector funding & regulation', 'Office for Students, OfS, condition of registration, conditions of registration, higher education funding, teaching grant, tuition fees, student finance, financial sustainability, franchised provision, subcontracted provision, degree awarding powers, university title, Lifelong Learning Entitlement, LLE, USS, university pensions, staff pay, free speech, higher education act, quality and standards, course closures'],
  ['Skills, technical & civic', 'degree apprenticeships, apprenticeships, T-levels, technical education, further education, skills, skills policy, levelling up, regional growth, civic university, place-based, devolution, knowledge exchange, KEF, innovation, University Alliance, mission group, professional and technical universities, applied research'],
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
  ['University Alliance', 'he_news', 'https://www.unialliance.ac.uk/feed/', 'https://www.unialliance.ac.uk/news/', null, 'daily'],
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
  ['mission_group', 'DMU is a member of University Alliance — the mission group for professional and technical universities. Its institutional interests align with UA advocacy on applied research, technical and professional education, skills, degree apprenticeships, and the civic/regional growth agenda.'],
  ['institutional_interests', 'DMU\'s interests are not only where it has academic expertise but where it is affected as an institution: higher education funding and tuition fees; OfS regulation and conditions of registration; international student recruitment and visa/immigration policy (a major revenue and operational concern); research funding (UKRI, Horizon); degree apprenticeships and skills policy; the Lifelong Learning Entitlement; staff pay and pensions (USS); free speech duties; quality and standards; and DMU\'s civic role in Leicester and the East Midlands.'],
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
    // Insert defaults only if absent — never clobber admin edits on restart.
    if (get('SELECT id FROM dmu_context WHERE key = ?', [key])) continue;
    setContext(key, value);
  }

  // SDG -> keyword-group mapping (DMU is UN hub for SDG 11).
  const SDG_MAP = [
    ['SDG 3 (Good Health and Well-being)', 'Health and nursing'],
    ['SDG 4 (Quality Education)', 'Higher education'],
    ['SDG 9 (Industry, Innovation and Infrastructure)', 'AI and technology'],
    ['SDG 9 (Industry, Innovation and Infrastructure)', 'Research funding'],
    ['SDG 11 (Sustainable Cities and Communities)', 'Sustainable development'],
    ['SDG 13 (Climate Action)', 'Sustainable development'],
    ['SDG 16 (Peace, Justice and Strong Institutions)', 'Criminal justice'],
  ];
  const insSdg = db.prepare(`INSERT INTO sdg_keyword_map (sdg, keyword_group) VALUES (?,?)
    ON CONFLICT(sdg, keyword_group) DO NOTHING`);
  for (const [s, g] of SDG_MAP) insSdg.run(s, g);

  // University Alliance members (peers to monitor). name, short, domain, region, is_self
  const UA_MEMBERS = [
    ['De Montfort University', 'DMU', 'dmu.ac.uk', 'East Midlands', 1],
    ['Bournemouth University', 'BU', 'bournemouth.ac.uk', 'South West', 0],
    ['University of Westminster', 'Westminster', 'westminster.ac.uk', 'London', 0],
    ['University of West London', 'UWL', 'uwl.ac.uk', 'London', 0],
    ['Robert Gordon University', 'RGU', 'rgu.ac.uk', 'Scotland', 0],
    ['University of Derby', 'Derby', 'derby.ac.uk', 'East Midlands', 0],
    ['Middlesex University', 'Middlesex', 'mdx.ac.uk', 'London', 0],
    ['Anglia Ruskin University', 'ARU', 'aru.ac.uk', 'East of England', 0],
    ['Birmingham City University', 'BCU', 'bcu.ac.uk', 'West Midlands', 0],
    ['Leeds Beckett University', 'Leeds Beckett', 'leedsbeckett.ac.uk', 'Yorkshire', 0],
    ['University of Brighton', 'Brighton', 'brighton.ac.uk', 'South East', 0],
    ['University of Greenwich', 'Greenwich', 'gre.ac.uk', 'London', 0],
    ['Coventry University', 'Coventry', 'coventry.ac.uk', 'West Midlands', 0],
    ['UWE Bristol', 'UWE', 'uwe.ac.uk', 'South West', 0],
    ['Teesside University', 'Teesside', 'tees.ac.uk', 'North East', 0],
    ['Kingston University', 'Kingston', 'kingston.ac.uk', 'London', 0],
    ['Oxford Brookes University', 'Oxford Brookes', 'brookes.ac.uk', 'South East', 0],
    ['University of Hertfordshire', 'Herts', 'herts.ac.uk', 'East of England', 0],
    ['University of South Wales', 'USW', 'southwales.ac.uk', 'Wales', 0],
  ];
  const uaExists = db.prepare('SELECT id FROM ua_members WHERE name = ?');
  const insUa = db.prepare('INSERT INTO ua_members (name, short, domain, region, is_self) VALUES (?,?,?,?,?)');
  for (const m of UA_MEMBERS) { if (!uaExists.get(m[0])) insUa.run(...m); }

  try { require('./seed-thinktanks').seedThinkTanks(); } catch (e) { console.warn('think-tank seed skipped:', e.message); }

  console.log('Seed complete:');
  console.log(`  keyword_groups:      ${get('SELECT COUNT(*) c FROM keyword_groups').c}`);
  console.log(`  professional_bodies: ${get('SELECT COUNT(*) c FROM professional_bodies').c}`);
  console.log(`  external_sources:    ${get('SELECT COUNT(*) c FROM external_sources').c}`);
  console.log(`  dmu_context:         ${get('SELECT COUNT(*) c FROM dmu_context').c}`);
}

if (require.main === module) seed();

module.exports = { seed };
