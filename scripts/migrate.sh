#!/bin/bash
# First-time setup migration. Requires mdbtools installed (mdb-export).
#
# Usage: scripts/migrate.sh /path/to/MP_Contact_Database__DESIGN__Backup.accdb
set -euo pipefail

ACCDB="${1:-${ACCESS_DB_PATH:-MP_Contact_Database__DESIGN__Backup.accdb}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Seeding reference data"
node "$ROOT/db/seed.js"

echo "==> Importing Access database: $ACCDB"
node "$ROOT/scripts/migrate.js" "$ACCDB"

echo "==> Crawling Contensis (DMU content)"
node "$ROOT/scripts/crawl-contensis.js" --full || echo "(Contensis crawl skipped/failed — continuing)"

echo "==> Initial parliamentary data fetch"
node "$ROOT/scripts/fetch-all.js" || echo "(Initial fetch had errors — see fetch_log)"

echo "Migration complete"
