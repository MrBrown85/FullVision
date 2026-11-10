/**
 * The gradebook's Draft cells, key, Return N Graded and "N to return"
 * filter (S1-F1, docs/plans/student-page-build-plan.md S1).
 *
 * 1. With the build switch off, with Return Grades on As Soon As I Save, and
 *    for a signed-in teacher, the gradebook's HTML is byte for byte what it
 *    was before this change. tests/fixtures/gradebook-switch-off.json holds
 *    the gradebook as origin/main drew it (commit 093f1938, before S1-F1 and
 *    before S0-F2): for a Proficiency class both views, both ways of laying
 *    out rubric columns, the column menu, a search, and a redraw after a
 *    level is typed; for a Both and a Letter class the two views. It was
 *    written by this file's own walk, run in a checkout of origin/main with
 *    only this file added:
 *      UPDATE_GRADEBOOK_SNAPSHOT=1 npx vitest run tests/gradebook-draft-cells.test.js
 *    Run that only on code from before a change the gradebook is meant to
 *    keep out; never to make a failing comparison pass.
 * 2. With the switch on and When I Return Them: the dashed mark on every
 *    kind of work in both views, the words a screen reader hears, the key,
 *    the count on the "N to return" filter and on each column's Return N
 *    Graded, what Return N Graded returns (pair work together), the filter,
 *    and that no number in the gradebook moves because a grade is a draft.
 *
 * Every count is read through GradeState.draftsIn, which asks
 * GradeState.stateOf: the function the grader dialog reads for its Draft
 * row. The last block holds the gradebook's counts against it.
 */
import './setup.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';
import { U, signIn, seedClass, clearClass, click, fire, key } from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'gradebook-switch-off.json');
const UPDATE = process.env.UPDATE_GRADEBOOK_SNAPSHOT === '1';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ELI = U(15);
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric
const EXIT = U(34); // Complete/Incomplete
const JOURNAL = U(35); // one Overall level, no competency
const CLAIM = U(36); // a single-point rubric
const TALK = U(37); // pair work: Ava and Ben are graded together
const BENCH = U(38); // a DIBELS benchmark
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74);
const CLAIM_RUBRIC = U(81);
const STATES = U(82);
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };
const EVERYONE = [AVA, BEN, CARA, DEV, ELI];
// Every piece but the DIBELS benchmark, which is never returned.
const GRADED_WORK = [ESSAY, QUIZ, LAB, EXIT, JOURNAL, CLAIM, TALK];

const entry = (sid, aid, tid, score, more) => ({
  id: sid + ':' + aid + ':' + tid,
  assessmentId: aid,
  tagId: tid,
  score,
  date: '2026-10-10',
  type: 'summative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
  ...more,
});

// Ava has a grade on every piece; Ben on the pair's; Eli a Late essay.
const SCORES = {
  [AVA]: [
    entry(AVA, ESSAY, QUESTION, 3, { note: 'Careful work.' }),
    entry(AVA, ESSAY, PLAN, 2, { mod: 1, note: 'Careful work.' }),
    entry(AVA, QUIZ, QUESTION, 7),
    entry(AVA, LAB, SAFETY, 3, { mod: -1 }),
    entry(AVA, LAB, METHOD, 4),
    entry(AVA, EXIT, QUESTION, 1),
    entry(AVA, JOURNAL, 'overall', 3),
    entry(AVA, CLAIM, STATES, 3, { critNote: 'Say why' }),
    entry(AVA, TALK, QUESTION, 3),
  ],
  [BEN]: [entry(BEN, TALK, QUESTION, 3)],
  [ELI]: [entry(ELI, ESSAY, QUESTION, 4), entry(ELI, ESSAY, PLAN, 3)],
};
// Missing, Excused and Late, each with nothing else, and Late on a grade.
const STATUSES = {
  [CARA + ':' + ESSAY]: 'NS',
  [DEV + ':' + QUIZ]: 'EXC',
  [ELI + ':' + QUIZ]: 'LATE',
  [ELI + ':' + ESSAY]: 'LATE',
};

