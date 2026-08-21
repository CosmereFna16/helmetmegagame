#!/usr/bin/env bash
# Keep every session on master, and take the stale claude/* branches with it.
#
# Lifeweb has no branching workflow at all: work is committed to master and
# pushed so it can be pulled locally straight away (see CLAUDE.md's "Git
# workflow"). Claude Code on the web still hands each session its own
# throwaway claude/<slug> branch, so this hook lands us back on master and
# prunes whatever the old branch-per-session habit left on origin.
#
# Every step is a no-op when it can't be done safely -- the hook never
# discards a commit or a working-tree change, and never deletes a branch
# carrying anything master doesn't already have.

cd "$(dirname "$0")/../.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

git config fetch.prune true
git fetch --quiet origin master 2>/dev/null || exit 0

# --- land on master ------------------------------------------------------
# Only when there is nothing to lose: a clean worktree, and a HEAD holding no
# commits that origin/master doesn't. Anything else is real work in progress
# and is left exactly where it is.
if [ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]; then
  if [ -z "$(git status --porcelain)" ] &&
     [ -z "$(git log --oneline origin/master..HEAD 2>/dev/null)" ]; then
    if git switch --quiet master 2>/dev/null; then
      git merge --quiet --ff-only origin/master 2>/dev/null
      echo "session-start: moved onto master (Lifeweb is master-only)"
    fi
  else
    echo "session-start: staying on $(git rev-parse --abbrev-ref HEAD) -- it has work master doesn't"
  fi
else
  git merge --quiet --ff-only origin/master 2>/dev/null
fi

# --- prune merged claude/* branches on origin ----------------------------
merged=()
kept=()
for ref in $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/claude/*'); do
  branch="${ref#origin/}"
  if [ -z "$(git log --oneline "origin/master..$ref" 2>/dev/null)" ]; then
    merged+=("$branch")
  else
    kept+=("$branch")
  fi
done

if [ ${#merged[@]} -gt 0 ]; then
  if git push --quiet origin --delete "${merged[@]}" 2>/dev/null; then
    echo "session-start: deleted ${#merged[@]} merged branch(es) from origin: ${merged[*]}"
  else
    # Deleting a remote ref needs push rights the sandboxed git proxy in a
    # Claude Code web session doesn't grant -- it 403s where an ordinary push
    # succeeds. Not worth failing over: the same hook run from a local
    # checkout cleans them up.
    echo "session-start: could not delete ${merged[*]} (no ref-delete rights here); run this hook locally"
  fi
fi

if [ ${#kept[@]} -gt 0 ]; then
  echo "session-start: kept ${#kept[@]} unmerged branch(es): ${kept[*]}"
fi

exit 0
