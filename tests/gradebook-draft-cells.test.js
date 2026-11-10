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
 *    keep out; never to make a failing comparison pass. Since then it was
 *    rewritten once for a change meant to show: Print Rubrics in the column
 *    menu (Nov 10), the one difference between the two files.
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
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  fire,
  key,
  confirmOk,
  serverSaysStudentPageOn,
} from './helpers/pin-save-paths.js';

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

  // As before S0-W1: the two settings on this device alone are not the
  // server's word (shared/data.js _serverSaysStudentPage), and draw nothing.
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

  // And once the server has said the page is on (S0-W1), every class that
  // still does not hold grades.
  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    ['a class whose student page was turned off again', { student_page_enabled: false, return_grades: 'on_return' }],
    [
      'a class whose student page is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class whose student page is on with no choice made', { student_page_enabled: true }],
  ])('byte for byte for a signed-in teacher, in %s', (_, config) => {
    const session = signIn();
    if (config.student_page_enabled === true) serverSaysStudentPageOn(CID);
    try {
      const now = walk(config);
      expect(Object.keys(now)).toEqual(Object.keys(before));
      Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
      // With the student page off, nothing is asked of the server about
      // Draft and Returned or cards.
      if (config.student_page_enabled !== true) {
        expect(session.sent().filter(c => /grade_return|return_grades|student_card|draft_count/.test(c[0]))).toEqual(
          [],
        );
      }
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });

  it('and the check can tell: a signed-in class the server says holds grades is drawn its drafts (S0-W1)', () => {
    const session = signIn();
    serverSaysStudentPageOn(CID);
    try {
      const now = walk({ student_page_enabled: true, return_grades: 'on_return' });
      expect(Object.keys(now)).toEqual(Object.keys(before));
      const name = 'proficiency › Competencies, after a level';
      expect(now[name]).not.toBe(before[name]);
      expect(now[name]).toMatch(/gb-draft/);
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });

  it('draws no mark, key line, count or Return, even after grading', () => {
    mount(seedWith({ config: { student_page_enabled: true, return_grades: 'on_save' } }), { course: CID });
    Grader.setLevel(CID, BEN, ESSAY, QUESTION, 3, 0);
    PageGradebook.render();
    expect(main()).not.toMatch(/gb-draft|gb-to-return|gb-return-drafts|gb-key-draft|Draft/);
    expect(openColumnMenu(ESSAY).textContent).not.toMatch(/Return|draft/i);
  });
});

/* ── With the switch on and When I Return Them ─────────────────────────── */
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
const WORDS_HEARD = ', Draft, not returned yet';

const open = more => mount(seedWith({ config: HELD, ...more }), { course: CID });
const redraw = () => PageGradebook.render();
const pill = () => document.querySelector('.gb-to-return');
const pillCount = () => (pill() ? parseInt(pill().textContent, 10) : 0);
const label = cell => cell.getAttribute('aria-label');
const isDashed = cell => cell.classList.contains('gb-draft');
const rowIds = () =>
  Array.from(document.querySelectorAll('#gb-data tr[data-sid]')).map(r => r.getAttribute('data-sid'));
const columnIds = () =>
  Array.from(document.querySelectorAll('#gb-colheads .gb-grid-colhead[data-aid]')).map(h => h.getAttribute('data-aid'));
const headerButtons = () => Array.from(document.querySelectorAll('.gb-return-drafts'));
const headerButton = aid => headerButtons().find(b => b.getAttribute('data-aid') === aid);
const returnItem = () => document.querySelector('.gb-ctx-menu [data-ctx="returnDrafts"]');
const closeMenu = () => key(document.querySelector('.gb-ctx-menu'), 'Escape');
// The app's confirm dialog (teacher/ui.js showConfirm), or null.
const confirmDialog = () => document.querySelector('.confirm-overlay');
const cancelConfirm = () => document.getElementById('confirm-cancel-btn').onclick();
// What a Scores column's menu offers to return: its N, or 0 with no item.
function menuCount(aid) {
  openColumnMenu(aid);
  const item = returnItem();
  const n = item ? parseInt(item.textContent.replace('Return ', ''), 10) : 0;
  closeMenu();
  return n;
}
// The students the grader dialog would show its Draft row for (stateOf).
const dialogDrafts = aid => EVERYONE.filter(sid => GradeState.stateOf(CID, sid, aid) === GradeState.DRAFT);