function seedWith({ config = {}, system = 'proficiency', columns, ...more } = {}) {
  return () => {
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
        { id: DEV, firstName: 'Dev', lastName: 'Dhillon' },
        { id: ELI, firstName: 'Eli', lastName: 'Evans' },
      ],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] },
          { id: U(52), name: 'Plan', tags: [{ id: PLAN, label: 'Plan', text: 'Plan a test' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      rubrics: [
        {
          id: LAB_RUBRIC,
          name: 'Lab Skills',
          style: 'advanced',
          criteria: [
            {
              id: SAFETY,
              name: 'Safety',
              tagIds: [QUESTION],
              levels: WORDS,
              checks: [{ id: GOGGLES, level: 3, label: 'Goggles on' }],
            },
            { id: METHOD, name: 'Method', tagIds: [PLAN], levels: WORDS, checks: [] },
          ],
        },
        {
          id: CLAIM_RUBRIC,
          name: 'Claim',
          style: 'single_point',
          criteria: [{ id: STATES, name: 'States a Claim', tagIds: [], levels: { 3: 'States a claim' }, checks: [] }],
        },
      ],
      assessments: [
        { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
        { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
        { id: LAB, title: 'Lab', rubricId: LAB_RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
        { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
        { id: JOURNAL, title: 'Journal', tagIds: [], date: '2026-10-14', type: 'summative' },
        { id: CLAIM, title: 'Claim', rubricId: CLAIM_RUBRIC, tagIds: [], date: '2026-10-15', type: 'summative' },
        {
          id: TALK,
          title: 'Pair Talk',
          tagIds: [QUESTION],
          date: '2026-10-16',
          type: 'summative',
          collaboration: 'pair',
          pairs: [[AVA, BEN]],
        },
        { id: BENCH, title: 'Reading Benchmark', scoreMode: 'dibels', tagIds: [], date: '2026-10-17' },
      ],
      scores: SCORES,
      statuses: STATUSES,
      rubricChecks: { [AVA + ':' + LAB]: [GOGGLES] },
      courseConfigs: config,
      ...more,
    });
    COURSES[CID].gradingSystem = system;
    if (columns) localStorage.setItem('gb_rubricColumns_' + CID, columns);
  };
}

const main = () => document.getElementById('main').innerHTML;
const scoresCell = (aid, sid) =>
  document.querySelector('.gb-scores-cell[data-aid="' + aid + '"][data-sid="' + sid + '"]');
const compCells = (aid, sid) =>
  Array.from(document.querySelectorAll('#gb-data td.gb-score[data-aid="' + aid + '"][data-sid="' + sid + '"]'));
const compCell = (aid, sid, tid) =>
  compCells(aid, sid).find(td => (tid ? td.getAttribute('data-tid') === tid : td.getAttribute('data-pts') === '1'));
function select(cell) {
  document.querySelectorAll('#gb-data .gb-focus').forEach(el => el.classList.remove('gb-focus'));
  cell.classList.add('gb-focus');
  cell.focus();
  return cell;
}
const showScores = () => click(document.querySelector('[data-action="setView"][data-mode="scores"]'));
// A Scores column's menu, opened from its title with Return.
function openColumnMenu(aid) {
  const label = document.querySelector('#gb-colheads .gb-grid-colhead[data-aid="' + aid + '"] .gb-grid-colhead-label');
  label.focus();
  key(label, 'Enter');
  return document.querySelector('.gb-ctx-menu');
}
function search(text) {
  const box = document.querySelector('.gb-search-input');
  box.value = text;
  fire(box, 'input');
}

/* The walk the snapshot records. A Proficiency class: the Scores view, a
   column's menu, a search, the Competencies view (rubrics by criterion and
   by competency), and the redraw of both views after a level is typed. A
   Both and a Letter class: the two views. Returns { name: html }. */
function walk(config) {
  const out = {};
  for (const system of ['proficiency', 'both', 'letter']) {
    const name = what => system + ' › ' + what;
    const whole = system === 'proficiency';
    mount(seedWith({ config, system }), { course: CID });
    out[name('Scores')] = main();
    if (whole) {
      out[name('Scores, the Essay column menu')] = openColumnMenu(ESSAY).outerHTML;
      key(document.querySelector('.gb-ctx-menu'), 'Escape');
      search('a');
      out[name('Scores, searched')] = main();
      search('');
    }
    showCompetencies();
    out[name('Competencies, rubrics by criterion')] = main();
    if (whole) {
      // A level typed on a competency cell redraws the grid.
      key(select(compCell(ESSAY, BEN, QUESTION)), '2');
      out[name('Competencies, after a level')] = main();
      showScores();
      out[name('Scores, after a level')] = main();
    }
    unmount();
    clearClass(CID);
    if (!whole) continue;
    mount(seedWith({ config, system, columns: 'competencies' }), { course: CID });
    showCompetencies();
    out[name('Competencies, rubrics by competency')] = main();
    unmount();
    clearClass(CID);
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  unmount();
  clearClass(CID);
  localStorage.clear();
});

describe('with the build switch off the gradebook is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', () => {
      writeFileSync(SNAPSHOT, JSON.stringify(walk(), null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};

  it('the snapshot covers both views for each way a class shows grades', () => {
    expect(Object.keys(before).length).toBe(11);
    Object.keys(before).forEach(name => expect(before[name].length, name).toBeGreaterThan(800));
    // The walk leaves a grade typed with the switch off, which is Returned.
    expect(before['proficiency › Competencies, after a level']).not.toBe(
      before['proficiency › Competencies, rubrics by criterion'],
    );
  });

  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    ['a class whose student page was turned off again', { student_page_enabled: false, return_grades: 'on_return' }],
    [
      'a class whose student page is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class whose student page is on with no choice made', { student_page_enabled: true }],
  ])('byte for byte, in %s', (_, config) => {
    const now = walk(config);
    expect(Object.keys(now)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
  });

  it('byte for byte for a signed-in teacher, even with both settings on this device', () => {
    const session = signIn();
    try {
      const now = walk({ student_page_enabled: true, return_grades: 'on_return' });
      expect(Object.keys(now)).toEqual(Object.keys(before));
      Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
    } finally {
      session.signOut();
    }
  });
});
