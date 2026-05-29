# DMU Parliamentary Intelligence Tool

A local web application that replaces manual parliamentary monitoring with a
targeted intelligence tool for the De Montfort University Public Affairs team.
It surfaces relevant debates, questions, committee inquiries, diary events,
sector news and professional-body activity, matches them to DMU academic
expertise and courses, and supports rapid drafting of responses, quotes and
committee submissions.

Stack: **Node.js · Express · SQLite (better-sqlite3) · plain HTML/CSS/vanilla JS**.
Serves on `http://localhost:3000`.

---

## Features

| View | Path | What it does |
|------|------|--------------|
| Daily digest | `/digest` | Parliamentary items grouped by topic, with matched academics, matched courses, and Draft / Find-experts actions. New-inquiry banners. |
| Parliamentary diary | `/diary` | Week-at-a-glance calendar from the What's On API, recess-aware, oral-question deadline countdowns. |
| Committee tracker | `/committees` | Open inquiries sorted by deadline, RAG-coded working days, matched academics, submission tracker. |
| Sector watch | `/sector` | HE news, professional bodies, outlets, legislation, bills, EDMs, petitions. |
| MP tracker | `/mps` | Browse/search 622 MPs, engagement log, recent contributions, voting record, declared interests. |
| Academic finder | `/academics` | FTS5 full-text search across profiles, publications, departments. |
| Admin | `/admin` | Keyword groups, professional-body mappings, fetch log, DMU context, manual refresh. |

Two-tier academic matching:
* **Tier 1** — fast keyword scoring, runs automatically on every new item.
* **Tier 2** — semantic matching via the Claude API ("Find experts"), cached 7 days.

Drafting panel (Claude API) generates: media quote, press response, briefing
note, committee submission opening, or a personalised MP engagement email.

---

## Installation

```bash
npm install
cp .env.example .env      # then fill in the values (see below)
```

**Requirements**

* Node.js 18+
* [`mdbtools`](https://github.com/mdbtools/mdbtools) (`mdb-export`) — only for the
  Access migration. On Debian/Ubuntu: `sudo apt-get install mdbtools`.

## Configuration (`.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000). |
| `TZ` | Cron timezone (default `Europe/London`). |
| `DISABLE_CRON` | `1` to disable scheduled jobs. |
| `DB_PATH` | SQLite file path (default `db/dmu.sqlite`). |
| `ACCESS_DB_PATH` | Path to the Access `.accdb` backup for migration. |
| `CONTENSIS_ROOT_URL` / `CONTENSIS_ACCESS_TOKEN` / `CONTENSIS_PROJECT_ID` | DMU Contensis delivery API credentials. |
| `ANTHROPIC_API_KEY` | Claude API key — required for Find-experts and drafting. |
| `CLAUDE_MODEL` | Claude model id (default `claude-sonnet-4-20250514`). |

## Running the migration (first-time setup)

```bash
# 1. Seed reference data, import the Access DB, crawl Contensis, fetch parliament
./scripts/migrate.sh /path/to/MP_Contact_Database__DESIGN__Backup.accdb
```

Or step by step:

```bash
node db/seed.js                                   # keyword groups + sources + context
node scripts/migrate.js /path/to/file.accdb       # MPs, contacts, legacy academics
node scripts/crawl-contensis.js                   # discover content types (logs IDs)
node scripts/crawl-contensis.js --full            # full DMU crawl + publication scrape
node scripts/fetch-all.js                         # one-off parliamentary + feed fetch
```

> **Contensis discovery first.** Run `node scripts/crawl-contensis.js` (no flag)
> to log all published content type IDs. The crawler then classifies types by
> name (staff/news/course/research/sdg); adjust `services/contensis.js`
> `classify()` if DMU's type names don't match the heuristics.

## Starting the server

```bash
npm start          # http://localhost:3000  (redirects to /digest)
# or
npm run dev        # auto-reload
```

On first launch, if the `academics` table is empty the server kicks off a
Contensis crawl in the background. Scheduled jobs start automatically unless
`DISABLE_CRON=1`.

## Scheduled jobs (node-cron)

| Source | Schedule |
|--------|----------|
| Hansard, Written Questions | daily 07:00 |
| Petitions, EDMs, HE/sector feeds | daily 07:00–07:30 |
| What's On (diary) | every 4 hours |
| Committees | every 6 hours |
| Oral questions rota, Bills, Legislation | weekly Monday |
| Contensis full crawl (staff/courses/research/SDG) | monthly, 1st |

Every run writes a row to `fetch_log` (visible in Admin → Fetch log, with a
per-source "Run now" button).

## Data sources

* **Parliament**: Hansard, Written Questions, Committees, What's On, Oral
  Questions/EDMs, Bills, Divisions, Register of Interests, Petitions APIs, plus
  the egg-timer recess calendar and legislation.gov.uk SI Atom feeds.
* **DMU**: Contensis delivery API (staff, news, courses, research, SDG), the
  academic-staff XML listing, and individual profile-page scraping for
  publication lists.
* **Sector**: THE, HEPI, OfS, UUK, UKRI, Wonkhe, SRHE, plus professional bodies
  and sector outlets (RSS where available, otherwise scraped with a 2s crawl
  delay and Google News RSS fallback).

## Notes

* All API calls send `User-Agent: DMU-ParliamentaryIntelligence/1.0`.
* Parliamentary APIs are rate-limited to ~1 req/s; DMU scraping to 1 req/2s.
* All dates are stored as ISO-8601 strings.
* The Contensis token in `.env.example` is the published, IT-approved delivery
  credential from the project brief.