/* One grade for `sid` on each kind of work, saved through the one grader. */
const GRADE = {
  [ESSAY]: sid => Grader.setLevel(CID, sid, ESSAY, QUESTION, 2, 0),
  [QUIZ]: sid => Grader.setPoints(CID, sid, QUIZ, 9),
  [LAB]: sid => Grader.setLevel(CID, sid, LAB, SAFETY, 2, 0),
  [EXIT]: sid => Grader.setMark(CID, sid, EXIT, 'incomplete'),
  [JOURNAL]: sid => Grader.setLevel(CID, sid, JOURNAL, 'overall', 2, 0),
  [CLAIM]: sid => Grader.setLevel(CID, sid, CLAIM, STATES, 2, 0),
  [TALK]: sid => Grader.setLevel(CID, sid, TALK, QUESTION, 4, 0),
};
const gradeEverything = sid => GRADED_WORK.forEach(aid => GRADE[aid](sid));
// The numbers a row and the Class Average row show.
const numbers = () =>
  Array.from(document.querySelectorAll('#gb-rowheads .gb-grid-rowhead, #gb-data .gb-stats-row td')).map(
    el => el.textContent,
  );

describe.skipIf(UPDATE)('with the build switch on and When I Return Them', () => {
  it('with nothing waiting: the key explains the mark, and there is no count, mark or Return', () => {
    open();
    expect(pill()).toBe(null);
    expect(document.querySelectorAll('.gb-draft').length).toBe(0);
    const key = document.querySelector('.gb-key .gb-key-item-draft');
    expect(key.textContent).toBe('Draft: graded, not returned');
    expect(key.querySelector('.gb-key-draft')).not.toBe(null);
    // After No Score, the last of the key.
    expect(key.previousElementSibling.textContent).toBe('—No Score');
    expect(key.nextElementSibling).toBe(null);
    expect(openColumnMenu(ESSAY).textContent).not.toMatch(/Return|draft/i);
    closeMenu();
    showCompetencies();
    expect(headerButtons()).toEqual([]);
    expect(document.querySelector('.gb-key .gb-key-item-draft')).not.toBe(null);
  });

  it('a draft is dashed and said in words, on every kind of work, in the Scores view', () => {
    open();
    gradeEverything(BEN);
    redraw();
    GRADED_WORK.forEach(aid => {
      const cell = scoresCell(aid, BEN);
      expect(isDashed(cell), aid).toBe(true);
      expect(label(cell).endsWith(WORDS_HEARD), label(cell)).toBe(true);
      // No fill under the outline: only the level's colour.
      expect(cell.getAttribute('style'), aid).not.toMatch(/background/);
    });
    expect(label(scoresCell(ESSAY, BEN))).toBe('Ben Brown, Essay: 2.0, Developing, Draft, not returned yet');
    expect(label(scoresCell(QUIZ, BEN))).toBe('Ben Brown, Quiz: 9 out of 10, Draft, not returned yet');
    expect(label(scoresCell(EXIT, BEN))).toBe('Ben Brown, Exit Ticket: Incomplete, Draft, not returned yet');
    // Grades that were there before the switch came on are Returned: plain.
    GRADED_WORK.filter(aid => aid !== TALK).forEach(aid => {
      expect(isDashed(scoresCell(aid, AVA)), aid).toBe(false);
      expect(label(scoresCell(aid, AVA))).not.toContain('Draft');
    });
    expect(scoresCell(ESSAY, AVA).getAttribute('style')).toMatch(/^background:/);
    // The benchmark has no grade: nothing to mark.
    expect(isDashed(scoresCell(BENCH, BEN))).toBe(false);
    // Ben's seven, and Ava's copy of the pair's grade.
    expect(document.querySelectorAll('#gb-data .gb-draft').length).toBe(GRADED_WORK.length + 1);
  });

  it('and in the Competencies view, where each cell of the piece is dashed', () => {
    for (const columns of ['criteria', 'competencies']) {
      open({ columns });
      gradeEverything(BEN);
      showCompetencies();
      GRADED_WORK.forEach(aid => {
        const cells = compCells(aid, BEN);
        expect(cells.length, aid).toBeGreaterThan(0);
        cells.forEach(cell => {
          expect(isDashed(cell), columns + ' ' + aid).toBe(true);
          expect(label(cell), aid).toContain(WORDS_HEARD);
        });
        compCells(aid, CARA).forEach(cell => expect(isDashed(cell), aid).toBe(false));
      });
      expect(label(compCell(ESSAY, BEN, QUESTION))).toBe(
        'Ben Brown, Essay, Question: 2, Developing, Draft, not returned yet',
      );
      // The piece's other competency has no level yet; it is part of the draft.
      expect(label(compCell(ESSAY, BEN, PLAN))).toBe('Ben Brown, Essay, Plan: No score, Draft, not returned yet');
      expect(label(compCell(QUIZ, BEN))).toBe('Ben Brown, Quiz: 9 out of 10, Draft, not returned yet');
      expect(label(compCell(EXIT, BEN))).toBe('Ben Brown, Exit Ticket: Incomplete, Draft, not returned yet');
      unmount();
      clearClass(CID);
    }
  });

  it('Missing, Excused and Late with nothing else show no mark; Late on a draft keeps it', () => {
    open();
    redraw();
    [
      [ESSAY, CARA, 'Cara Chen, Essay: Missing'],
      [QUIZ, DEV, 'Dev Dhillon, Quiz: Excused'],
      [QUIZ, ELI, 'Eli Evans, Quiz: no score, Late'],
      // Late on a grade from before the switch: Returned.
      [ESSAY, ELI, 'Eli Evans, Essay: 3.5, Extending, Late'],
    ].forEach(([aid, sid, heard]) => {
      expect(isDashed(scoresCell(aid, sid)), heard).toBe(false);
      expect(label(scoresCell(aid, sid))).toBe(heard);
    });
    expect(pill()).toBe(null);
    // Late is only a label: a grade given under it is a draft like any other.
    Grader.setPoints(CID, ELI, QUIZ, 6);
    redraw();
    expect(isDashed(scoresCell(QUIZ, ELI))).toBe(true);
    expect(label(scoresCell(QUIZ, ELI))).toBe('Eli Evans, Quiz: 6 out of 10, Late, Draft, not returned yet');
    showCompetencies();
    expect(label(compCell(QUIZ, ELI))).toBe('Eli Evans, Quiz: 6 out of 10, Late, Draft, not returned yet');
    expect(isDashed(compCell(ESSAY, CARA, QUESTION))).toBe(false);
    expect(isDashed(compCell(QUIZ, DEV))).toBe(false);
  });

  it('a draft under Missing shows the status, not the mark, and is not counted', () => {
    open();
    Grader.setLevel(CID, DEV, ESSAY, QUESTION, 3, 0);
    Grader.setLevel(CID, BEN, ESSAY, QUESTION, 3, 0);
    const statuses = getAssignmentStatuses(CID);
    statuses[DEV + ':' + ESSAY] = 'NS';
    saveAssignmentStatuses(CID, statuses);
    redraw();
    expect(getGradeReturn(CID, DEV, ESSAY).is_draft).toBe(true);
    expect(isDashed(scoresCell(ESSAY, DEV))).toBe(false);
    expect(label(scoresCell(ESSAY, DEV))).toBe('Dev Dhillon, Essay: Missing');
    expect(pill().textContent).toBe('1 to return');
    expect(menuCount(ESSAY)).toBe(1);
  });

  it('a returned grade changed since is a draft again; put back, it is not', () => {
    open();
    expect(isDashed(scoresCell(ESSAY, AVA))).toBe(false);
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 4, 0);
    redraw();
    expect(isDashed(scoresCell(ESSAY, AVA))).toBe(true);
    expect(label(scoresCell(ESSAY, AVA))).toContain(WORDS_HEARD);
    expect(pill().textContent).toBe('1 to return');
    // The student still has what was returned.
    expect(getGradeReturn(CID, AVA, ESSAY).returned_copy.tags[QUESTION].value).toBe(3);
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3, 0);
    redraw();
    expect(isDashed(scoresCell(ESSAY, AVA))).toBe(false);
    expect(pill()).toBe(null);
    // A new draft, returned from its column, then changed: a draft again.
    Grader.setPoints(CID, BEN, QUIZ, 8);
    redraw();
    openColumnMenu(QUIZ);
    click(returnItem());
    expect(isDashed(scoresCell(QUIZ, BEN))).toBe(false);
    expect(GradeState.stateOf(CID, BEN, QUIZ)).toBe('returned');
    Grader.setPoints(CID, BEN, QUIZ, 10);
    redraw();
    expect(isDashed(scoresCell(QUIZ, BEN))).toBe(true);
    // A returned grade cleared waits too: the empty cell is dashed.
    Grader.setPoints(CID, BEN, QUIZ, null);
    redraw();
    expect(isDashed(scoresCell(QUIZ, BEN))).toBe(true);
    expect(label(scoresCell(QUIZ, BEN))).toBe('Ben Brown, Quiz: no score, Draft, not returned yet');
  });

  it('the count on "N to return" is the sum of the columns’ counts, in both views', () => {
    open();
    gradeEverything(DEV);
    gradeEverything(CARA); // Cara's essay is Missing: no draft there
    Grader.setLevel(CID, BEN, TALK, QUESTION, 4, 0); // the pair: Ava too
    redraw();
    const expected = {
      [ESSAY]: 1,
      [QUIZ]: 1, // Dev's quiz is Excused
      [LAB]: 2,
      [EXIT]: 2,
      [JOURNAL]: 2,
      [CLAIM]: 2,
      [TALK]: 4,
      [BENCH]: 0,
    };
    const total = Object.values(expected).reduce((a, b) => a + b, 0);
    Object.keys(expected).forEach(aid => expect(menuCount(aid), aid).toBe(expected[aid]));
    expect(pill().textContent).toBe(total + ' to return');
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelectorAll('#gb-data .gb-draft').length).toBe(total);
    showCompetencies();
    expect(pill().textContent).toBe(total + ' to return');
    Object.keys(expected).forEach(aid => {
      const button = headerButton(aid);
      expect(button ? button.textContent : 'Return 0 Graded', aid).toBe('Return ' + expected[aid] + ' Graded');
    });
    expect(headerButtons().length).toBe(7);
  });

  it('who is waiting is named, by first name', () => {
    open();
    const sentence = aid => {
      const note = openColumnMenu(aid).querySelector('.gb-ctx-note').textContent;
      closeMenu();
      return note;
    };
    Grader.setPoints(CID, DEV, EXIT, 1);
    redraw();
    expect(sentence(EXIT)).toBe('1 draft: Dev can’t see it yet.');
    Grader.setPoints(CID, BEN, EXIT, 1);
    redraw();
    expect(sentence(EXIT)).toBe('2 drafts: Ben and Dev can’t see them yet.');
    Grader.setPoints(CID, ELI, EXIT, 1);
    redraw();
    expect(sentence(EXIT)).toBe('3 drafts: Ben, Dev and Eli can’t see them yet.');
    Grader.setPoints(CID, CARA, EXIT, 1);
    Grader.setPoints(CID, AVA, EXIT, 0);
    redraw();
    expect(sentence(EXIT)).toBe('5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.');
    // The same line is the Competencies button's tip.
    showCompetencies();
    expect(headerButton(EXIT).getAttribute('title')).toBe('5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.');
    // The note sits above Return N Graded, the menu's first item.
    showScores();
    const menu = openColumnMenu(EXIT);
    expect(menu.firstElementChild.className).toBe('gb-ctx-note');
    expect(menu.querySelector('.gb-ctx-item').textContent).toBe('Return 5 Graded');
    expect(menu.querySelector('.gb-ctx-item').getAttribute('role')).toBe('menuitem');
  });

  it('Return N Graded in a Scores column’s menu returns that column’s drafts in one action, through the one grader', () => {
    open();
    [BEN, CARA, DEV].forEach(sid => Grader.setLevel(CID, sid, LAB, SAFETY, 3, 0));
    Grader.setPoints(CID, BEN, QUIZ, 8);
    redraw();
    expect(pill().textContent).toBe('4 to return');
    const returned = vi.spyOn(Grader, 'returnGrades');
    openColumnMenu(LAB);
    expect(returnItem().textContent).toBe('Return 3 Graded');
    click(returnItem());
    // One click: the line above the item has named who, so nothing asks.
    expect(confirmDialog()).toBe(null);
    expect(returned.mock.calls).toEqual([[CID, LAB, [BEN, CARA, DEV]]]);
    returned.mockRestore();
    expect(document.querySelector('.gb-ctx-menu')).toBe(null);
    [BEN, CARA, DEV].forEach(sid => {
      expect(GradeState.stateOf(CID, sid, LAB)).toBe('returned');
      expect(isDashed(scoresCell(LAB, sid))).toBe(false);
      expect(scoresCell(LAB, sid).getAttribute('style')).toMatch(/^background:/);
      expect(label(scoresCell(LAB, sid))).not.toContain('Draft');
    });
    // The other column's draft waits.
    expect(isDashed(scoresCell(QUIZ, BEN))).toBe(true);
    expect(pill().textContent).toBe('1 to return');
    expect(menuCount(LAB)).toBe(0);
    // The column's title has the focus back.
    expect(document.activeElement.className).toBe('gb-grid-colhead-label');
    expect(document.activeElement.closest('.gb-grid-colhead').getAttribute('data-aid')).toBe(LAB);
  });

  it('Return N Graded under a Competencies header asks first, naming who gets their grade', () => {
    open();
    [CARA, DEV].forEach(sid => Grader.setPoints(CID, sid, EXIT, 1));
    showCompetencies();
    const button = headerButton(EXIT);
    expect(button.textContent).toBe('Return 2 Graded');
    expect(button.tagName).toBe('BUTTON');
    // Under the date and badges, inside the assessment's own header.
    expect(button.previousElementSibling.className).toBe('gb-assess-meta');
    expect(button.parentNode.querySelector('.gb-assess-title').textContent).toBe('Exit Ticket');
    const returned = vi.spyOn(Grader, 'returnGrades');
    click(button);
    // The app's confirm dialog, and nothing returned yet.
    const dialog = confirmDialog();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('.confirm-title').textContent).toBe('Return 2 Grades Now?');
    expect(dialog.querySelector('.confirm-message').textContent).toBe(
      '2 drafts: Cara and Dev can\u2019t see them yet.',
    );
    const buttons = Array.from(dialog.querySelectorAll('.confirm-actions button'));
    expect(buttons.map(b => b.textContent)).toEqual(['Cancel', 'Return 2 Graded']);
    expect(buttons[1].className).toBe('confirm-ok primary');
    expect(returned.mock.calls).toEqual([]);
    expect(dialogDrafts(EXIT)).toEqual([CARA, DEV]);
    returned.mockRestore();
  });

  it('for one draft the dialog says Grade, not Grades', () => {
    open();
    Grader.setPoints(CID, DEV, EXIT, 1);
    showCompetencies();
    expect(headerButton(EXIT).textContent).toBe('Return 1 Graded');
    click(headerButton(EXIT));
    const dialog = confirmDialog();
    expect(dialog.querySelector('.confirm-title').textContent).toBe('Return 1 Grade Now?');
    expect(dialog.querySelector('.confirm-message').textContent).toBe('1 draft: Dev can\u2019t see it yet.');
    expect(dialog.querySelector('#confirm-ok-btn').textContent).toBe('Return 1 Graded');
    cancelConfirm();
  });

  it('Cancel returns nothing and gives the header button the focus back', () => {
    open();
    [CARA, DEV].forEach(sid => Grader.setPoints(CID, sid, EXIT, 1));
    showCompetencies();
    const before = main();
    const returned = vi.spyOn(Grader, 'returnGrades');
    click(headerButton(EXIT));
    expect(confirmDialog()).not.toBe(null);
    cancelConfirm();
    expect(confirmDialog()).toBe(null);
    expect(returned.mock.calls).toEqual([]);
    returned.mockRestore();
    expect(dialogDrafts(EXIT)).toEqual([CARA, DEV]);
    expect(main()).toBe(before);
    expect(pill().textContent).toBe('2 to return');
    expect(document.activeElement).toBe(headerButton(EXIT));
    // Escape is Cancel too.
    click(headerButton(EXIT));
    key(document, 'Escape');
    expect(confirmDialog()).toBe(null);
    expect(dialogDrafts(EXIT)).toEqual([CARA, DEV]);
    expect(document.activeElement).toBe(headerButton(EXIT));
  });

  it('confirming returns the column’s drafts through the one grader, and the title takes the focus', () => {
    open();
    [CARA, DEV].forEach(sid => Grader.setPoints(CID, sid, EXIT, 1));
    showCompetencies();
    const returned = vi.spyOn(Grader, 'returnGrades');
    click(headerButton(EXIT));
    confirmOk();
    expect(confirmDialog()).toBe(null);
    expect(returned.mock.calls).toEqual([[CID, EXIT, [CARA, DEV]]]);
    returned.mockRestore();
    expect(headerButtons()).toEqual([]);
    expect(pill()).toBe(null);
    expect(isDashed(compCell(EXIT, CARA))).toBe(false);
    expect(document.activeElement.className).toBe('gb-assess-title');
    expect(document.activeElement.textContent).toBe('Exit Ticket');
  });

  it('the drafts are counted again at the moment of confirming', () => {
    open();
    [CARA, DEV].forEach(sid => Grader.setPoints(CID, sid, EXIT, 1));
    showCompetencies();
    click(headerButton(EXIT));
    expect(confirmDialog().querySelector('.confirm-title').textContent).toBe('Return 2 Grades Now?');
    // One of the two is returned somewhere else while the dialog is up.
    Grader.returnGrades(CID, EXIT, [CARA]);
    const returned = vi.spyOn(Grader, 'returnGrades');
    confirmOk();
    expect(returned.mock.calls).toEqual([[CID, EXIT, [DEV]]]);
    expect(dialogDrafts(EXIT)).toEqual([]);
    // With none left, confirming does nothing.
    Grader.setPoints(CID, BEN, EXIT, 1);
    redraw();
    click(headerButton(EXIT));
    Grader.returnGrades(CID, EXIT, [BEN]);
    returned.mockClear();
    const drawn = main();
    confirmOk();
    expect(returned.mock.calls).toEqual([]);
    expect(main()).toBe(drawn);
    returned.mockRestore();
  });

  it('pair work is returned together, as the grader dialog returns it', () => {
    open();
    Grader.setLevel(CID, BEN, TALK, QUESTION, 4, 0);
    redraw();
    expect(dialogDrafts(TALK)).toEqual([AVA, BEN]);
    expect(menuCount(TALK)).toBe(2);
    // With only Ben on screen the pill counts the draft on screen, and the
    // column's Return counts and names who it returns: the pair.
    search('ben');
    expect(rowIds()).toEqual([BEN]);
    expect(pill().textContent).toBe('1 to return');
    expect(document.querySelectorAll('#gb-data .gb-draft').length).toBe(1);
    const returned = vi.spyOn(Grader, 'returnGrades');
    let menu = openColumnMenu(TALK);
    expect(menu.querySelector('.gb-ctx-note').textContent).toBe('2 drafts: Ava and Ben can\u2019t see them yet.');
    expect(returnItem().textContent).toBe('Return 2 Graded');
    click(returnItem());
    // The grader is handed the pair, as the dialog's Return hands it.
    expect(returned.mock.calls).toEqual([[CID, TALK, [BEN, AVA]]]);
    expect(returned.mock.results[0].value.enrollment_ids).toEqual([BEN, AVA]);
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    expect(GradeState.stateOf(CID, AVA, TALK)).toBe('returned');
    search('');
    expect(pill()).toBe(null);
    expect(isDashed(scoresCell(TALK, AVA))).toBe(false);

    // The same under a Competencies header: the button, the dialog's title,
    // its message and its button all say two, and both are returned.
    Grader.setLevel(CID, BEN, TALK, QUESTION, 1, 0);
    search('ben');
    showCompetencies();
    expect(pill().textContent).toBe('1 to return');
    expect(headerButton(TALK).textContent).toBe('Return 2 Graded');
    expect(headerButton(TALK).getAttribute('title')).toBe('2 drafts: Ava and Ben can\u2019t see them yet.');
    click(headerButton(TALK));
    expect(confirmDialog().querySelector('.confirm-title').textContent).toBe('Return 2 Grades Now?');
    expect(confirmDialog().querySelector('.confirm-message').textContent).toBe(
      '2 drafts: Ava and Ben can\u2019t see them yet.',
    );
    expect(confirmDialog().querySelector('#confirm-ok-btn').textContent).toBe('Return 2 Graded');
    returned.mockClear();
    confirmOk();
    expect(returned.mock.results[0].value.enrollment_ids).toEqual([BEN, AVA]);
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    expect(GradeState.stateOf(CID, AVA, TALK)).toBe('returned');

    // The hidden partner's piece is already returned: one draft, one name.
    Grader.setLevel(CID, BEN, TALK, QUESTION, 3, 0);
    Grader.returnGrades(CID, TALK, [AVA]);
    expect(dialogDrafts(TALK)).toEqual([BEN]);
    redraw();
    expect(headerButton(TALK).textContent).toBe('Return 1 Graded');
    click(headerButton(TALK));
    expect(confirmDialog().querySelector('.confirm-title').textContent).toBe('Return 1 Grade Now?');
    expect(confirmDialog().querySelector('.confirm-message').textContent).toBe('1 draft: Ben can\u2019t see it yet.');
    cancelConfirm();
    showScores();
    menu = openColumnMenu(TALK);
    expect(menu.querySelector('.gb-ctx-note').textContent).toBe('1 draft: Ben can\u2019t see it yet.');
    expect(returnItem().textContent).toBe('Return 1 Graded');
    returned.mockClear();
    click(returnItem());
    expect(returned.mock.results[0].value.enrollment_ids).toEqual([BEN]);
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    returned.mockRestore();
    search('');

    // A member graded separately is not returned with the pair.
    Grader.gradeSeparately(CID, TALK, AVA);
    Grader.setLevel(CID, AVA, TALK, QUESTION, 2, 0);
    Grader.setLevel(CID, BEN, TALK, QUESTION, 4, 0);
    expect(dialogDrafts(TALK)).toEqual([AVA, BEN]);
    search('ben');
    openColumnMenu(TALK);
    expect(returnItem().textContent).toBe('Return 1 Graded');
    expect(document.querySelector('.gb-ctx-note').textContent).toBe('1 draft: Ben can\u2019t see it yet.');
    click(returnItem());
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    expect(GradeState.stateOf(CID, AVA, TALK)).toBe('draft');
  });

  it('"N to return" is a filter: only the students and assessments with a draft', () => {
    open();
    Grader.setPoints(CID, BEN, QUIZ, 8);
    Grader.setPoints(CID, DEV, EXIT, 1);
    Grader.setPoints(CID, BEN, EXIT, 1);
    redraw();
    const everyone = rowIds();
    const everyColumn = columnIds();
    expect(everyone).toEqual(EVERYONE);
    expect(everyColumn.length).toBe(8);
    const whole = numbers();
    click(pill());
    expect(pill().getAttribute('aria-pressed')).toBe('true');
    expect(pill().classList.contains('active')).toBe(true);
    expect(pill().textContent).toBe('3 to return ×');
    expect(document.activeElement).toBe(pill());
    expect(rowIds()).toEqual([BEN, DEV]);
    // Newest first: the Exit Ticket, then the Quiz.
    expect(columnIds()).toEqual([EXIT, QUIZ]);
    // The cells on screen that are not drafts stay plain.
    expect(isDashed(scoresCell(QUIZ, BEN))).toBe(true);
    expect(isDashed(scoresCell(QUIZ, DEV))).toBe(false);
    expect(document.querySelectorAll('#gb-data .gb-draft').length).toBe(3);
    // The same rows and columns in the Competencies view.
    showCompetencies();
    expect(rowIds()).toEqual([BEN, DEV]);
    expect(headerButtons().map(b => b.getAttribute('data-aid'))).toEqual([EXIT, QUIZ]);
    expect(document.querySelectorAll('.gb-grid-assess-group').length).toBe(2);
    showScores();
    // Each student's Overall and the Class Average are the whole class's.
    const shown = numbers();
    expect(shown.slice(0, 2)).toEqual([whole[1], whole[3]]);
    expect(shown[2]).toBe(whole[5]);
    // Off again: everything is back.
    click(pill());
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    expect(pill().textContent).toBe('3 to return');
    expect(rowIds()).toEqual(everyone);
    expect(columnIds()).toEqual(everyColumn);
  });

  it('returning the last draft under the filter shows the whole gradebook again', () => {
    open();
    Grader.setPoints(CID, BEN, QUIZ, 8);
    Grader.setPoints(CID, DEV, EXIT, 1);
    redraw();
    click(pill());
    expect(columnIds()).toEqual([EXIT, QUIZ]);
    openColumnMenu(QUIZ);
    click(returnItem());
    // One column and one student left.
    expect(pill().textContent).toBe('1 to return ×');
    expect(columnIds()).toEqual([EXIT]);
    expect(rowIds()).toEqual([DEV]);
    openColumnMenu(EXIT);
    click(returnItem());
    expect(pill()).toBe(null);
    expect(rowIds()).toEqual(EVERYONE);
    expect(columnIds().length).toBe(8);
    expect(document.querySelector('.gb-empty')).toBe(null);
  });

  it('a search narrows the counts to the students shown', () => {
    open();
    [BEN, CARA, DEV].forEach(sid => Grader.setPoints(CID, sid, EXIT, 1));
    redraw();
    expect(pill().textContent).toBe('3 to return');
    search('dev');
    expect(pill().textContent).toBe('1 to return');
    expect(menuCount(EXIT)).toBe(1);
    openColumnMenu(EXIT);
    click(returnItem());
    search('');
    expect(pill().textContent).toBe('2 to return');
    expect(dialogDrafts(EXIT)).toEqual([BEN, CARA]);
  });

  it('no number moves because a grade is a draft: the gradebook counts all work', () => {
    // The same grades in a class that holds them and in one that does not.
    const drawn = config => {
      mount(seedWith({ config }), { course: CID });
      gradeEverything(DEV);
      gradeEverything(BEN);
      Grader.setLevel(CID, AVA, ESSAY, QUESTION, 1, 0);
      redraw();
      const out = { scores: numbers(), overall: EVERYONE.map(sid => getOverallProficiency(CID, sid)) };
      out.cells = Array.from(document.querySelectorAll('#gb-data td.gb-scores-cell')).map(td => td.textContent);
      showCompetencies();
      out.competencies = numbers();
      out.tiles = Array.from(document.querySelectorAll('#gb-data td.gb-score')).map(td => td.textContent);
      out.drafts = document.querySelectorAll('#gb-data .gb-draft').length;
      unmount();
      clearClass(CID);
      return out;
    };
    const held = drawn(HELD);
    const plain = drawn({});
    expect(held.drafts).toBeGreaterThan(10);
    expect(plain.drafts).toBe(0);
    ['scores', 'overall', 'cells', 'competencies', 'tiles'].forEach(part =>
      expect(held[part], part).toEqual(plain[part]),
    );
    // And the grades moved: Dev had none before.
    expect(held.overall[3]).toBeGreaterThan(0);
  });

  it('a class change clears the filter', () => {
    open();
    Grader.setPoints(CID, BEN, QUIZ, 8);
    redraw();
    click(pill());
    expect(rowIds()).toEqual([BEN]);
    PageGradebook.destroy();
    PageGradebook.init({ course: CID });
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    expect(rowIds()).toEqual(EVERYONE);
  });
});

