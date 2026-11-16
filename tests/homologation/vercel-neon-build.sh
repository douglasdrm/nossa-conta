#!/usr/bin/env sh
set -eu
test "$VERCEL_ENV" = preview
test "$VERCEL_GIT_COMMIT_REF" = test/asaas-vercel-neon
driver_dir="$(mktemp -d)"
trap 'rm -rf "$driver_dir"' EXIT
npm install --prefix "$driver_dir" --no-audit --no-fund --ignore-scripts pg@8.16.3
NODE_PATH="$driver_dir/node_modules" NC_TEST_NEON=1 node --import tsx --test tests/homologation/production-inbox-network.mjs
npm run build
