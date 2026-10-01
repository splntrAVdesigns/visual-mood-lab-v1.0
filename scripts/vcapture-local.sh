#!/usr/bin/env bash
# Dedicated local database and local uploads; never runs remote migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL=''
export BLOB_READ_WRITE_TOKEN=''
export BLOB_PUBLIC_BASE=''
export VERCEL=''
export PGLITE_DIR='./.pglite-vcapture-test'
export AUTH_SECRET='vml-local-vcapture-test-only-do-not-use-in-production'
export AUTH_URL='http://localhost:3000'
export APP_URL='http://localhost:3000'
export AUTH_TRUST_HOST='true'
# Keep signup/reset mail within the local development log.
export RESEND_API_KEY=''
case "${1:-dev}" in
  setup) node --import tsx scripts/migrate.ts; node --import tsx scripts/seed.ts ;;
  dev) exec npm run dev ;;
  *) echo 'Usage: bash scripts/vcapture-local.sh setup|dev' >&2; exit 1 ;;
esac