/* Plan S1: "counts agree across gradebook, grader and phone for the same
   class". The gradebook's side: its counts against the function the grader
   dialog reads for its Draft row (GradeState.stateOf), and against Class
   Settings' count of the class (GradeState.draftsWaiting, S1-F4). */
describe.skipIf(UPDATE)('the gradebook’s counts agree with the grader dialog’s and Class Settings’', () => {
  it('each column’s Return N Graded is the students the dialog shows as Draft, and the sum is draftsWaiting', () => {
    open();
    gradeEverything(DEV);
    gradeEverything(CARA);
    gradeEverything(BEN);
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 1, 0);
    Grader.setOverallComment(CID, ELI, BENCH, 'Read with expression.');
    applyAssignmentStatus(CID, ELI, EXIT, 'LATE');
    const check = () => {
      redraw();
      let sum = 0;
      columnIds().forEach(aid => {
        const waiting = dialogDrafts(aid);
        expect(menuCount(aid), aid).toBe(waiting.length);
        expect(
          EVERYONE.filter(sid => isDashed(scoresCell(aid, sid))),
          aid,
        ).toEqual(waiting);
        sum += waiting.length;
      });
      expect(pillCount()).toBe(sum);
      expect(sum).toBe(GradeState.draftsWaiting(CID));
      showCompetencies();
      expect(pillCount()).toBe(sum);
      expect(headerButtons().reduce((n, b) => n + parseInt(b.textContent.replace('Return ', ''), 10), 0)).toBe(sum);
      showScores();
      return sum;
    };
    const first = check();
    expect(first).toBeGreaterThan(15);
    // A benchmark has no Draft state, whatever is saved on it: its Overall
    // Comment is on no count, its cell is plain and its column has no Return.
    expect(dialogDrafts(BENCH)).toEqual([]);
    expect(isDashed(scoresCell(BENCH, ELI))).toBe(false);
    expect(menuCount(BENCH)).toBe(0);
    const lab = dialogDrafts(LAB).length;
    expect(lab).toBe(3);
    openColumnMenu(LAB);
    click(returnItem());
    expect(check()).toBe(first - lab);
  });
});
