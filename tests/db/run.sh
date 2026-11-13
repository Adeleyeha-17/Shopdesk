#!/usr/bin/env bash
# Database tests: a fresh database gets the Supabase stand-ins (stubs.sql), the full schema, then every test file.
# Each file's output, with ids, times and dates masked, must match tests/db/expected/<name>.txt exactly.
#   tests/db/run.sh            check against the expected output
#   tests/db/run.sh --update   rewrite the expected output after an intended change (review the diff before committing)
# Connection settings come from the usual PGHOST / PGPORT / PGUSER / PGPASSWORD variables.
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-shopdesk_test}
FILES=(orders problems chat fair email options report ratings money nudges live visits shopdesk_chat)
mkdir -p out expected

# fixed locale and time zone, so sorting and dates read the same on every machine
PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "drop database if exists $DB" \
  -c "create database $DB template template0 encoding 'UTF8' locale 'C.UTF-8'" \
  -c "alter database $DB set timezone to 'Africa/Lagos'" >/dev/null
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f stubs.sql >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -d "$DB" -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql >/dev/null

mask() {
  sed -E \
    -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<id>/g' \
    -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}(:?[0-9]{2})?)?/<time>/g' \
    -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/<date>/g' \
    -e 's/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),? [0-9]{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/<day>/g' \
    -e 's/[0-9]{1,2}(:[0-9]{2})?(am|pm)/<clock>/g' \
    -e 's/line [0-9]+/line N/g'
}

failed=0
for f in "${FILES[@]}"; do
  psql -d "$DB" -X -f "$f.sql" 2>&1 | mask > "out/$f.txt"
  if [[ "${1:-}" == "--update" ]]; then
    cp "out/$f.txt" "expected/$f.txt"
    echo "updated expected/$f.txt"
  elif diff -u "expected/$f.txt" "out/$f.txt" > "out/$f.diff"; then
    echo "pass  $f"
  else
    echo "FAIL  $f"; cat "out/$f.diff"; failed=1
  fi
done
exit $failed
