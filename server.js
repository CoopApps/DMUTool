'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');

const { init, get } = require('./db/database');
const { seed } = require('./db/seed');

// Initialise schema + reference data on startup.
init();
seed();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Views
app.use('/dashboard', require('./routes/dashboard'));
app.use('/action', require('./routes/action'));
app.use('/events', require('./routes/events'));
app.use('/digest', require('./routes/digest'));
app.use('/diary', require('./routes/diary'));
app.use('/committees', require('./routes/committees'));
app.use('/consultations', require('./routes/consultations'));
app.use('/sector', require('./routes/sector'));
app.use('/mps', require('./routes/mps'));
app.use('/engagement', require('./routes/engagement').router);
app.use('/appgs', require('./routes/appgs'));
app.use('/alliance', require('./routes/alliance'));
app.use('/academics', require('./routes/academics'));
app.use('/item', require('./routes/item'));
app.use('/drafts', require('./routes/drafts'));
app.use('/submissions', require('./routes/submissions'));
app.use('/search', require('./routes/search'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Branded 404 + error pages via the app layout.
app.use((req, res) => {
  const { layout } = require('./lib/render');
  res.status(404).send(layout({ title: 'Not found',
    body: '<div class="page-head"><h1>Page not found</h1></div><p class="empty">That page doesn’t exist. <a href="/action">Back to the Command Centre →</a></p>',
    active: '' }));
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  const { layout } = require('./lib/render');
  res.status(500).send(layout({ title: 'Error',
    body: '<div class="page-head"><h1>Something went wrong</h1></div><p class="empty">An error occurred. <a href="/action">Back to the Command Centre →</a></p>',
    active: '' }));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`DMU Parliamentary Intelligence Tool running at http://localhost:${PORT}`);

  // On first run, if the academics table is empty, kick off a Contensis crawl.
  const count = get('SELECT COUNT(*) AS c FROM academics').c;
  if (count === 0 && (process.env.CONTENSIS_ACCESS_TOKEN || true)) {
    console.log('academics table empty — starting Contensis crawl in the background…');
    require('./services/contensis')
      .crawl({ mode: 'full' })
      .then((r) => console.log('Initial Contensis crawl:', r))
      .catch((e) => console.error('Initial Contensis crawl failed:', e.message));
  }

  // Start scheduled jobs + the background task-queue worker unless disabled.
  if (process.env.DISABLE_CRON !== '1') {
    require('./jobs/scheduler').start();
    require('./jobs/queue').start();
  }
});

module.exports = app;
