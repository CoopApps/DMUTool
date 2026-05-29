'use strict';

/**
 * Seed the think_tanks table from the supplied UK think-tank list.
 *
 * Strategy: every name is stored. The DMU-relevant majors get a homepage URL
 * (and an RSS feed where known) so the scanner can fetch them directly; the
 * long tail is stored as `needs_url` stubs (the scanner skips them until an
 * admin adds a URL). Defunct / renamed orgs are marked `dead` so they're never
 * crawled. The per-report relevance gate — not the think tank itself — decides
 * what surfaces, so it's fine to hold sources that rarely hit.
 */

const { db, init } = require('./database');

// Curated overrides for the DMU-relevant organisations.
// name: [homepageUrl, feedUrl|null, keywordGroups[]]
const CURATED = {
  'Education Policy Institute': ['https://epi.org.uk', 'https://epi.org.uk/feed/', ['Higher education']],
  'Sutton Trust': ['https://www.suttontrust.com', 'https://www.suttontrust.com/feed/', ['Higher education']],
  'Million+': ['https://www.millionplus.ac.uk', null, ['Higher education']],
  'The Education Foundation': ['https://www.educationfoundation.org.uk', null, ['Higher education']],
  'Institute for Fiscal Studies': ['https://ifs.org.uk', 'https://ifs.org.uk/articles/rss', ['Research funding', 'Higher education']],
  'Institute for Public Policy Research': ['https://www.ippr.org', 'https://www.ippr.org/feed', ['Higher education', 'Health and nursing', 'Sustainable development']],
  'Resolution Foundation': ['https://www.resolutionfoundation.org', 'https://www.resolutionfoundation.org/feed/', ['Higher education']],
  'King’s Fund': ['https://www.kingsfund.org.uk', null, ['Health and nursing']],
  'King\'s Fund': ['https://www.kingsfund.org.uk', null, ['Health and nursing']],
  'Nuffield Trust': ['https://www.nuffieldtrust.org.uk', null, ['Health and nursing']],
  'Health Foundation': ['https://www.health.org.uk', null, ['Health and nursing']],
  'Centre for Health and the Public Interest (CHPI)': ['https://chpi.org.uk', null, ['Health and nursing']],
  'Nuffield Council on Bioethics': ['https://www.nuffieldbioethics.org', null, ['Health and nursing']],
  'Police Foundation': ['https://www.police-foundation.org.uk', null, ['Criminal justice']],
  'Institute for Strategic Dialogue': ['https://www.isdglobal.org', null, ['Online extremism']],
  'The Henry Jackson Society': ['https://henryjacksonsociety.org', null, ['Online extremism', 'Criminal justice']],
  'Demos': ['https://demos.co.uk', 'https://demos.co.uk/feed/', ['Higher education', 'Criminal justice', 'Online extremism']],
  'Centre for Cities': ['https://www.centreforcities.org', null, ['Sustainable development']],
  'Centre for London': ['https://www.centreforlondon.org', null, ['Sustainable development']],
  'Green Alliance': ['https://green-alliance.org.uk', null, ['Sustainable development']],
  'E3G': ['https://www.e3g.org', null, ['Sustainable development']],
  'Nesta': ['https://www.nesta.org.uk', null, ['AI and technology', 'Research funding']],
  'Institute for Government': ['https://www.instituteforgovernment.org.uk', null, []],
  'Hansard Society': ['https://www.hansardsociety.org.uk', null, []],
  'Royal Society of Arts': ['https://www.thersa.org', null, []],
  'Joseph Rowntree Foundation': ['https://www.jrf.org.uk', null, []],
  'Social Market Foundation': ['https://www.smf.co.uk', null, ['Higher education']],
  'Onward (think tank)': ['https://www.ukonward.com', null, ['Higher education']],
  'Bright Blue': ['https://www.brightblue.org.uk', null, []],
  'Policy Exchange': ['https://policyexchange.org.uk', null, []],
  'Centre for Policy Studies': ['https://cps.org.uk', null, []],
  'Institute of Economic Affairs': ['https://iea.org.uk', null, ['Higher education']],
  'Royal Institute of International Affairs': ['https://www.chathamhouse.org', null, []],
  'Chatham House': ['https://www.chathamhouse.org', null, []],
  'National Institute of Economic and Social Research': ['https://www.niesr.ac.uk', null, ['Research funding']],
  'UK in a Changing Europe': ['https://ukandeu.ac.uk', null, ['Higher education', 'Research funding']],
  'MigrationWatch UK': ['https://www.migrationwatchuk.org', null, ['International students']],
  'British Future': ['https://www.britishfuture.org', null, ['International students']],
  'RAND Europe (an independent division of the RAND Corporation)': ['https://www.rand.org/randeurope', null, ['Health and nursing', 'Criminal justice']],
  'Local Government Information Unit': ['https://lgiu.org', null, ['Sustainable development']],
  'New Local Government Network': ['https://www.newlocal.org.uk', null, ['Sustainable development']],
  'Institute for Employment Studies': ['https://www.employment-studies.co.uk', null, ['Higher education']],
  'Wales Centre for Public Policy': ['https://www.wcpp.org.uk', null, []],
  'Centre for Welfare Reform (CfWR)': ['https://citizen-network.org', null, ['Health and nursing']],
  'Electoral Reform Society': ['https://www.electoral-reform.org.uk', null, []],
  'The Constitution Unit': ['https://www.ucl.ac.uk/constitution-unit', null, []],
};

// Defunct or fully renamed — never crawl.
const DEAD = new Set([
  'Royal Institute of Public Administration (1922–1992)',
  'Quilliam', 'Centre for Social Cohesion', 'Global Ideas Bank', 'Progress',
  'New Politics Network', 'Commonwealth Policy Studies Unit', 'One World Trust',
  'Saunt Policy Studies Institute',
]);

