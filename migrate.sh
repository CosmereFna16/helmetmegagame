#!/bin/bash
# Apply pending migrations to production, after a Railway backup.
set -a
source .env
set +a
if [ -n "$RAILWAY_API_TOKEN" ]; then
  bash scripts/db/railway-backup.sh || { echo "migrate.sh: backup failed, not migrating" >&2; exit 1; }
else
  echo "migrate.sh: RAILWAY_API_TOKEN not set, skipping the pre-migration backup" >&2
fi
npm run db:migrate:deploy
