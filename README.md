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
| This week | `/action` | Consolidated urgency dashboard — closing committee/consultation deadlines and oral-question cut-offs (RAG-coded), what's new, follow-ups due, plus an on-demand Claude weekly briefing for the SLT. |
| Daily digest | `/digest` | Parliamentary items grouped by topic, with matched academics, matched courses, and Draft / Find-experts actions. New-inquiry banners. |
| Parliamentary diary | `/diary` | Week-at-a-glance calendar from the What's On API, recess-aware, oral-question deadline countdowns. |
| Committee tracker | `/committees` | Open inquiries sorted by deadline, RAG-coded working days, matched academics, submission tracker. |
| Consultations | `/consultations` | Open government consultations (GOV.UK Search API), RAG-coded deadlines, matched academics, response tracker, draft button. |
| Sector watch | `/sector` | HE news, professional bodies, outlets, legislation, bills, EDMs, petitions. |
| MP tracker | `/mps` | Browse/search 622 MPs, engagement log, recent contributions, voting record, declared interests. |
| Engagement | `/engagement` | Follow-ups due, a relevance-ranked target list of MPs active on our topics we've never contacted (CSV export), and stale relationships to re-engage. |
| APPGs | `/appgs` | All-Party Parliamentary Groups whose subject matches DMU topics, with officer MPs linked as an engagement route (scraped register — no API). |
| Academic finder | `/academics` | FTS5 full-text search across profiles, publications, departments. |
| Drafts | `/drafts` | History of every generated/edited draft with a status workflow (generated → edited → approved → sent), inline editing, and .docx export. |
| Admin | `/admin` | Keyword groups, professional-body mappings, fetch log, DMU context, manual refresh. |

Every item is also matched to **relevant DMU courses and upcoming DMU events**
(e.g. a conference on knife crime shown as context against a related committee
inquiry), surfaced in the item cards and folded into the drafting prompt.

Two-tier academic matching:
* **Tier 1** — fast keyword scoring, runs automatically on every new item.
* **Tier 2** — semantic matching via the Claude API ("Find experts"), cached 7 days.

Drafting panel (Claude API) generates: media quote, press response, briefing
note, committee submission opening, or a personalised MP engagement email. Every
generation is saved to the **Drafts** history (versioned), editable, with a
status workflow and one-click **.docx export** for committee submissions.

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
| `GUARDIAN_API_KEY` | Guardian Open Platform key (optional sector source). |
| `TWFY_API_KEY` | TheyWorkForYou key (optional MP intelligence). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `DIGEST_TO` / `DIGEST_FROM` | Morning email digest (optional). |
| `ANTHROPIC_API_KEY` | Claude API key — required for Find-experts and drafting. |
| `CLAUDE_MODEL` | Claude model id (default `claude-sonnet-4-20250514`). |

All optional keys skip gracefully when unset (logged in Admin → Fetch log) — the
app runs fine without them.

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
| Petitions, EDMs, HE/sector feeds, Guardian API | daily 07:00–07:40 |
| Morning email digest | daily 07:50 |
| What's On (diary) | every 4 hours |
| Committees, GOV.UK consultations | every 6 hours |
| Oral questions rota, Bills, Legislation, DMU events | weekly Monday |
| Contensis full crawl (staff/courses/research/SDG) | monthly, 1st |

Every run writes a row to `fetch_log` (visible in Admin → Fetch log, with a
per-source "Run now" button).

## Data sources

* **Parliament**: Hansard, Written Questions, Committees, What's On, Oral
  Questions/EDMs, Bills, Divisions, Register of Interests, Petitions APIs, plus
  the egg-timer recess calendar and legislation.gov.uk SI Atom feeds.
* **DMU**: Contensis delivery API (staff, news, courses, research, SDG), the
  academic-staff XML listing, and individual profile-page scraping for
  publication lists. The `staffXml` source cross-references the XML listing to
  capture staff missing from Contensis (as stubs the scraper later enriches) and
  reconciles the legacy Access academics against the live data — Contensis always
  takes precedence; each record's provenance is shown in the expert finder.
* **Briefings**: House of Commons Library research briefings and POST POSTnotes
  (RSS, Google News fallback) — neutral expert analysis, relevance-gated and
  matched to academics (Sector watch → Library & POST).
* **APPGs**: the All-Party Parliamentary Group register (scraped — no API);
  relevant groups' officer MPs become an engagement route.
* **Government**: GOV.UK Search API (open consultations → Consultations tracker;
  announcements/policy papers → Sector watch "Government" tab).
* **Sector**: THE, HEPI, OfS, UUK, UKRI, Wonkhe, SRHE, the Guardian Open
  Platform (keyword-queried), plus professional bodies and sector outlets (RSS
  where available, otherwise scraped with a 2s crawl delay and Google News RSS
  fallback).
* **Think tanks**: ~170 UK think tanks scanned (RSS → scrape → Google News
  fallback) with feed auto-validation and an adaptive cadence that backs off
  sources that never produce relevant hits. Every report passes the keyword
  prefilter at ingest and the contextual relevance gate in the background, so
  only reports genuinely relevant to DMU surface (Sector watch → Think tanks).
* **MP intelligence**: Parliament Members API (portrait + active-status
  reconciliation, also available as the `mpRefresh` manual source in Admin) and
  TheyWorkForYou (voting summaries / positions) on the MP profile.

## Notes

* All API calls send `User-Agent: DMU-ParliamentaryIntelligence/1.0`.
* Parliamentary APIs are rate-limited to ~1 req/s; DMU scraping to 1 req/2s.
* All dates are stored as ISO-8601 strings.
* The Contensis token in `.env.example` is the published, IT-approved delivery
  credential from the project brief.
