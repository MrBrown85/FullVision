// scripts/lint-ratchet.mjs: the files where an undefined name fails the build
// (plan item S19-D15). Every other file and rule stays a warning.
//
// A covered file may use, unguarded, only the names that a <script> tag
// defines on EVERY page loading it (teacher/app.html and
// teacher-mobile/index.html). A name from a desktop-only script, or from a
// script a page loads on demand (shared/seed-data.js, curriculum_data.js, the
// banks, Reports' scripts), is allowed only behind a `typeof` guard; the rule
// is in scripts/lint-guarded-globals.mjs. The on-demand scripts are read from
// the code by scripts/lint-globals.mjs (runtimeScriptsOf).
//
//   node scripts/lint-ratchet.mjs                       lint the covered files
//   node scripts/lint-ratchet.mjs --stdin-filename F    lint stdin as file F
//
// Exits 1 on any error. Warnings (no-unused-vars) are not shown and never fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// To add a file: `npm run lint:ratchet` after adding it here must pass.
export const NO_UNDEF_FILES = [
  'shared/data.js',
  'shared/data-assessments.js',
  'shared/data-categories.js',
  'shared/data-config-settings.js',
  'shared/data-courses-terms.js',
  'shared/data-curriculum-index.js',
  'shared/data-demo.js',
  'shared/data-feedback-live.js',
  'shared/data-learning-map.js',
  'shared/data-markup.js',
  'shared/data-observations.js',
  'shared/data-overrides.js',
  'shared/data-profile-summaries.js',
  'shared/data-reflect.js',
  'shared/data-revisions.js',
  'shared/data-roster.js',
  'shared/data-rpc-wrappers.js',
  'shared/data-rubrics.js',
  'shared/data-student-cards.js',
  'shared/data-student-records.js',
  'shared/data-student-work.js',
  'shared/data-term-ratings.js',
  'shared/data-utilities.js',
  'shared/data-withdrawn.js',
  'shared/overwrite-count.js',
];

const PAGE_NAMES = {
  desktop: 'the desktop',
  phone: 'the phone',
  student: 'the student page',
  login: 'the sign-in page',
};

// The globals a covered file may use unguarded: those a <script> tag defines
// on every page that loads it. Used by eslint.config.mjs.
export function strictGlobals(file, byFile, pages) {
  const pageNames = byFile[file] || [];
  if (!pageNames.length) return null;
  const sets = pageNames.map(p => pages[p].tagGlobals);
  const out = {};
  for (const name of Object.keys(sets[0])) if (sets.every(s => name in s)) out[name] = 'writable';
  return out;
}

// The names some page loading the file defines but not every page's tags:
// each with a sentence on where it comes from, for the rule's message.
export function guardedWhere(file, byFile, pages) {
  const pageNames = byFile[file] || [];
  const strict = strictGlobals(file, byFile, pages) || {};
  const names = new Set();
  for (const p of pageNames) {
    for (const n of Object.keys(pages[p].globals)) names.add(n);
    for (const n of Object.keys(pages[p].runtimeDefinedIn)) names.add(n);
  }
  const where = {};
  for (const name of names) {
    if (name in strict) continue;
    const parts = [];
    for (const p of pageNames) {
      const P = pages[p];
      if (name in P.tagGlobals) {
        const from = (P.definedIn[name] || []).filter(f => P.scripts.includes(f));
        parts.push(`${PAGE_NAMES[p]} loads it from ${from[0]}`);
        continue;
      }
      const lazy = P.runtimeDefinedIn[name] || (P.definedIn[name] || []).filter(f => P.lazy.includes(f));
      parts.push(
        lazy.length
          ? `on ${PAGE_NAMES[p]} it comes from ${lazy[0]}, which loads only on demand`
          : `${PAGE_NAMES[p]} does not load it`,
      );
    }
    where[name] = parts.join('; ') + '.';
  }
  return where;
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { ESLint } = await import('eslint');
  const { pageGlobals } = await import('./lint-globals.mjs');
  const eslint = new ESLint({ cwd: root });

  const { byFile } = pageGlobals(root);
  const unloaded = NO_UNDEF_FILES.filter(f => !(byFile[f] || []).length);
  if (unloaded.length) {
    console.error('No page loads these covered files (remove them from scripts/lint-ratchet.mjs):');
    for (const f of unloaded) console.error('  ' + f);
    return 1;
  }

  let results;
  const i = argv.indexOf('--stdin-filename');
  if (i >= 0) {
    const file = argv[i + 1];
    if (!NO_UNDEF_FILES.includes(file)) {
      console.error(`${file} is not a covered file.`);
      return 1;
    }
    results = await eslint.lintText(fs.readFileSync(0, 'utf8'), { filePath: path.join(root, file) });
  } else {
    results = await eslint.lintFiles(NO_UNDEF_FILES.map(f => path.join(root, f)));
  }

  const errors = ESLint.getErrorResults(results);
  const count = errors.reduce((n, r) => n + r.errorCount, 0);
  if (count) {
    const formatter = await eslint.loadFormatter('stylish');
    console.log(await formatter.format(errors));
    return 1;
  }
  console.log(`No undefined names in ${results.length} covered file(s).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Not a top-level await: eslint.config.mjs imports this module, and an
  // await here would leave that import waiting on itself.
  main(process.argv.slice(2)).then(code => (process.exitCode = code));
}
