// scripts/typecheck-ratchet.mjs: type checking only gets wider (incremental type checks).
//
// A file is type-checked only when its first line is `// @ts-check` AND it is
// in tsconfig.json "files". This guard keeps two lists in
// scripts/typecheck-ratchet.json:
//   checked         every file checked today. It may not lose its comment,
//                   leave tsconfig.json, or disappear without leaving the list.
//   notYetChecked   every other .js file under shared/, teacher/,
//                   teacher-mobile/ and s/. This list may only shrink.
// A new .js file under those folders must start with `// @ts-check`, be in
// tsconfig.json, and be on the checked list.
//
// Exempt (on neither list): curriculum and comment banks, the demo class and
// minified files. They are data, so types add nothing. Same list as
// tests/file-size.test.js.
//
//   node scripts/typecheck-ratchet.mjs        check; exit 1 with a message per problem
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRS = ['shared', 'teacher', 'teacher-mobile', 's'];
export const EXEMPT = [
  /^shared\/bank-[^/]*\.js$/,
  /^shared\/comment-bank\.js$/,
  /^shared\/seed-data\.js$/,
  /\.min\.js$/,
];

const hasTsCheck = firstLine => firstLine.replace(/^﻿/, '').trim() === '// @ts-check';

// checked, notYetChecked: arrays of paths. files: [{ path, firstLine }] for every
// .js file on disk under DIRS. tsconfigFiles: the "files" array of tsconfig.json.
// Returns an array of plain-language problems; empty means clean.
export function findProblems({ checked, notYetChecked, files, tsconfigFiles }) {
  const problems = [];
  const onDisk = new Map(files.filter(f => !EXEMPT.some(re => re.test(f.path))).map(f => [f.path, f.firstLine]));
  const inTsconfig = new Set(tsconfigFiles);
  const checkedSet = new Set(checked);
  const notYetSet = new Set(notYetChecked);

  for (const file of checked) {
    if (!onDisk.has(file)) {
      problems.push(
        `${file} is on the checked list but no longer exists. If it was deleted or renamed on purpose, remove it from the list in scripts/typecheck-ratchet.json in the same change.`,
      );
      continue;
    }
    if (!hasTsCheck(onDisk.get(file))) {
      problems.push(
        `${file} lost its // @ts-check line. Put // @ts-check back on the first line; checked files stay checked.`,
      );
    }
    if (!inTsconfig.has(file)) {
      problems.push(
        `${file} is no longer in the "files" list of tsconfig.json. Add it back; checked files stay checked.`,
      );
    }
  }

  for (const file of notYetChecked) {
    if (!onDisk.has(file)) {
      problems.push(
        `${file} is on the not-yet-checked list but no longer exists. Remove it from the list in scripts/typecheck-ratchet.json.`,
      );
    } else if (hasTsCheck(onDisk.get(file)) && inTsconfig.has(file)) {
      problems.push(
        `${file} is now type-checked. Move it from "notYetChecked" to "checked" in scripts/typecheck-ratchet.json.`,
      );
    }
  }

  for (const [file, firstLine] of onDisk) {
    if (checkedSet.has(file)) continue;
    const tagged = hasTsCheck(firstLine);
    if (tagged && !inTsconfig.has(file)) {
      problems.push(
        `${file} starts with // @ts-check but is not in the "files" list of tsconfig.json, so nothing is checked. Add it to "files" in tsconfig.json.`,
      );
    }
    if (notYetSet.has(file)) continue;
    if (!tagged) {
      problems.push(
        `${file} is a new file without // @ts-check. Start the file with // @ts-check, add it to the "files" list in tsconfig.json, and add it to "checked" in scripts/typecheck-ratchet.json.`,
      );
    } else if (inTsconfig.has(file)) {
      problems.push(
        `${file} is type-checked but is not on the checked list. Add it to "checked" in scripts/typecheck-ratchet.json.`,
      );
    }
  }
  return problems;
}

function walk(root, dir, out) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(root, rel, out);
    else if (entry.name.endsWith('.js')) {
      const text = fs.readFileSync(path.join(root, rel), 'utf-8');
      out.push({ path: rel, firstLine: text.split('\n', 1)[0].replace(/\r$/, '') });
    }
  }
}

export function run(root) {
  const lists = JSON.parse(fs.readFileSync(path.join(root, 'scripts/typecheck-ratchet.json'), 'utf-8'));
  const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
  const files = [];
  for (const dir of DIRS) walk(root, dir, files);
  return findProblems({
    checked: lists.checked,
    notYetChecked: lists.notYetChecked,
    files,
    tsconfigFiles: tsconfig.files || [],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = run(root);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log('Type-check ratchet: ok.');
}
