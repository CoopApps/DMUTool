'use strict';

/**
 * Access database migration. Uses mdbtools (mdb-export) to export the relevant
 * tables from the .accdb file, then cleans, normalises, deduplicates and
 * imports them into SQLite.
 *
 *   node scripts/migrate.js /path/to/MP_Contact_Database__DESIGN__Backup.accdb
 *
 * Falls back to ACCESS_DB_PATH from the environment if no path is given.
 */

require('dotenv').config();
const { execFileSync } = require('child_process');
const { db, init, run, get } = require('../db/database');

const accdb = process.argv[2] || process.env.ACCESS_DB_PATH;
if (!accdb) {
  console.error('Usage: node scripts/migrate.js /path/to/file.accdb  (or set ACCESS_DB_PATH)');
  process.exit(1);
}

/** Export a table to an array of row objects via mdb-export CSV. */
function exportTable(table) {
  let csv;
  try {
    csv = execFileSync('mdb-export', [accdb, table], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`mdb-export failed for "${table}" — is mdbtools installed? (${e.message})`);
  }
  return parseCsv(csv);
}

/** Minimal RFC4180-ish CSV parser (handles quoted fields and embedded commas/newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(obj).find((kk) => kk.toLowerCase().replace(/[^a-z]/g, '') === k.toLowerCase().replace(/[^a-z]/g, ''));
    if (hit && obj[hit] !== '') return obj[hit];
  }
  return null;
};
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const lowerEmail = (e) => (e ? e.toLowerCase().trim() : null);
const toIso = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed) ? d : parsed.toISOString();
};
const truthy = (v) => /^(1|true|yes|y|-1)$/i.test(String(v || '').trim()) ? 1 : 0;

function importMps() {
  const rows = exportTable('mpT');
  const seen = new Set();
  let n = 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO mps
    (id, first_name, last_name, party, constituency, email, phone, photo_url, notes, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const first = pick(r, 'FirstName', 'First Name');
      const last = pick(r, 'LastName', 'Last Name', 'Surname');
      const constituency = pick(r, 'Constituency');
      const key = `${norm(first)} ${norm(last)}|${norm(constituency)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stmt.run(
        parseInt(pick(r, 'ID'), 10) || null,
        first, last, pick(r, 'Party'), constituency,
        lowerEmail(pick(r, 'EmailAddress', 'Email Address', 'Email')),
        pick(r, 'Phone', 'Telephone'),
        pick(r, 'Photo', 'PhotoURL', 'Photo URL'),
        pick(r, 'Notes'),
        pick(r, 'IsActive') != null ? truthy(pick(r, 'IsActive')) : 1
      );
      n++;
    }
  });
  tx();
  return n;
}

function importContacts() {
  const rows = exportTable('ContactT');
  let n = 0;
  const stmt = db.prepare(`INSERT INTO engagement_log
    (mp_id, date, type, description, notes, followup) VALUES (?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        parseInt(pick(r, 'CustomerID', 'MPID', 'mp_id', 'ID'), 10) || null,
        toIso(pick(r, 'ContactDate', 'Date')),
        pick(r, 'Type', 'ContactType') || 'contact',
        pick(r, 'Description'),
        pick(r, 'Notes'),
        truthy(pick(r, 'Followup', 'Follow up'))
      );
      n++;
    }
  });
  tx();
  return n;
}

function importAcademicsLegacy() {
  let rows = [];
  for (const t of ['Academics2', 'Test']) {
    try { rows = rows.concat(exportTable(t)); } catch (e) { console.warn(`  (skipping ${t}: ${e.message})`); }
  }
  let n = 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO academics_legacy
    (id, name, title, department, interest_a, interest_b, interest_c, email, phone, profile_url, norm_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = pick(r, 'Name', 'FullName');
      stmt.run(
        parseInt(pick(r, 'ID'), 10) || null,
        name, pick(r, 'Title'), pick(r, 'Department'),
        pick(r, 'Interest_A', 'InterestA'), pick(r, 'Interest_B', 'InterestB'), pick(r, 'Interest_C', 'InterestC'),
        lowerEmail(pick(r, 'EmailAddress', 'Email_Address', 'Email')),
        pick(r, 'PhoneNumber', 'Phone_Number', 'Phone'),
        pick(r, 'ProfileURL', 'Profile URL', 'Profile_URL'),
        norm(name)
      );
      n++;
    }
  });
  tx();
  return n;
}

function main() {
  init();
  console.log(`Migrating from ${accdb}`);
  const mps = importMps();
  console.log(`  mps imported:              ${mps}`);
  const contacts = importContacts();
  console.log(`  engagement_log imported:   ${contacts}`);
  const legacy = importAcademicsLegacy();
  console.log(`  academics_legacy imported: ${legacy}`);
  console.log('Migration complete.');
}

main();
