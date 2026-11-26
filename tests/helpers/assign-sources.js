/* The Assignments page is teacher/page-assignments.js and the teacher/assign-*.js files cut from it
   (scripts/split). A test that reads its source text reads all of them: assignAll() is the text
   of every piece, and assignBetween(from, to) is one function, looked for in each piece, read from
   `from` to `to` in the same piece (or to the end of the piece when `to` is in another one). */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function assignPieces() {
  const dir = resolve(root, 'teacher');
  return ['page-assignments.js']
    .concat(readdirSync(dir).filter(n => /^assign-.*\.js$/.test(n)))
    .map(n => readFileSync(resolve(dir, n), 'utf-8'));
}

export function assignAll() {
  return assignPieces().join('\n');
}

export function assignBetween(from, to) {
  for (const s of assignPieces()) {
    const i = s.indexOf(from);
    if (i < 0) continue;
    const j = s.indexOf(to, i);
    return j < 0 ? s.slice(i) : s.slice(i, j);
  }
  return '';
}
