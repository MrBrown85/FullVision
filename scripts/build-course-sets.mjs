#!/usr/bin/env node
/**
 * Builds data/bc-curriculum-sets.json, the per-course-set wording Generate
 * names a competency by (Colin, Nov 4: "each set of courses gets its own
 * wording"), from the writers' batch files, then rebuilds the shipped bank
 * files (scripts/build-curriculum-bank.mjs writes shared/bank-sets.js).
 *
 * Input: a directory of batch files (<batch>.json; *.pre-review.json are
 * skipped), each { "<group>": { "old": {...}, "sets": [ { "id",
 * "competency_ids", "courses", "ministry", "sensitive"?, "bands": { "all" |
 * "8-9" | "10-12": { phrase, next_steps: { emerging, developing,
 * proficient, extending }, strength: [2], next: { developing, proficient,
 * extending }, home } } } ] } } (docs/course-sets/WRITE-BRIEF.md).
 *
 * Checks, and fails on any: every competency id in
 * data/bc-curriculum-ican.json lands in exactly one set and no set names an
 * id that is not there; every field is present and a non-empty string; a
 * home line is null only on a set marked `sensitive` (Colin: "The abuse
 * line is not something that goes into a report card"); every sentence
 * uses only the bank's slots ({He} {he} {His} {his} {him} {himself},
 * [s-form|plain]); and each competency's course grade has its band.
 *
 * Output, deduplicated: { sets: { "<set id>|<band>": { group, courses,
 * sensitive?, phrase, next_steps, strength, next, home } }, competencies:
 * { "<competency id>": "<set id>|<band>" } }, the band being "all", or
 * "8-9" / "10-12" by the competency's course grade.
 *
 * Usage: node scripts/build-course-sets.mjs [<dir>] [--no-bank]
 *   <dir>      the batch files (default data/course-sets, the source of truth)
 *   --no-bank  write the data file only. */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const dir = process.argv.slice(2).find(a => !a.startsWith('--')) || resolve(root, 'data/course-sets');

const ican = JSON.parse(readFileSync(resolve(root, 'data/bc-curriculum-ican.json'), 'utf-8'));
const ids = Object.keys(ican).filter(k => !k.startsWith('_'));
const courses = JSON.parse(readFileSync(resolve(root, 'curriculum_by_course.json'), 'utf-8'));
const gradeOf = {};
Object.values(courses).forEach(c =>
  c.categories.forEach(cat => cat.competencies.forEach(x => (gradeOf[x.id] = Number(c.grade)))),
);

const errors = [];
const err = (where, msg) => errors.push(where + ': ' + msg);
const LEVELS = ['emerging', 'developing', 'proficient', 'extending'];
const NEXT = ['developing', 'proficient', 'extending'];
const BANDS = ['all', '8-9', '10-12'];
const SLOT = /\{(\w+)\}/g;
const ROLES = { He: 1, he: 1, His: 1, his: 1, him: 1, himself: 1 };
const str = v => typeof v === 'string' && v.trim().length > 0;
function slots(where, text) {
  String(text).replace(SLOT, (m, k) => {
    if (!ROLES[k]) err(where, 'unknown slot {' + k + '}');
    return m;
  });
  if (/\[[^\]|]*\]/.test(text)) err(where, 'a [verb] without its plural form');
}

const files = readdirSync(dir)
  .filter(f => f.endsWith('.json') && !f.endsWith('.pre-review.json'))
  .sort();
const owner = {};
const sets = {};
files.forEach(file => {
  const batch = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
  Object.keys(batch).forEach(group => {
    (batch[group].sets || []).forEach(set => {
      const where = file + ' ' + (set.id || group);
      if (!str(set.id)) err(where, 'no set id');
      if (!Array.isArray(set.competency_ids) || !set.competency_ids.length) err(where, 'no competency ids');
      const bands = Object.keys(set.bands || {});
      if (!bands.length || bands.some(b => BANDS.indexOf(b) < 0))
        err(where, 'bands must be "all", or "8-9" and "10-12"');
      bands.forEach(b => {
        const x = set.bands[b];
        const w = where + ' [' + b + ']';
        if (!str(x.phrase)) err(w, 'no phrase');
        LEVELS.forEach(l => !str((x.next_steps || {})[l]) && err(w, 'no next_steps.' + l));
        if (!Array.isArray(x.strength) || x.strength.length !== 2 || !x.strength.every(str))
          err(w, 'strength must be two sentences');
        NEXT.forEach(l => !str((x.next || {})[l]) && err(w, 'no next.' + l));
        if (x.home == null) {
          if (set.sensitive !== true) err(w, 'no home line (only a sensitive set may leave it out)');
        } else if (!str(x.home)) err(w, 'no home line');
        []
          .concat(
            x.strength || [],
            NEXT.map(l => (x.next || {})[l]),
            x.home || [],
          )
          .forEach(t => t && slots(w, t));
        sets[set.id + '|' + b] = {
          group,
          courses: set.courses || [],
          sensitive: set.sensitive === true || undefined,
          phrase: x.phrase,
          next_steps: x.next_steps,
          strength: x.strength,
          next: x.next,
          home: x.home == null ? null : x.home,
        };
      });
      (set.competency_ids || []).forEach(id => {
        if (!ican[id]) err(where, id + ' is not a competency in data/bc-curriculum-ican.json');
        if (owner[id]) err(where, id + ' is also in ' + owner[id]);
        owner[id] = set.id;
      });
    });
  });
});

const competencies = {};
ids.forEach(id => {
  const setId = owner[id];
  if (!setId) return err(id, 'in no set');
  const g = gradeOf[id];
  const band = sets[setId + '|all'] ? 'all' : g >= 10 ? '10-12' : '8-9';
  if (!sets[setId + '|' + band]) return err(id, 'set ' + setId + ' has no ' + band + ' wording (grade ' + g + ')');
  competencies[id] = setId + '|' + band;
});

if (errors.length) {
  console.error(errors.slice(0, 50).join('\n'));
  console.error(errors.length + ' problems; data/bc-curriculum-sets.json not written.');
  process.exit(1);
}
const out = {
  _sets:
    'Per-course-set wording (data/course-sets, written and reviewed for Colin, Nov 4): each competency id points to its set and grade band. Built by scripts/build-course-sets.mjs; do not edit by hand.',
  sets,
  competencies,
};
writeFileSync(resolve(root, 'data/bc-curriculum-sets.json'), JSON.stringify(out, null, 1) + '\n');
console.log(
  files.length +
    ' files, ' +
    Object.keys(sets).length +
    ' set bands, ' +
    Object.keys(competencies).length +
    ' competencies.',
);
if (!process.argv.includes('--no-bank'))
  execFileSync(process.execPath, [resolve(root, 'scripts/build-curriculum-bank.mjs')], { stdio: 'inherit' });
