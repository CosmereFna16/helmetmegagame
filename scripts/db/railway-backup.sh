#!/usr/bin/env bash
# Take a Railway volume backup of the production Postgres right now, through
# Railway's GraphQL API. Run by hand (`npm run db:backup`) and by migrate.sh
# before every `prisma migrate deploy`.
#
# Needs RAILWAY_API_TOKEN in the root .env: an *account* token from
# railway.com/account/tokens. The CLI's login session cannot call the backup
# endpoints, and a project token cannot either.
#
#   npm run db:backup                  # one backup, named with the timestamp
#   npm run db:backup -- --schedule    # also (re)assert the DAILY + WEEKLY schedule
#   npm run db:backup -- --list        # print existing backups and exit
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; [ -f .env ] && source .env; set +a

: "${RAILWAY_API_TOKEN:?RAILWAY_API_TOKEN is not set. Create an account token at https://railway.com/account/tokens and put it in .env}"
VOLUME_INSTANCE_ID="${RAILWAY_VOLUME_INSTANCE_ID:-b467d56d-a54f-4a95-92e9-5a0ccb2b9a66}"
API=https://backboard.railway.com/graphql/v2

gql() {
  curl -sS "$API" -H "Authorization: Bearer $RAILWAY_API_TOKEN" -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1")"
}

check() {
  if printf '%s' "$1" | grep -q '"errors"'; then
    echo "railway-backup: API error: $1" >&2
    exit 1
  fi
}

if [ "${1:-}" = "--list" ]; then
  out=$(gql "{ volumeInstanceBackupList(volumeInstanceId:\"$VOLUME_INSTANCE_ID\") { id name createdAt usedMB } }")
  check "$out"; echo "$out" | python3 -m json.tool; exit 0
fi

if [ "${1:-}" = "--schedule" ]; then
  out=$(gql "mutation { volumeInstanceBackupScheduleUpdate(volumeInstanceId:\"$VOLUME_INSTANCE_ID\", kinds:[DAILY, WEEKLY]) }")
  check "$out"; echo "railway-backup: schedule set to DAILY + WEEKLY"
fi

name="manual $(date -u +%Y-%m-%dT%H:%MZ)"
out=$(gql "mutation { volumeInstanceBackupCreate(volumeInstanceId:\"$VOLUME_INSTANCE_ID\", name:\"$name\") { workflowId } }")
check "$out"
echo "railway-backup: started backup \"$name\" ($(echo "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["volumeInstanceBackupCreate"]["workflowId"])'))"
