/* The Assignments page is teacher/page-assignments.js and the teacher/assign-*.js files cut from it
   (scripts/split). A test that reads its source text reads all of them: assignAll() is the text
   of every piece, and assignBetween(from, to) is one function, looked for in each piece, read from
   `from` to `to` in the same piece (or to the end of the piece when `to` is in another one).
   It throws when `from` is in more than one piece. */
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
  const holding = assignPieces().filter(s => s.includes(from));
  // In two pieces, a test reading one would pass whatever the other did.
  if (holding.length > 1) throw new Error('"' + from + '" is in ' + holding.length + ' of the Assignments files');
  if (!holding.length) return '';
  const s = holding[0];
  const i = s.indexOf(from);
  const j = s.indexOf(to, i);
  return j < 0 ? s.slice(i) : s.slice(i, j);
}
