#!/usr/bin/env sh
set -eu
test "$VERCEL_ENV" = preview
test "$VERCEL_GIT_COMMIT_REF" = test/asaas-vercel-neon
NC_TEST_NEON=1 node --import tsx --test tests/homologation/production-inbox-network.mjs
npm run build
