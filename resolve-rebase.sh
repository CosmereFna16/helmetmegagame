#!/bin/bash
set -e
cd /Users/local-ra33478/lifeweb
git add db/index.js CLAUDE.md db/prisma/schema.prisma docs/tags.yaml
git rebase --continue
