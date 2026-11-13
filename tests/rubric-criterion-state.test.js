/**
 * What one rubric criterion shows for one student, on the desktop
 * (_criterionState in teacher/page-assignments.js) and the phone (_critState
 * in teacher-mobile/tab-grade.js). A criterion is saved under one key, so
 * neither ever reports "mixed". Both functions sit inside larger modules, so
 * each is cut out of its file and run with the same three helpers it uses.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

function cutOut(file, name) {
  const src = readFileSync(file, 'utf-8');
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in ' + file);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1) + '\nreturn ' + name + ';';
}

function build(file, name, scores) {
  const factory = new Function('getScores', 'rubricCriterionScoreKeys', 'normalizeScoreMod', cutOut(file, name));
  return factory(
    () => scores,
    c => rubricCriterionScoreKeys(c),
    (level, mod) => normalizeScoreMod(level, mod),
  );
}

const CRIT = { id: 'crit1' };
const entry = (score, mod) => ({ assessmentId: 'a1', tagId: 'crit1', score, mod });
const cases = [
  ['no score', []],
  ['a score of zero', [entry(0, 0)]],
  ['a level', [entry(3, 0)]],
  ['a level with plus', [entry(3, 1)]],
  ['a level with minus', [entry(2, -1)]],
  ['another assessment only', [{ assessmentId: 'a2', tagId: 'crit1', score: 4, mod: 0 }]],
];

describe('a rubric criterion never reads as mixed', () => {
  const desktop = {
    'no score': { level: 0, mod: 0, mixed: false },
    'a score of zero': { level: 0, mod: 0, mixed: false },
    'a level': { level: 3, mod: 0, mixed: false },
    'a level with plus': { level: 3, mod: 1, mixed: false },
    'a level with minus': { level: 2, mod: -1, mixed: false },
    'another assessment only': { level: 0, mod: 0, mixed: false },
  };
  it.each(cases)('desktop, %s', (label, rows) => {
    const state = build('teacher/page-assignments.js', '_criterionState', { s1: rows });
    expect(state('c', 's1', 'a1', CRIT)).toEqual(desktop[label]);
  });
  it.each(cases)('phone, %s', (label, rows) => {
    const state = build('teacher-mobile/tab-grade.js', '_critState', { s1: rows });
    const want = { ...desktop[label] };
    // The phone passes + and - through normalizeScoreMod; the desktop shows them raw.
    if (want.level) want.mod = normalizeScoreMod(want.level, want.mod);
    expect(state('c', 's1', 'a1', CRIT)).toEqual(want);
  });
  it('a criterion without an id has no state', () => {
    expect(build('teacher/page-assignments.js', '_criterionState', { s1: [entry(3, 0)] })('c', 's1', 'a1', {})).toEqual(
      {
        level: 0,
        mod: 0,
        mixed: false,
      },
    );
    expect(build('teacher-mobile/tab-grade.js', '_critState', { s1: [entry(3, 0)] })('c', 's1', 'a1', {})).toEqual({
      level: 0,
      mod: 0,
      mixed: false,
    });
  });
});
