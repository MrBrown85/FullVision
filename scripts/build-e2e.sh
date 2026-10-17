#!/usr/bin/env bash
# Build dist/ and substitute the __SUPABASE_URL__ / __SUPABASE_KEY__ placeholders
# with syntactically-valid dummy values so the Supabase client initializes
# without error. E2E tests that need real auth behavior should use helpers.js
# `mockAuth`, which replaces the client with a fake before any RPC fires.
#
# Used by Playwright's webServer (playwright.config.js), which serves dist/
# through scripts/e2e-server.mjs. That server runs the production inject-env
# edge function, which also substitutes these placeholders and adds the nonce
# CSP; substituting here keeps dist/ usable with a plain static server too.
set -euo pipefail

bash "$(dirname "$0")/build.sh"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMMY_URL="https://e2e-test.supabase.co"
DUMMY_KEY="e2e-test-anon-key"

# -i.bak works with both GNU sed (Linux CI) and BSD sed (macOS); -i '' is BSD-only.
find "$ROOT/dist" -name "*.html" -exec sed -i.bak \
  "s|__SUPABASE_URL__|$DUMMY_URL|g; s|__SUPABASE_KEY__|$DUMMY_KEY|g" {} \;
find "$ROOT/dist" -name "*.html.bak" -delete

echo "E2E build ready at dist/ with dummy credentials substituted."
