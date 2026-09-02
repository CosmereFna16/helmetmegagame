#!/usr/bin/env python3
# PreToolUse hook on Bash: refuse the Prisma verbs that can reset a database
# when the target is Railway. `prisma migrate dev` offers a full reset on
# drift, `migrate reset` and `db push --force-reset` just do it, and
# `npm run db:migrate` is `migrate dev`. Game one ended that way on day 10.
#
# Reads the tool call as JSON on stdin; prints a reason and exits 2 to block.
# Heredoc bodies are ignored so a script that merely *writes about* the verb
# (a doc edit) is not mistaken for one that runs it.
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def strip_heredocs(s):
    out, lines, i = [], s.split("\n"), 0
    while i < len(lines):
        m = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", lines[i])
        out.append(lines[i])
        i += 1
        if m:
            term = m.group(1)
            while i < len(lines) and lines[i].strip() != term:
                i += 1
            i += 1
    return "\n".join(out)


def main():
    try:
        cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
    except Exception:
        return 0
    c = strip_heredocs(cmd)
    # A commit message that talks about the verb is not a run of it.
    c = re.sub(r"(-m|--message)(\s+|=)(\"[^\"]*\"|'[^']*')", r"\1\2''", c)

    verb = None
    if re.search(r"npm\s+run\s+db:migrate(\s|$)", c):
        verb = "npm run db:migrate"
    else:
        m = re.search(r"prisma\s+(migrate\s+(dev|reset)|db\s+push)", c)
        if m:
            verb = m.group(0)
    if not verb:
        return 0

    m = re.search(r"DATABASE_URL=(\S+)", c)
    url = m.group(1) if m else ""
    if not url:
        try:
            with open(os.path.join(ROOT, ".env")) as f:
                for line in f:
                    if line.startswith("DATABASE_URL="):
                        url = line.split("=", 1)[1].strip().strip("\"'")
                        break
        except OSError:
            pass

    if "rlwy.net" in url or "railway" in url:
        sys.stderr.write(
            f"prisma-guard: refused. '{verb}' against a Railway database can reset it. "
            "Author migrations against a local Postgres and apply with "
            "'npm run db:migrate:deploy' (./migrate.sh).\n"
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
