// scripts/lint-ratchet.mjs: the files where an undefined name fails the build
// (plan item S19-D15). Every other file and rule stays a warning.
//
// A covered file is checked against the globals that BOTH pages loading it
// define (teacher/app.html and teacher-mobile/index.html), not the union, so a
// name defined only in a desktop script is an error: on the phone it would be
// a ReferenceError. Names a file uses only behind a `typeof X` guard are listed
// with the file; they were checked by reading the code.
//
//   node scripts/lint-ratchet.mjs                       lint the covered files
//   node scripts/lint-ratchet.mjs --stdin-filename F    lint stdin as file F
//
// Exits 1 on any error. Warnings (no-unused-vars) are not shown and never fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// To add a file: `npx eslint <file>` shows no no-undef warning, then add it
// here with the desktop-only names it uses behind a typeof guard (often none).
export const NO_UNDEF_FILES = {
  'shared/data.js': ['refreshSyncStatusUI', 'showSyncToast', 'Router'],
  'shared/data-assessments.js': [],
  'shared/data-categories.js': [],
  'shared/data-config-settings.js': [],
  'shared/data-courses-terms.js': ['reportingTermsSchoolMatch'],
  'shared/data-curriculum-index.js': [],
  'shared/data-demo.js': [],
  'shared/data-feedback-live.js': [],
  'shared/data-learning-map.js': ['showSyncToast'],
  'shared/data-markup.js': [],
  'shared/data-observations.js': [],
  'shared/data-overrides.js': [],
  'shared/data-profile-summaries.js': [],
  'shared/data-reflect.js': [],
  'shared/data-revisions.js': [],
  'shared/data-roster.js': [],
  'shared/data-rpc-wrappers.js': [],
  'shared/data-rubrics.js': ['showSyncToast'],
  'shared/data-student-cards.js': [],
  'shared/data-student-records.js': [],
  'shared/data-student-work.js': [],
  'shared/data-term-ratings.js': [],
  'shared/data-utilities.js': [],
  'shared/data-withdrawn.js': [],
};

// The globals a covered file may use: those every page loading it defines,
// plus its guarded names. Used by eslint.config.mjs.
export function strictGlobals(file, byFile, pages) {
  const pageNames = byFile[file] || [];
  if (!pageNames.length) return null;
  const sets = pageNames.map(p => pages[p].globals);
  const out = {};
  for (const name of Object.keys(sets[0])) if (sets.every(s => name in s)) out[name] = 'writable';
  for (const name of NO_UNDEF_FILES[file] || []) out[name] = 'readonly';
  return out;
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { ESLint } = await import('eslint');
  const { pageGlobals } = await import('./lint-globals.mjs');
  const eslint = new ESLint({ cwd: root });

  const { byFile } = pageGlobals(root);
  const unloaded = Object.keys(NO_UNDEF_FILES).filter(f => !(byFile[f] || []).length);
  if (unloaded.length) {
    console.error('No page loads these covered files (remove them from scripts/lint-ratchet.mjs):');
    for (const f of unloaded) console.error('  ' + f);
    return 1;
  }

  let results;
  const i = argv.indexOf('--stdin-filename');
  if (i >= 0) {
    const file = argv[i + 1];
    if (!NO_UNDEF_FILES[file]) {
      console.error(`${file} is not a covered file.`);
      return 1;
    }
    results = await eslint.lintText(fs.readFileSync(0, 'utf8'), { filePath: path.join(root, file) });
  } else {
    results = await eslint.lintFiles(Object.keys(NO_UNDEF_FILES).map(f => path.join(root, f)));
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
