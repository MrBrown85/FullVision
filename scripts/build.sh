#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist

# Root-level public files
cp index.html login.html login.css login-auth.js dist/
cp manifest.json sw.js dist/
[ -f favicon.svg ] && cp favicon.svg dist/ || true
[ -f robots.txt ] && cp robots.txt dist/ || true
cp curriculum_data.js curriculum_by_course.json dist/
cp roster-template.csv _headers dist/

# App directories
cp -r teacher teacher-mobile shared vendor dist/

# Future portals (copy if they exist)
[ -d student ] && cp -r student dist/ || true
[ -d parent ] && cp -r parent dist/ || true

# A fresh service-worker cache per deploy: name it after the commit Netlify
# is building (COMMIT_REF), falling back to the build time elsewhere.
CACHE_ID="${COMMIT_REF:-$(date +%s)}"
sed -i.bak "s/const CACHE_NAME = '[^']*';/const CACHE_NAME = 'fullvision-${CACHE_ID:0:12}';/" dist/sw.js
rm -f dist/sw.js.bak
grep -q "const CACHE_NAME = 'fullvision-${CACHE_ID:0:12}';" dist/sw.js
