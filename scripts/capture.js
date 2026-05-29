'use strict';
// Fetch key views from the running server and write self-contained HTML
// (CSS inlined, external JS dropped) so they can be opened offline.
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const BASE = process.env.CAP_BASE || 'http://localhost:3399';
const OUT = '/tmp/demo';
fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');

const PAGES = [
  ['01-this-week', '/action'],
  ['02-digest', '/digest'],
  ['03-committees', '/committees'],
  ['04-consultations', '/consultations'],
  ['05-diary', '/diary'],
  ['06-sector-thinktanks', '/sector?tab=think_tank'],
  ['07-mp-profile', '/mps/1'],
  ['08-engagement', '/engagement'],
  ['09-appgs', '/appgs'],
  ['10-ua-peers', '/alliance'],
  ['11-academics', '/academics?q=knife%20crime'],
  ['12-drafts', '/drafts'],
  ['13-admin', '/admin'],
  ['14-submissions', '/submissions'],
];

(async () => {
  for (const [name, urlPath] of PAGES) {
    try {
      const res = await fetch(BASE + urlPath);
      let html = await res.text();
      html = html
        .replace('<link rel="stylesheet" href="/css/app.css">', `<style>${css}</style>`)
        .replace('<script src="/js/app.js"></script>', '<!-- interactive JS omitted in static capture -->');
      fs.writeFileSync(path.join(OUT, name + '.html'), html);
      console.log(`captured ${name} (${html.length}b)`);
    } catch (e) {
      console.log(`FAILED ${name}: ${e.message}`);
    }
  }
})();
