/**
 * Reports in a class that does not hold grades are what main prints
 * (student page build plan, S2-F1 and S2-F2).
 *
 * S2 puts Progress Reports, the Assessments list and its Feedback Pages, the
 * rubric handout, the Term Questionnaire with Generate, and Sent to Phones
 * on returned grades, but only in a class that holds grades: its student
 * page on (the build switch) and Return Grades set to When I Return Them.
 * Every other class must print exactly what it printed before.
 *
 * tests/fixtures/report-surfaces-other-classes.json was written by this file
 * in a checkout of origin/main, before S2 changed a line of app code, with
 * the class graded a little first (a level changed, an Overall Comment, a
 * Note for the Report on work with no grade, a tick taken off, a points
 * score), so a draft rule leaking into such a class has something to move.
 * Each class below is drawn, every surface and the rubric handout included,
 * and must match it part for part:
 * - a class with neither setting;
 * - When I Return Them with the student page off (a page turned off again is
 *   the same state: nothing reads the switch but `=== true`);
 * - the student page on with As Soon As I Save, and on with no choice made.
 *
 *   UPDATE_REPORT_SURFACES_OTHER=1 npx vitest run tests/report-surfaces-other-classes.test.js
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaces } from './helpers/report-surfaces.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'fixtures/report-surfaces-other-classes.json');
const UPDATE = process.env.UPDATE_REPORT_SURFACES_OTHER === '1';

const DRAWN = ['st1', 'st2', 'st3', 'st4', 'st5', 'st6'];

const fingerprint = s => createHash('sha256').update(s).digest('hex').slice(0, 20) + ' ' + s.length;

/* The same few grading moves in every class, through the one grader. */
function grade(cid) {
  Grader.setLevel(cid, 'st3', 'sci8a2', 'PA5', 4, 0);
  Grader.setOverallComment(cid, 'st1', 'sci8a7', 'S2 marker: an Overall Comment written today.');
  Grader.setReportNote(cid, 'st2', 'sci8a20', 'S2 marker: a Note for the Report on work with no grade.');
  Grader.setPoints(cid, 'st4', 'sci8q1', 3);
  const ticked = getRubricCheckIds(cid, 'st1', 'sci8a1');
  if (ticked.length) Grader.setTick(cid, 'st1', 'sci8a1', ticked[0], false);
}

/* The Demo class as it loads, kept once: each class below starts from it. */
let base = null;
function freshClass() {
  if (!base) {
    const cid = loadDemoClass();
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    base = { cid, ls, cache: structuredClone(_cache) };
  }
  localStorage.clear();
  Object.keys(base.ls).forEach(k => localStorage.setItem(k, base.ls[k]));
  Object.keys(base.cache).forEach(k => (_cache[k] = structuredClone(base.cache[k])));
  _returnedSets = {};
  clearProfCache();
  return base.cid;
}

function drawClass(config) {
  const cid = freshClass();
  if (config) saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), config));
  grade(cid);
  clearProfCache();
  freshGenerate();
  const out = {};
  // The students the grading moves touch, and two more: a draft rule leaking
  // into such a class shows on them. All 27 drew the same thing five times slower.
  const drawn = surfaces(cid, null, { students: DRAWN });
  Object.keys(drawn).forEach(key => (out[key] = fingerprint(drawn[key])));
  return out;
}

const CLASSES = [
  ['a class with neither setting', null],
  ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
  ['a class whose student page is on with As Soon As I Save', { student_page_enabled: true, return_grades: 'on_save' }],
  ['a class whose student page is on with no choice made', { student_page_enabled: true }],
];

describe('reports in a class that does not hold grades', { timeout: 120000 }, () => {
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
  });

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  if (UPDATE) {
    it('writes the fixture from the class with neither setting', () => {
      writeFileSync(FILE, JSON.stringify({ frozenAt: FROZEN_AT, parts: drawClass(null) }, null, 2) + '\n');
    });
    return;
  }

  const kept = () => JSON.parse(readFileSync(FILE, 'utf-8'));

  it.each(CLASSES)('%s prints what main printed, part for part', (_name, config) => {
    const file = kept();
    expect(file.frozenAt).toBe(FROZEN_AT);
    const now = drawClass(config);
    expect(Object.keys(now)).toEqual(Object.keys(file.parts));
    const moved = Object.keys(now).filter(key => now[key] !== file.parts[key]);
    expect(moved).toEqual([]);
  });
});
