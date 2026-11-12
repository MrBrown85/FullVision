#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist

# Root-level public files
cp index.html launch.html login.html login.css login-auth.js privacy.html dist/
cp manifest.json sw.js dist/
cp favicon.svg dist/
cp curriculum_data.js curriculum_by_course.json curriculum_crosswalk.json dist/
cp roster-template.csv _headers dist/

# App directories
cp -r teacher teacher-mobile shared vendor dist/

# The splash page's screenshots (index.html)
cp -r assets dist/

# The student phone page (fullvision.ca/s/#CODE)
cp -r s dist/

# The help site (fullvision.ca/help): pages built from help/articles/*.md.
# The built pages aren't in the repo; only the Markdown and pictures are.
node scripts/build-help.mjs
mkdir -p dist/help
cp -r help/img help/fragments help/*.html help/index.json dist/help/

# A fresh service-worker cache per deploy: name it after the commit Netlify
# is building (COMMIT_REF), falling back to the build time elsewhere.
CACHE_ID="${COMMIT_REF:-$(date +%s)}"
sed -i.bak "s/const CACHE_NAME = '[^']*';/const CACHE_NAME = 'fullvision-${CACHE_ID:0:12}';/" dist/sw.js
rm -f dist/sw.js.bak
grep -q "const CACHE_NAME = 'fullvision-${CACHE_ID:0:12}';" dist/sw.js
