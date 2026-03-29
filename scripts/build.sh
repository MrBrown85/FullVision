#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist

# Root-level public files
cp index.html login.html login.css dist/
cp favicon.svg manifest.json sw.js robots.txt dist/
cp curriculum_data.js curriculum_by_course.json dist/
cp roster-template.csv _headers dist/

# App directories
cp -r teacher teacher-mobile shared vendor dist/

# Future portals (copy if they exist)
[ -d student ] && cp -r student dist/ || true
[ -d parent ] && cp -r parent dist/ || true