// Full supplied list.
const NAMES = `Adam Smith Institute|Africa Research Institute|Bow Group|Boyd Group|Brand EU|Bright Blue|British American Security Information Council (BASIC)|British Future|Bruges Group|Catalyst|Centre for a Better Britain|Centre for Cities|The Centre for Cross Border Studies|Centre for Defence and International Security Studies|Centre for Economic and Social Inclusion|Centre for Economic Policy Research|Centre for European Reform|Center for Global Development (Europe)|Centre for Health and the Public Interest (CHPI)|Centre for London|Centre for Policy Studies|Centre for Social Cohesion|Centre for Social Justice|Centre for Strategic Research and Analysis (CESRAN)|Centre for the Analysis of Social Exclusion|Centre for the Economics of Education|Centre for the South|Centre for Welfare Reform (CfWR)|Centre for Welsh Studies|Centre Think Tank|Chatham House|City Mayors Foundation|CIVITAS|The Cobden Centre|Common Weal|Commonwealth Freedom of Movement Organisation|Commonwealth Policy Studies Unit|Compass|Council on Geostrategy|The Constitution Unit|Cordoba Foundation|Cornerstone Group|Credos|Defence Synergia|Democracia84|Demos|Development, Concepts and Doctrine Centre|E3G|Economists for Free Trade|The Education Foundation|Education Policy Institute|Ekklesia|Electoral Reform Society|European Council on Foreign Relations|European Foundation|Fabian Society|Future Economic Rural Network|Foreign Policy Centre|Global Ideas Bank|Global Vision|Global Warming Policy Foundation|Gold Mercury International Award|Green Alliance|Halsbury's Law Exchange|Hansard Society|Health Foundation|The Henry Jackson Society|Independent Transport Commission|Initiative for Free Trade|Innovation Unit|Institute for Employment Studies|Institute for European Environmental Policy UK|Institute for Fiscal Studies|Institute for Government|Institute for Jewish Policy Research|Institute for Public Policy Research|Institute for Social Inventions|Institute for Strategic Dialogue|Institute of Advanced Study|Institute of Development Studies (IDS)|Institute of Economic Affairs|Institute of Education|Institute of Race Relations|Institute of Welsh Affairs|The Intergenerational Foundation|International Growth Centre (IGC)|International Institute for Environment and Development|International Institute for Strategic Studies|Jimmy Reid Foundation|Joseph Rowntree Foundation|Jubilee Centre|King's Fund|Labour Together|Legatum Institute|Local Government Information Unit|Localis|LSE IDEAS|Manchester Institute of Innovation Research|MigrationWatch UK|Million+|Mutuo|National Institute of Economic and Social Research|Nesta|New City Initiative|New Economics Foundation|New Local Government Network|New Philanthropy Capital|New Policy Institute|New Politics Network|Nuffield Council on Bioethics|Nuffield Trust|Official Monetary and Financial Institutions Forum|One World Trust|Onward (think tank)|Open Europe|ODI Global (formerly Overseas Development Institute)|Oxford Research Group|Polar Research and Policy Initiative|Police Foundation|Policy Connect|Policy Exchange|Policy Institute|Policy Network|Politeia|Population Matters (formerly known as the Optimum Population Trust)|Progress|Public Policy Institute for Wales|Quilliam|Radix Big Tent|RAND Europe (an independent division of the RAND Corporation)|Real Economics Association|Renewable Energy Foundation|Resolution Foundation|ResPublica|Richardson Institute|Royal Air Force Centre for Air Power Studies|Royal Institute of International Affairs|Royal Institute of Public Administration (1922–1992)|Royal Society of Arts|Royal United Services Institute for Defence and Security Studies|Saunt Policy Studies Institute|Science and Technology Policy Research (SPRU)|Scotland's Futures Forum|Scottish Global Forum|Selsdon Group|Smith Institute|Social Affairs Unit|Social Liberal Forum|Social Market Foundation|Society of Conservative Lawyers|Sutton Trust|TaxPayers' Alliance|Theos|True Blue Strategy|UK in a Changing Europe|United Nations Association - UK|Unlock Democracy|Von Hügel Institute|WebRoots Democracy|Young Fabians|Young Foundation|Wales Centre for Public Policy|Wales Governance Centre|Welsh Centre for International Affairs|The Wilberforce Society|Wales Institute of Social and Economic Research, Data and Methods|The Work Foundation|Z/Yen`
  .split('|').map((s) => s.trim()).filter(Boolean);

function seedThinkTanks() {
  init();
  const exists = db.prepare('SELECT id FROM think_tanks WHERE name = ?');
  const ins = db.prepare(`INSERT INTO think_tanks (name, url, feed_url, status, keyword_groups_json)
    VALUES (?,?,?,?,?)`);
  let added = 0;
  const tx = db.transaction(() => {
    for (const name of NAMES) {
      if (exists.get(name)) continue;            // preserve admin edits
      const c = CURATED[name];
      const dead = DEAD.has(name);
      const status = dead ? 'dead' : c ? 'unvalidated' : 'needs_url';
      ins.run(name, c ? c[0] : null, c ? c[1] : null, status, c ? JSON.stringify(c[2]) : null);
      added += 1;
    }
  });
  tx();
  const counts = db.prepare(`SELECT status, COUNT(*) c FROM think_tanks GROUP BY status`).all();
  console.log(`Think tanks seeded (+${added}). Status:`, counts.map((r) => `${r.status}:${r.c}`).join(', '));
}

if (require.main === module) seedThinkTanks();
module.exports = { seedThinkTanks, NAMES, CURATED };
