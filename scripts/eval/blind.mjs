#!/usr/bin/env node
/* The blind-rating export (plan PR 14; research report, section D,
 * "Measuring success"): for each student in the gold file, the comment the
 * teacher wrote, the one Generate drafts, and the teacher's edit of the draft
 * when there is one, with every student's name taken out and the versions
 * shuffled. Raters see only the rating sheet; the key says which is which.
 *
 * Usage:
 *   node scripts/eval/blind.mjs --class <class.json> --gold <gold.json> --out <folder>
 *        [--edited <edited.json>] [--seed <number>] [--report <N>]
 *
 *   --class   the class file: get_class_bundle's data (scripts/eval/app.mjs)
 *   --gold    [{ studentName, comment }]: the comments the teacher wrote
 *   --edited  [{ studentName, comment }]: the teacher's edits of the drafts
 *   --seed    the shuffle, to make the same sheet again (random when left out)
 *   --report  the report number (Report N), 1 when left out
 *   --out     a folder for rating-sheet.csv (for raters), rubric.csv (the
 *             scale) and key.csv (which version is which: keep it from raters)
 *
 * Every path must be outside the FullVision folder. Only counts are printed. */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { assertOutsideRepo, readJson } from './app.mjs';
import { generateClass, matchEntries } from './generate.mjs';
import { parseArgs } from './accuracy.mjs';

/* The rubric's criteria for raters (research report, section D), with the
   anchors for 1 and 4. Accuracy is a count, not a scale. */
export const RUBRIC = [
  {
    column: 'Specificity (1-4)',
    criterion: 'Specificity',
    one: 'Could fit any student',
    four: 'Names specific work and what the student did in it',
  },
  { column: 'Tone (1-4)', criterion: 'Tone', one: 'Cold, clipped or judging', four: 'Warm, respectful, plain' },
  {
    column: 'Written for This Student (1-4)',
    criterion: 'Written for This Student',
    one: 'Clearly a form letter',
    four: 'Reads as this teacher writing about this child',
  },
  {
    column: 'Plain Language (1-4)',
    criterion: 'Plain Language',
    one: 'Jargon; a parent cannot say what the grade means',
    four: 'A parent reads it once and can say what it means and what to do',
  },
  {
    column: 'Accuracy Errors (count)',
    criterion: 'Accuracy',
    one: 'Any wrong number, name, title, proficiency word, contradicted claim or uncheckable claim',
    four: 'Zero errors against the gradebook (count the errors; 0 is the target)',
  },
];

export const SOURCES = ['teacher', 'generated', 'edited'];

