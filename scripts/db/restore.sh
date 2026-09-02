#!/usr/bin/env bash
# Restore a pg_dump custom-format file into a database. Needs pg_restore on
# PATH (brew install libpq, then add its bin to PATH).
#
#   scripts/db/restore.sh backups/2026-09-02.dump postgresql://user:pw@host:port/db
#
# Refuses a Railway host unless FORCE_PROD=1 is set, so a rehearsal against a
# local Postgres cannot land on production by a slip of the paste buffer.
set -euo pipefail
dump="${1:?usage: restore.sh <dump-file> <database-url>}"
url="${2:?usage: restore.sh <dump-file> <database-url>}"
[ -f "$dump" ] || { echo "restore: no such file $dump" >&2; exit 1; }
case "$url" in
  *rlwy.net*|*railway*)
    [ "${FORCE_PROD:-}" = "1" ] || { echo "restore: target looks like Railway. Set FORCE_PROD=1 if you really mean production." >&2; exit 2; }
    ;;
esac
command -v pg_restore >/dev/null || { echo "restore: pg_restore not on PATH (brew install libpq)" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$url" "$dump"
echo "restore: done"
