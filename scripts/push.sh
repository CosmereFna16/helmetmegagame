#!/usr/bin/env bash
# npm run push -- "Subject" "note" "note" [--hidden]
#
# Stage everything, write the changelog entry into the same commit, push, then
# announce that entry to Discord. The first argument is the heading; every plain
# argument after it is one changelog note, in plain language for the GMs.
#
#   npm run push -- "Laboring wears the good spots out" \
#     "The best labor Locations now drift down as they are worked" \
#     "+A Labor? button in #turns"
#
# --hidden writes nothing and announces nothing. --tell-gms overrides the lore /
# antagonist hold-back. See scripts/changelog/log.js.
set -euo pipefail
cd "$(dirname "$0")/.."

subject=""
notes=()
flags=()

for arg in "$@"; do
  case "$arg" in
    --hidden|--secret|--tell-gms) flags+=("$arg") ;;
    *)
      if [ -z "$subject" ]; then subject="$arg"; else notes+=(--note "$arg"); fi
      ;;
  esac
done

subject="${subject:-wip}"

git add -A
node scripts/changelog/log.js --staged --message "$subject" \
  ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
git add CHANGELOG.md
git diff --cached --quiet || git commit -m "$subject"
git push -u origin master
node scripts/changelog/log.js --announce --message "$subject" \
  ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
