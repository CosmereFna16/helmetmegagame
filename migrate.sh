#!/bin/bash
set -a
source .env
set +a
npm run db:migrate:deploy