/* A seeded shuffle, so a sheet can be made again from its seed. */
function rng(seed) {
  let x = Number(seed) >>> 0 || 1;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* The comment with this student's names as [Student] and any classmate's as
   [Classmate]: first, preferred and last names, whole words, as written. */
export function stripNames(text, student, classStudents) {
  const parts = s =>
    [s.firstName, s.preferred, s.lastName]
      .filter(Boolean)
      .flatMap(n => [n].concat(String(n).split(/[\s-]+/)))
      .filter(n => n.length >= 2);
  const own = parts(student);
  const swaps = own.map(n => [n, '[Student]']);
  classStudents.forEach(s => {
    if (s.id !== student.id) parts(s).forEach(n => own.indexOf(n) < 0 && swaps.push([n, '[Classmate]']));
  });
  // Longest first, so "Mary Ann" goes before "Mary".
  swaps.sort((a, b) => b[0].length - a[0].length);
  let out = String(text || '');
  swaps.forEach(([n, by]) => {
    out = out.replace(new RegExp('(^|[^\\p{L}\\[])' + escapeRe(n) + '(?![\\p{L}\\]])', 'gu'), (m, pre) => pre + by);
  });
  // "[Student] [Student]" from a full name is one student.
  return out.replace(/\[(Student|Classmate)\](?:\s\[\1\])+/g, '[$1]');
}

/* The sets: one per gold student, its versions shuffled and lettered A, B,
   C, the sets in shuffled order. Returns { seed, sheet: [{ set, version,
   comment }], key: [{ set, version, source, student }], unmatched }. */
export function buildBlindSet({ classData, gold, edited, seed, report }) {
  if (!gold) throw new Error('The blind export needs the gold file.');
  const { students, drafts } = generateClass(classData, report);
  const draftOf = new Map(drafts.map(d => [d.student.id, d.text]));
  const g = matchEntries(students, gold, 'The gold file');
  const editedOf = new Map();
  let editedUnmatched = 0;
  if (edited) {
    const e = matchEntries(students, edited, 'The edited file');
    editedUnmatched = e.unmatched;
    e.matched.forEach(x => editedOf.set(x.student.id, x.comment));
  }
  const s = seed != null && seed !== '' ? Number(seed) >>> 0 : Math.floor(Math.random() * 4294967295) + 1;
  const rand = rng(s);
  const sheet = [];
  const key = [];
  shuffle(g.matched, rand).forEach((x, i) => {
    const set = 'Set ' + String(i + 1).padStart(2, '0');
    const versions = [
      { source: 'teacher', text: x.comment },
      { source: 'generated', text: draftOf.get(x.student.id) || '' },
    ];
    if (editedOf.has(x.student.id)) versions.push({ source: 'edited', text: editedOf.get(x.student.id) });
    shuffle(versions, rand).forEach((v, j) => {
      const version = 'ABC'.charAt(j);
      sheet.push({ set, version, comment: stripNames(v.text, x.student, students) });
      key.push({ set, version, source: v.source, student: globalThis.displayNameWithLast(x.student) });
    });
  });
  return { seed: s, sheet, key, unmatched: g.unmatched, editedUnmatched };
}

/* ── Files ───────────────────────────────────────────────────────────── */

function cell(v) {
  const t = String(v == null ? '' : v);
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
/* CSV with a byte-order mark, so a spreadsheet reads the curly quotes. */
export function csv(rows) {
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function sheetCsv(sheet) {
  const head = ['Set', 'Version', 'Comment', 'Rater'].concat(
    RUBRIC.map(r => r.column),
    ['Notes'],
  );
  return csv(
    [head].concat(
      sheet.map(r =>
        [r.set, r.version, r.comment, ''].concat(
          RUBRIC.map(() => ''),
          [''],
        ),
      ),
    ),
  );
}

export function rubricCsv() {
  return csv([['Criterion', '1', '4']].concat(RUBRIC.map(r => [r.criterion, r.one, r.four])));
}

export function keyCsv(result) {
  return csv(
    [['Set', 'Version', 'Source', 'Student']]
      .concat(result.key.map(k => [k.set, k.version, k.source, k.student]))
      .concat([[], ['Seed', result.seed]]),
  );
}

export function main(argv) {
  const args = parseArgs(argv, ['class', 'gold', 'edited', 'out', 'seed', 'report']);
  if (!args.class || !args.gold || !args.out) {
    throw new Error(
      'Usage: node scripts/eval/blind.mjs --class <class.json> --gold <gold.json> --out <folder> [--edited <edited.json>] [--seed <number>] [--report <N>]',
    );
  }
  const outDir = assertOutsideRepo(args.out, 'The output folder');
  const result = buildBlindSet({
    classData: readJson(args.class, 'The class file'),
    gold: readJson(args.gold, 'The gold file'),
    edited: args.edited ? readJson(args.edited, 'The edited file') : null,
    seed: args.seed,
    report: args.report,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'rating-sheet.csv'), sheetCsv(result.sheet));
  writeFileSync(join(outDir, 'rubric.csv'), rubricCsv());
  writeFileSync(join(outDir, 'key.csv'), keyCsv(result));
  const sets = new Set(result.sheet.map(r => r.set)).size;
  const lines = [`${sets} sets, ${result.sheet.length} comments, seed ${result.seed}`];
  if (result.unmatched) lines.push(result.unmatched + ' gold entries matched no student');
  if (result.editedUnmatched) lines.push(result.editedUnmatched + ' edited entries matched no student');
  lines.push('Rating sheet: ' + join(outDir, 'rating-sheet.csv'));
  lines.push('Key (keep from raters): ' + join(outDir, 'key.csv'));
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
