/**
 * Pin: what the gradebook writes (teacher/page-gradebook.js), and Class
 * Results' own Mark Missing (teacher/class-results.js), before S1-T1 moves
 * these writes onto shared/grader.js.
 *
 * The gradebook is drawn on a linkedom document and worked the way a
 * teacher works it. A click on a cell opens the grader dialog, whose
 * writes are pinned in tests/pin-grader-dialog-writes.test.js; what the
 * gradebook writes itself is pinned here:
 * - Scores view: a level or points typed into a cell (Edit Score), a blank
 *   box, and what writes nothing;
 * - the cell menu: Clear Score, Mark Missing, Excuse, Mark Late;
 * - the column menu: Mark Blank Cells Missing / Excused, its three ways
 *   back (the toast's Undo, Cmd+Z, Undo Marking Blank Cells) and Delete
 *   Assessment;
 * - Competencies view keys: 1 to 4, + and −, 0 / Backspace / Delete,
 *   points in the box, C / I / X on Complete/Incomplete work;
 * - Undo: Cmd+Z and the Score Cleared toast.
 * The gradebook has no paste and no fill but Mark Blank Cells.
 *
 * After each one this records which score writers in shared/data.js the
 * screen called, with which arguments, in which order
 * (tests/helpers/pin-writer-calls.js), the RPCs sent, in order, and what
 * the cache holds. It records today's behaviour, oddities included; the PR
 * that added it lists them.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { mount, showCompetencies } from './helpers/gradebook-dom.js';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  levels,
  storedMatchesCache,
  settle,
  click,
  key,
  fire,
  openAssignments,
  closePages,
  confirmOk,
  toastText,
} from './helpers/pin-save-paths.js';
import { recordWriters } from './helpers/pin-writer-calls.js';

// Loaded before the page starts, as teacher/app.html does.
runInThisContext(readFileSync('teacher/class-results.js', 'utf-8'), { filename: 'teacher/class-results.js' });

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric: its criteria have no competencies
const EXIT = U(34); // Complete/Incomplete
const JOURNAL = U(35); // a level on one competency; the work has no date
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74);
const STATION = U(75);

const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };
const WORK = {
  [ESSAY]: { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
  [QUIZ]: { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
  [LAB]: { id: LAB, title: 'Lab', rubricId: LAB_RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
  [EXIT]: {
    id: EXIT,
    title: 'Exit Ticket',
    scoreMode: 'complete',
    maxPoints: 1,
    tagIds: [QUESTION],
    date: '2026-10-13',
  },
  [JOURNAL]: { id: JOURNAL, title: 'Journal', tagIds: [QUESTION], type: 'formative' },
};

/* A score entry as the recorder and entries() show it (no `created`). */
const entry = (sid, aid, tagId, score, more) => ({
  id: sid + ':' + aid + ':' + tagId,
  assessmentId: aid,
  tagId,
  score,
  date: WORK[aid].date || '2026-09-01',
  type: 'summative',
  note: '',
  ...more,
});
const withClock = scores =>
  Object.fromEntries(
    Object.entries(scores).map(([sid, list]) => [sid, list.map(e => ({ ...e, created: '2026-10-10T17:00:00.000Z' }))]),
  );

function seedWith({ scores = {}, statuses = {}, rubricChecks = {} } = {}) {
  return () =>
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
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
              tagIds: [],
              levels: WORDS,
              checks: [
                { id: GOGGLES, level: 3, label: 'Goggles on' },
                { id: STATION, level: 3, label: 'Cleans the station' },
              ],
            },
            { id: METHOD, name: 'Method', tagIds: [], levels: WORDS, checks: [] },
          ],
        },
      ],
      assessments: Object.values(WORK),
      scores: withClock(scores),
      statuses,
      rubricChecks,
    });
}

/* ── The RPCs, as the recorder lists them ─────────────────────────────── */
const tagScore = (sid, aid, tag, value, modifier = 0) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_tag_id: tag,
    p_value: value,
    p_modifier: modifier,
    p_comment: null,
  },
];
const rubricScore = (sid, aid, criterion, value, modifier = 0) => [
  'upsert_rubric_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_criterion_id: criterion,
    p_value: value,
    p_modifier: modifier,
    p_comment: null,
    p_beyond: null,
  },
];
// Points and Complete/Incomplete marks: one value for the whole piece.
const score = (sid, aid, value) => ['upsert_score', { p_enrollment_id: sid, p_assessment_id: aid, p_value: value }];
const comment = (sid, aid, text) => [
  'save_score_comment',
  { p_enrollment_id: sid, p_assessment_id: aid, p_comment: text },
];
const status = (sid, aid, value) => [
  'set_score_status',
  { p_enrollment_id: sid, p_assessment_id: aid, p_status: value },
];
const check = (sid, aid, id, on) => [
  'set_rubric_check',
  { p_enrollment_id: sid, p_assessment_id: aid, p_check_id: id, p_on: on },
];
const clearRpc = (sid, aid) => ['clear_score', { p_enrollment_id: sid, p_assessment_id: aid }];

/* ── The grid's controls. It redraws after most saves, so each is looked
   up when it is used. ───────────────────────────────────────────────── */
const scoresCell = (aid, sid) =>
  document.querySelector('.gb-scores-cell[data-aid="' + aid + '"][data-sid="' + sid + '"]');
// A Competencies-view cell: a competency's or criterion's (`tid`), or the
// one points / mark cell of the work.
const compCell = (aid, sid, tid) =>
  document.querySelector(
    '#gb-data td.gb-score[data-aid="' +
      aid +
      '"][data-sid="' +
      sid +
      '"]' +
      (tid ? '[data-tid="' + tid + '"]' : '[data-pts="1"]'),
  );
const focused = () => document.querySelector('#gb-data td.gb-focus');
function select(cell) {
  document.querySelectorAll('#gb-data .gb-focus').forEach(el => el.classList.remove('gb-focus'));
  cell.classList.add('gb-focus');
  cell.focus();
  return cell;
}
// A key on the selected cell.
const press = (k, opts) => key(focused() || document.body, k, opts);
const cmdZ = () => key(document.body, 'z', { metaKey: true });
function rightClick(target, x) {
  const e = new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true });
  e.clientX = x;
  e.clientY = x ? 0 : 10;
  target.dispatchEvent(e);
}
const menuItem = ctx => document.querySelector('.gb-ctx-menu [data-ctx="' + ctx + '"]');
// The cell menu's item `ctx`, picked.
function cellMenu(cell, ctx) {
  rightClick(cell, 0);
  click(menuItem(ctx));
}
/* The column menu's item `ctx`, picked; false when the menu has none. The
   slanted titles find their column from the pointer position, and linkedom
   draws no layout: each column is given 100px. */
function columnMenu(aid, ctx) {
  const head = document.querySelector('.gb-grid-colhead[data-aid="' + aid + '"]');
  const heads = Array.from(head.parentNode.querySelectorAll('.gb-grid-colhead'));
  head.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100 * heads.length, height: 0 });
  heads[0].getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
  rightClick(head, 100 * heads.indexOf(head) + 10);
  const item = menuItem(ctx);
  if (item) click(item);
  return !!item;
}
// Edit Score's box in a Scores cell, opened by typing `digit` on the cell.
function editScore(aid, sid, digit) {
  select(scoresCell(aid, sid));
  press(digit);
  return scoresCell(aid, sid).querySelector('.gb-scores-input');
}
// Type `text` in a box and click away.
function typeAndLeave(box, text) {
  box.value = text;
  fire(box, 'blur');
}

describe('pin: the gradebook’s writes', () => {
  let session = null;
  let writers = null;
  let nodeEvent = null;

  function open(seed, view) {
    mount(
      () => {
        seedWith(seed)();
        if (view === 'criteria') localStorage.setItem('gb_rubricColumns_' + CID, 'criteria');
      },
      { course: CID },
    );
    // The page makes its own input event for a digit typed on a points cell.
    nodeEvent = globalThis.Event;
    globalThis.Event = document.defaultView.Event;
    if (view) showCompetencies();
    session = signIn();
    // Beside the score writers: the cell's clear on the server, and the two
    // other saves Delete Assessment makes, for their order.
    writers = recordWriters(['clearScore', 'saveAssessments', 'deleteAssessmentObservations']);
  }

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (writers) writers.stop();
    if (session) session.signOut();
    if (nodeEvent) globalThis.Event = nodeEvent;
    writers = session = nodeEvent = null;
    closePages();
    clearClass(CID);
  });

  describe('Scores view: a level typed into a cell (Edit Score)', () => {
    it('goes to every competency of the work: one upsertScore each, dated and typed from the work', async () => {
      open();
      const box = editScore(ESSAY, CARA, '3');
      expect(box.value).toBe('3');
      fire(box, 'blur');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, CARA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', ''],
        ['upsertScore', CID, CARA, ESSAY, PLAN, 3, '2026-10-10', 'summative', ''],
      ]);
      expect(entries(CID, CARA)).toEqual([entry(CARA, ESSAY, QUESTION, 3), entry(CARA, ESSAY, PLAN, 3)]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([tagScore(CARA, ESSAY, QUESTION, 3), tagScore(CARA, ESSAY, PLAN, 3)]);
    });

    it('a new level replaces each competency’s own level and its + or −', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { mod: 1 }), entry(AVA, ESSAY, PLAN, 2)] } });
      fire(editScore(ESSAY, AVA, '4'), 'blur');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, ESSAY, QUESTION, 4, '2026-10-10', 'summative', ''],
        ['upsertScore', CID, AVA, ESSAY, PLAN, 4, '2026-10-10', 'summative', ''],
      ]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 4, [PLAN]: 4 });
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 4), tagScore(AVA, ESSAY, PLAN, 4)]);
    });

    it('a blank box clears: a 0 to every competency; the entries stay at 0, and no toast shows', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, ESSAY, PLAN, 2)] } });
      typeAndLeave(editScore(ESSAY, AVA, '4'), '');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, ESSAY, QUESTION, 0, '2026-10-10', 'summative', ''],
        ['upsertScore', CID, AVA, ESSAY, PLAN, 0, '2026-10-10', 'summative', ''],
      ]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, ESSAY, QUESTION, 0), entry(AVA, ESSAY, PLAN, 0)]);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 0), tagScore(AVA, ESSAY, PLAN, 0)]);
      expect(toastText()).toBe(null);
    });

    it('the value the box opened with, a 9, a 3.5 and a 5 typed on the cell write nothing', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, ESSAY, PLAN, 3)] } });
      // 3 is what the cell holds: leaving the box as it opened saves nothing.
      cellMenu(scoresCell(ESSAY, AVA), 'editCell');
      const same = scoresCell(ESSAY, AVA).querySelector('.gb-scores-input');
      expect(same.value).toBe('3');
      fire(same, 'blur');
      typeAndLeave(editScore(ESSAY, AVA, '4'), '9');
      typeAndLeave(editScore(ESSAY, AVA, '4'), '3.5');
      // A 5 on the cell opens no box.
      expect(editScore(ESSAY, AVA, '5')).toBe(null);
      await settle();

      expect(writers.calls()).toEqual([]);
      expect(session.sent()).toEqual([]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3, [PLAN]: 3 });
    });

    it('on work with no date it passes today’s date, and a score already there is dated today', async () => {
      const today = courseToday(CID);
      open({ scores: { [AVA]: [entry(AVA, JOURNAL, QUESTION, 2, { type: 'formative' })] } });
      expect(entries(CID, AVA)[0].date).toBe('2026-09-01');
      fire(editScore(JOURNAL, AVA, '4'), 'blur');
      fire(editScore(JOURNAL, CARA, '1'), 'blur');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, JOURNAL, QUESTION, 4, today, 'formative', ''],
        ['upsertScore', CID, CARA, JOURNAL, QUESTION, 1, today, 'formative', ''],
      ]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, JOURNAL, QUESTION, 4, { type: 'formative', date: today })]);
      expect(entries(CID, CARA)).toEqual([entry(CARA, JOURNAL, QUESTION, 1, { type: 'formative', date: today })]);
      // The date is kept on this device only: it is not sent.
      expect(session.sent()).toEqual([tagScore(AVA, JOURNAL, QUESTION, 4), tagScore(CARA, JOURNAL, QUESTION, 1)]);
    });

    it('Missing work takes no typed level: no box opens and nothing is written', async () => {
      open({ statuses: { [CARA + ':' + ESSAY]: 'NS' } });
      expect(editScore(ESSAY, CARA, '3')).toBe(null);
      await settle();
      expect(writers.calls()).toEqual([]);
      expect(session.sent()).toEqual([]);
    });
  });

  describe('Scores view: points typed into a cell', () => {
    it('one setPointsScore for the piece; a 0 is a score; a blank box clears with null', async () => {
      open({ scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] } });
      fire(editScore(QUIZ, CARA, '7'), 'blur');
      fire(editScore(QUIZ, BEN, '0'), 'blur');
      typeAndLeave(editScore(QUIZ, AVA, '7'), '');
      await settle();

      expect(writers.calls()).toEqual([
        ['setPointsScore', CID, CARA, QUIZ, 7],
        ['setPointsScore', CID, BEN, QUIZ, 0],
        ['setPointsScore', CID, AVA, QUIZ, null],
      ]);
      expect(getPointsScore(CID, CARA, QUIZ)).toBe(7);
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(0);
      expect(entries(CID, AVA)).toEqual([]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([score(CARA, QUIZ, 7), score(BEN, QUIZ, 0), score(AVA, QUIZ, null)]);
    });

    it('the value the box opened with writes nothing', async () => {
      open({ scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] } });
      typeAndLeave(editScore(QUIZ, AVA, '7'), '8');
      await settle();
      expect(writers.calls()).toEqual([]);
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(8);
    });
  });

  describe('the cell menu', () => {
    it('Clear Score: the ticks come off, the entries go, the list is saved, then clear_score', async () => {
      const others = [entry(AVA, ESSAY, QUESTION, 3)];
      const lab = [entry(AVA, LAB, SAFETY, 3), entry(AVA, LAB, METHOD, 2, { mod: 1 })];
      open({ scores: { [AVA]: others.concat(lab) }, rubricChecks: { [AVA + ':' + LAB]: [GOGGLES, STATION] } });
      cellMenu(scoresCell(LAB, AVA), 'clearCell');
      await settle();

      expect(writers.calls()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, false],
        ['setRubricCheck', CID, AVA, LAB, STATION, false],
        ['clearScoreEntries', CID, { [AVA]: others.concat(lab) }, AVA, WORK[LAB], [SAFETY, METHOD]],
        ['saveScores', CID, { [AVA]: others }],
        // window.clearScore, after the grid is redrawn.
        ['clearScore', AVA, LAB],
      ]);
      expect(entries(CID, AVA)).toEqual(others);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // The saved list sends a 0 for each criterion; then the server is
      // asked to clear the cell as well.
      expect(session.sent()).toEqual([
        check(AVA, LAB, GOGGLES, false),
        check(AVA, LAB, STATION, false),
        rubricScore(AVA, LAB, SAFETY, 0),
        rubricScore(AVA, LAB, METHOD, 0),
        clearRpc(AVA, LAB),
      ]);
      expect(toastText()).toBe('Score cleared for Ava Adams');
    });

    it('the toast’s Undo saves the list with the entries back, sends each twice, then ticks the boxes', async () => {
      const others = [entry(AVA, ESSAY, QUESTION, 3)];
      const lab = [entry(AVA, LAB, SAFETY, 3), entry(AVA, LAB, METHOD, 2, { mod: 1 })];
      open({ scores: { [AVA]: others.concat(lab) }, rubricChecks: { [AVA + ':' + LAB]: [GOGGLES, STATION] } });
      cellMenu(scoresCell(LAB, AVA), 'clearCell');
      await settle();
      writers.since();
      session.since();
      executeUndo();
      await settle();

      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: others.concat(lab) }],
        ['persistScoreDiffToCanonical', CID, { [AVA]: others }, { [AVA]: others.concat(lab) }],
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, true],
        ['setRubricCheck', CID, AVA, LAB, STATION, true],
      ]);
      expect(entries(CID, AVA)).toEqual(others.concat(lab));
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES, STATION]);
      // saveScores sends what changed, and the gradebook then sends the
      // same change itself.
      expect(session.since()).toEqual([
        rubricScore(AVA, LAB, SAFETY, 3),
        rubricScore(AVA, LAB, METHOD, 2, 1),
        rubricScore(AVA, LAB, SAFETY, 3),
        rubricScore(AVA, LAB, METHOD, 2, 1),
        check(AVA, LAB, GOGGLES, true),
        check(AVA, LAB, STATION, true),
      ]);
      expect(toastText()).toBe(null);
    });

    it('Clear Score keeps the Overall Comment on one entry at 0, and sends the comment again', async () => {
      const essay = [
        entry(BEN, ESSAY, QUESTION, 3, { note: 'Solid work.' }),
        entry(BEN, ESSAY, PLAN, 3, { note: 'Solid work.' }),
      ];
      const kept = [entry(BEN, ESSAY, QUESTION, 0, { note: 'Solid work.' })];
      open({ scores: { [BEN]: essay } });
      cellMenu(scoresCell(ESSAY, BEN), 'clearCell');
      await settle();

      expect(writers.calls()).toEqual([
        ['clearScoreEntries', CID, { [BEN]: essay }, BEN, WORK[ESSAY], [QUESTION, PLAN]],
        ['saveScores', CID, { [BEN]: kept }],
        ['clearScore', BEN, ESSAY],
      ]);
      expect(entries(CID, BEN)).toEqual(kept);
      expect(session.sent()).toEqual([
        tagScore(BEN, ESSAY, QUESTION, 0),
        comment(BEN, ESSAY, 'Solid work.'),
        tagScore(BEN, ESSAY, PLAN, 0),
        clearRpc(BEN, ESSAY),
      ]);
    });

    it('Clear Score is off on a cell with no score', () => {
      open();
      rightClick(scoresCell(ESSAY, CARA), 0);
      expect(menuItem('clearCell').classList.contains('is-disabled')).toBe(true);
      click(menuItem('clearCell'));
      expect(writers.calls()).toEqual([]);
    });

    it('Mark Missing, Undo Missing, Excuse and Mark Late each call applyAssignmentStatus once', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      cellMenu(scoresCell(ESSAY, CARA), 'markMissing');
      await settle();
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, CARA, ESSAY, 'NS']]);
      // Missing on levels work also sends a 0 for each competency, though
      // the cell held none.
      expect(session.since()).toEqual([
        status(CARA, ESSAY, 'NS'),
        tagScore(CARA, ESSAY, QUESTION, 0),
        tagScore(CARA, ESSAY, PLAN, 0),
      ]);

      // The item reads Undo Missing now: picking it takes the status off.
      rightClick(scoresCell(ESSAY, CARA), 0);
      expect(menuItem('markMissing').textContent).toBe('Undo Missing');
      click(menuItem('markMissing'));
      await settle();
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, CARA, ESSAY, null]]);
      expect(session.since()).toEqual([status(CARA, ESSAY, null)]);

      cellMenu(scoresCell(ESSAY, BEN), 'excuseCell');
      cellMenu(scoresCell(ESSAY, AVA), 'lateCell');
      await settle();
      expect(writers.since()).toEqual([
        ['applyAssignmentStatus', CID, BEN, ESSAY, 'EXC'],
        ['applyAssignmentStatus', CID, AVA, ESSAY, 'LATE'],
      ]);
      expect(session.since()).toEqual([status(BEN, ESSAY, 'EXC'), status(AVA, ESSAY, 'LATE')]);
      expect(getAssignmentStatuses(CID)).toEqual({ [BEN + ':' + ESSAY]: 'EXC', [AVA + ':' + ESSAY]: 'LATE' });
      expect(storedMatchesCache('statuses', CID)).toBe(true);
    });

    it('Mark Missing and Excuse are off on work with a score, and write nothing', () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      rightClick(scoresCell(ESSAY, AVA), 0);
      expect(menuItem('markMissing').classList.contains('is-disabled')).toBe(true);
      expect(menuItem('excuseCell').classList.contains('is-disabled')).toBe(true);
      click(menuItem('markMissing'));
      expect(writers.calls()).toEqual([]);
      expect(getAssignmentStatuses(CID)).toEqual({});
    });
  });

  describe('the column menu', () => {
    const late = { [BEN + ':' + QUIZ]: 'LATE' };
    const seed = { scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] }, statuses: late };
    const marked = value => ({ ...late, [CARA + ':' + QUIZ]: value });

    it('Mark Blank Cells Missing saves the class’s whole status list once', async () => {
      open(seed);
      columnMenu(QUIZ, 'markUngradedNS');
      await settle();

      // Ava has a score and Ben is Late: only Cara's cell is blank.
      expect(writers.calls()).toEqual([['saveAssignmentStatuses', CID, marked('NS')]]);
      expect(getAssignmentStatuses(CID)).toEqual(marked('NS'));
      expect(storedMatchesCache('statuses', CID)).toBe(true);
      expect(session.sent()).toEqual([status(CARA, QUIZ, 'NS')]);
      expect(toastText()).toBe('1 blank cell marked Missing');
    });

    it('the toast’s Undo, Cmd+Z and Undo Marking Blank Cells each save the list without the marks', async () => {
      open(seed);
      columnMenu(QUIZ, 'markUngradedNS');
      await settle();
      writers.since();
      session.since();
      executeUndo();
      await settle();
      expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, late]]);
      expect(session.since()).toEqual([status(CARA, QUIZ, null)]);

      columnMenu(QUIZ, 'markUngradedEXC');
      await settle();
      expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, marked('EXC')]]);
      expect(session.since()).toEqual([status(CARA, QUIZ, 'EXC')]);
      expect(toastText()).toBe('1 blank cell marked Excused');
      cmdZ();
      await settle();
      expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, late]]);
      expect(session.since()).toEqual([status(CARA, QUIZ, null)]);

      columnMenu(QUIZ, 'markUngradedNS');
      await settle();
      dismissUndoToast();
      writers.since();
      session.since();
      expect(columnMenu(QUIZ, 'undoBulkStatus')).toBe(true);
      await settle();
      expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, late]]);
      expect(session.since()).toEqual([status(CARA, QUIZ, null)]);
      expect(getAssignmentStatuses(CID)).toEqual(late);
    });

    it('with no blank cell it writes nothing', async () => {
      open({
        scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)], [BEN]: [entry(BEN, QUIZ, QUESTION, 5)] },
        statuses: { [CARA + ':' + QUIZ]: 'EXC' },
      });
      columnMenu(QUIZ, 'markUngradedNS');
      await settle();
      expect(writers.calls()).toEqual([]);
      expect(toastText()).toBe(null);
    });

    it('Delete Assessment writes nothing until its toast closes, then the work, the scores, the observations', async () => {
      const essay = [entry(AVA, ESSAY, QUESTION, 3)];
      open({ scores: { [AVA]: essay.concat([entry(AVA, QUIZ, QUESTION, 8)]) }, statuses: late });
      columnMenu(QUIZ, 'deleteAssess');
      confirmOk();
      await settle();
      expect(toastText()).toBe('Deleted “Quiz”');
      expect(writers.calls()).toEqual([]);
      expect(session.sent()).toEqual([]);

      dismissUndoToast();
      await settle();
      // saveAssessments has already dropped the work's statuses, so the
      // gradebook's own saveAssignmentStatuses for them is never reached.
      expect(writers.calls()).toEqual([
        ['saveAssessments', CID, Object.values(WORK).filter(a => a.id !== QUIZ)],
        ['saveScores', CID, { [AVA]: essay }],
        ['deleteAssessmentObservations', CID, QUIZ],
      ]);
      expect(entries(CID, AVA)).toEqual(essay);
      expect(getAssignmentStatuses(CID)).toEqual({});
      // The server drops the work's scores and statuses with it.
      expect(session.sent()).toEqual([['delete_assessment', { p_id: QUIZ }]]);
    });
  });

  describe('Competencies view: keys on a level', () => {
    it('1 to 4 write the cell’s one competency and move down a row', async () => {
      open({}, 'competencies');
      select(compCell(ESSAY, AVA, QUESTION));
      press('3');
      await settle();

      expect(writers.calls()).toEqual([['upsertScore', CID, AVA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '']]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, ESSAY, QUESTION, 3)]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 3)]);
      expect(focused().dataset.sid).toBe(BEN);
      expect(focused().dataset.tid).toBe(QUESTION);
    });

    it('5 to 9 write nothing', async () => {
      open({}, 'competencies');
      select(compCell(ESSAY, AVA, QUESTION));
      press('5');
      press('9');
      await settle();
      expect(writers.calls()).toEqual([]);
      expect(session.sent()).toEqual([]);
    });

    it('+ and − write the level again with its mark; the same key again takes it off', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } }, 'competencies');
      select(compCell(ESSAY, AVA, QUESTION));
      press('+');
      press('=');
      press('-');
      press('_');
      press('-');
      await settle();

      const again = mod => ['upsertScore', CID, AVA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '', mod];
      expect(writers.calls()).toEqual([again(1), again(0), again(-1), again(0), again(-1)]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: '3-' });
      expect(session.sent()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 3, 1),
        tagScore(AVA, ESSAY, QUESTION, 3, 0),
        tagScore(AVA, ESSAY, QUESTION, 3, -1),
        tagScore(AVA, ESSAY, QUESTION, 3, 0),
        tagScore(AVA, ESSAY, QUESTION, 3, -1),
      ]);
      // The cell keeps the keyboard: + and − do not move down.
      expect(focused().dataset.sid).toBe(AVA);
    });

    it('+ on a cell with no level, and + on Extending, write nothing', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 4)] } }, 'competencies');
      select(compCell(ESSAY, AVA, QUESTION));
      press('+');
      select(compCell(ESSAY, CARA, QUESTION));
      press('+');
      press('-');
      await settle();
      expect(writers.calls()).toEqual([]);
    });

    it('+ on work with an Overall Comment passes the comment on, and it is sent again', async () => {
      const essay = [
        entry(BEN, ESSAY, QUESTION, 3, { note: 'Solid work.' }),
        entry(BEN, ESSAY, PLAN, 3, { note: 'Solid work.' }),
      ];
      open({ scores: { [BEN]: essay } }, 'competencies');
      select(compCell(ESSAY, BEN, QUESTION));
      press('+');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, BEN, ESSAY, QUESTION, 3, '2026-10-10', 'summative', 'Solid work.', 1],
      ]);
      expect(entries(CID, BEN)).toEqual([{ ...essay[0], mod: 1 }, essay[1]]);
      expect(session.sent()).toEqual([tagScore(BEN, ESSAY, QUESTION, 3, 1), comment(BEN, ESSAY, 'Solid work.')]);
    });

    it('0, Backspace and Delete write a 0 and show the Score Cleared toast', async () => {
      open(
        {
          scores: {
            [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, ESSAY, PLAN, 2)],
            [BEN]: [entry(BEN, ESSAY, QUESTION, 4)],
          },
        },
        'competencies',
      );
      select(compCell(ESSAY, AVA, QUESTION));
      press('0');
      select(compCell(ESSAY, AVA, PLAN));
      press('Backspace');
      select(compCell(ESSAY, BEN, QUESTION));
      press('Delete');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, ESSAY, QUESTION, 0, '2026-10-10', 'summative', ''],
        ['upsertScore', CID, AVA, ESSAY, PLAN, 0, '2026-10-10', 'summative', ''],
        ['upsertScore', CID, BEN, ESSAY, QUESTION, 0, '2026-10-10', 'summative', ''],
      ]);
      // The entries stay, at 0.
      expect(entries(CID, AVA)).toEqual([entry(AVA, ESSAY, QUESTION, 0), entry(AVA, ESSAY, PLAN, 0)]);
      expect(session.sent()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 0),
        tagScore(AVA, ESSAY, PLAN, 0),
        tagScore(BEN, ESSAY, QUESTION, 0),
      ]);
      expect(toastText()).toBe('Score cleared for Ben Brown');
      // Clearing does not move down.
      expect(focused().dataset.sid).toBe(BEN);
    });

    it('Backspace on a cell with no level still calls the writer: an entry at 0 is made and sent', async () => {
      open({}, 'competencies');
      select(compCell(ESSAY, CARA, QUESTION));
      press('Backspace');
      await settle();
      expect(writers.calls()).toEqual([['upsertScore', CID, CARA, ESSAY, QUESTION, 0, '2026-10-10', 'summative', '']]);
      expect(entries(CID, CARA)).toEqual([entry(CARA, ESSAY, QUESTION, 0)]);
      expect(session.sent()).toEqual([tagScore(CARA, ESSAY, QUESTION, 0)]);
      expect(toastText()).toBe(null);
    });

    it('on work with no date it passes no date: a score already there keeps its date, a new one gets today’s', async () => {
      open({ scores: { [AVA]: [entry(AVA, JOURNAL, QUESTION, 2, { type: 'formative' })] } }, 'competencies');
      select(compCell(JOURNAL, AVA, QUESTION));
      press('4');
      await settle();
      // The key moved down to Ben.
      press('1');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, JOURNAL, QUESTION, 4, undefined, 'formative', ''],
        ['upsertScore', CID, BEN, JOURNAL, QUESTION, 1, undefined, 'formative', ''],
      ]);
      // Not as the Scores view does it: there the old score is dated today.
      expect(entries(CID, AVA)).toEqual([entry(AVA, JOURNAL, QUESTION, 4, { type: 'formative', date: '2026-09-01' })]);
      expect(entries(CID, BEN)).toEqual([
        entry(BEN, JOURNAL, QUESTION, 1, { type: 'formative', date: courseToday(CID) }),
      ]);
    });

    it('on Missing work the writer is called and refuses: nothing is saved or sent', async () => {
      open({ statuses: { [CARA + ':' + ESSAY]: 'NS' } }, 'competencies');
      select(compCell(ESSAY, CARA, QUESTION));
      press('3');
      await settle();
      expect(writers.calls()).toEqual([['upsertScore', CID, CARA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '']]);
      expect(entries(CID, CARA)).toEqual([]);
      expect(session.sent()).toEqual([]);
    });

    it('a rubric criterion’s column takes the same keys, under the criterion’s id', async () => {
      open({}, 'criteria');
      select(compCell(LAB, CARA, METHOD));
      press('3');
      await settle();
      select(compCell(LAB, CARA, METHOD));
      press('-');
      press('0');
      await settle();

      expect(writers.calls()).toEqual([
        ['upsertScore', CID, CARA, LAB, METHOD, 3, '2026-10-12', 'summative', ''],
        ['upsertScore', CID, CARA, LAB, METHOD, 3, '2026-10-12', 'summative', '', -1],
        ['upsertScore', CID, CARA, LAB, METHOD, 0, '2026-10-12', 'summative', ''],
      ]);
      expect(session.sent()).toEqual([
        rubricScore(CARA, LAB, METHOD, 3),
        rubricScore(CARA, LAB, METHOD, 3, -1),
        rubricScore(CARA, LAB, METHOD, 0),
      ]);
    });
  });

  describe('Competencies view: points and Complete/Incomplete', () => {
    it('a digit opens the points box; Return saves with one setPointsScore and moves down', async () => {
      open({}, 'competencies');
      select(compCell(QUIZ, AVA));
      press('7');
      const box = compCell(QUIZ, AVA).querySelector('.gb-pts-input');
      expect(box.value).toBe('7');
      box.value = '7.5';
      key(box, 'Enter');
      await settle();

      expect(writers.calls()).toEqual([['setPointsScore', CID, AVA, QUIZ, 7.5]]);
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(7.5);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 7.5)]);
      expect(focused().dataset.sid).toBe(BEN);
    });

    it('leaving the box saves too, a 0 as a score and a blank as null', async () => {
      open({ scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] } }, 'competencies');
      select(compCell(QUIZ, BEN));
      press('0');
      fire(compCell(QUIZ, BEN).querySelector('.gb-pts-input'), 'blur');
      select(compCell(QUIZ, AVA));
      press('7');
      typeAndLeave(compCell(QUIZ, AVA).querySelector('.gb-pts-input'), '');
      await settle();

      expect(writers.calls()).toEqual([
        ['setPointsScore', CID, BEN, QUIZ, 0],
        ['setPointsScore', CID, AVA, QUIZ, null],
      ]);
      expect(session.sent()).toEqual([score(BEN, QUIZ, 0), score(AVA, QUIZ, null)]);
    });

    it('Delete clears the points with null and shows the toast', async () => {
      open({ scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] } }, 'competencies');
      select(compCell(QUIZ, AVA));
      press('Delete');
      await settle();

      expect(writers.calls()).toEqual([['setPointsScore', CID, AVA, QUIZ, null]]);
      expect(entries(CID, AVA)).toEqual([]);
      expect(session.sent()).toEqual([score(AVA, QUIZ, null)]);
      expect(toastText()).toBe('Score cleared for Ava Adams');
    });

    it('+ and − do nothing on points', async () => {
      open({ scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 8)] } }, 'competencies');
      select(compCell(QUIZ, AVA));
      press('+');
      press('-');
      await settle();
      expect(writers.calls()).toEqual([]);
    });

    it('C or 1 marks Complete and I or X Incomplete, each one setCompletionMark, and move down', async () => {
      open({}, 'competencies');
      select(compCell(EXIT, AVA));
      press('c');
      // Now on Ben.
      press('x');
      // Now on Cara.
      press('1');
      select(compCell(EXIT, AVA));
      press('I');
      await settle();

      expect(writers.calls()).toEqual([
        ['setCompletionMark', CID, AVA, EXIT, 'complete'],
        ['setCompletionMark', CID, BEN, EXIT, 'incomplete'],
        ['setCompletionMark', CID, CARA, EXIT, 'complete'],
        ['setCompletionMark', CID, AVA, EXIT, 'incomplete'],
      ]);
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('incomplete');
      expect(getCompletionMark(CID, BEN, EXIT)).toBe('incomplete');
      expect(getCompletionMark(CID, CARA, EXIT)).toBe('complete');
      // Complete is 1 and Incomplete is 0, on the score row.
      expect(session.sent()).toEqual([
        score(AVA, EXIT, 1),
        score(BEN, EXIT, 0),
        score(CARA, EXIT, 1),
        score(AVA, EXIT, 0),
      ]);
    });

    it('Backspace takes the mark off with a null mark and shows the toast', async () => {
      open({ scores: { [AVA]: [entry(AVA, EXIT, QUESTION, 1)] } }, 'competencies');
      select(compCell(EXIT, AVA));
      press('Backspace');
      await settle();

      expect(writers.calls()).toEqual([['setCompletionMark', CID, AVA, EXIT, null]]);
      expect(getCompletionMark(CID, AVA, EXIT)).toBe(null);
      expect(session.sent()).toEqual([score(AVA, EXIT, null)]);
      expect(toastText()).toBe('Score cleared for Ava Adams');
    });
  });

  describe('Undo (Cmd+Z, and the Score Cleared toast)', () => {
    it('Cmd+Z after a typed level saves the whole list with the old entries back, then sends the change again', async () => {
      const was = [entry(AVA, ESSAY, QUESTION, 3, { mod: 1 }), entry(AVA, ESSAY, PLAN, 2)];
      const typed = [entry(AVA, ESSAY, QUESTION, 4), entry(AVA, ESSAY, PLAN, 4)];
      const ben = [entry(BEN, ESSAY, QUESTION, 1)];
      open({ scores: { [AVA]: was, [BEN]: ben } });
      fire(editScore(ESSAY, AVA, '4'), 'blur');
      await settle();
      writers.since();
      session.since();
      cmdZ();
      await settle();

      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: was, [BEN]: ben }],
        ['persistScoreDiffToCanonical', CID, { [AVA]: typed, [BEN]: ben }, { [AVA]: was, [BEN]: ben }],
      ]);
      expect(entries(CID, AVA)).toEqual(was);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // Each cell is sent twice: once by saveScores, once by the gradebook.
      expect(session.since()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 3, 1),
        tagScore(AVA, ESSAY, PLAN, 2),
        tagScore(AVA, ESSAY, QUESTION, 3, 1),
        tagScore(AVA, ESSAY, PLAN, 2),
      ]);
    });

    it('Cmd+Z after a key in the Competencies view puts back that one edit', async () => {
      const was = [entry(AVA, ESSAY, QUESTION, 3)];
      open({ scores: { [AVA]: was } }, 'competencies');
      select(compCell(ESSAY, AVA, QUESTION));
      press('+');
      press('-');
      await settle();
      writers.since();
      session.since();
      cmdZ();
      await settle();

      // The + before the − comes back; a second Cmd+Z would take that off.
      const plus = [entry(AVA, ESSAY, QUESTION, 3, { mod: 1 })];
      const minus = [entry(AVA, ESSAY, QUESTION, 3, { mod: -1 })];
      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: plus }],
        ['persistScoreDiffToCanonical', CID, { [AVA]: minus }, { [AVA]: plus }],
      ]);
      expect(session.since()).toEqual([tagScore(AVA, ESSAY, QUESTION, 3, 1), tagScore(AVA, ESSAY, QUESTION, 3, 1)]);
    });

    it('the Score Cleared toast’s Undo puts a cleared level back the same way', async () => {
      const was = [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, ESSAY, PLAN, 2)];
      open({ scores: { [AVA]: was } }, 'competencies');
      select(compCell(ESSAY, AVA, PLAN));
      press('Backspace');
      await settle();
      writers.since();
      session.since();
      executeUndo();
      await settle();

      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: was }],
        ['persistScoreDiffToCanonical', CID, { [AVA]: [was[0], entry(AVA, ESSAY, PLAN, 0)] }, { [AVA]: was }],
      ]);
      expect(session.since()).toEqual([tagScore(AVA, ESSAY, PLAN, 2), tagScore(AVA, ESSAY, PLAN, 2)]);
    });

    it('Cmd+Z after cleared points and after a changed mark sends the old value twice', async () => {
      const quiz = [entry(AVA, QUIZ, QUESTION, 8)];
      const exit = [entry(AVA, EXIT, QUESTION, 1)];
      open({ scores: { [AVA]: quiz.concat(exit) } }, 'competencies');
      select(compCell(QUIZ, AVA));
      press('Delete');
      await settle();
      writers.since();
      session.since();
      cmdZ();
      await settle();
      // What Undo puts back goes to the end of the student's list.
      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: exit.concat(quiz) }],
        ['persistScoreDiffToCanonical', CID, { [AVA]: exit }, { [AVA]: exit.concat(quiz) }],
      ]);
      expect(session.since()).toEqual([score(AVA, QUIZ, 8), score(AVA, QUIZ, 8)]);

      select(compCell(EXIT, AVA));
      press('i');
      await settle();
      writers.since();
      session.since();
      cmdZ();
      await settle();
      expect(writers.since()).toEqual([
        ['saveScores', CID, { [AVA]: quiz.concat(exit) }],
        [
          'persistScoreDiffToCanonical',
          CID,
          { [AVA]: [entry(AVA, EXIT, QUESTION, 0), quiz[0]] },
          { [AVA]: quiz.concat(exit) },
        ],
      ]);
      expect(session.since()).toEqual([score(AVA, EXIT, 1), score(AVA, EXIT, 1)]);
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('complete');
    });

    it('with nothing to undo, and after the cell has changed since, Cmd+Z writes nothing', async () => {
      open({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } }, 'competencies');
      cmdZ();
      select(compCell(ESSAY, AVA, QUESTION));
      press('+');
      await settle();
      writers.stop();
      // Changed since, as the grader or another device would.
      upsertScore(CID, AVA, ESSAY, QUESTION, 2, '2026-10-10', 'summative', '');
      await settle();
      writers = recordWriters();
      session.since();
      cmdZ();
      await settle();
      expect(writers.calls()).toEqual([]);
      expect(session.since()).toEqual([]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 2 });
    });
  });

  describe('Demo Mode (writes off)', () => {
    it('the same writers are called and the scores are kept on this device', async () => {
      mount(seedWith(), { course: CID });
      showCompetencies();
      writers = recordWriters();
      select(compCell(ESSAY, AVA, QUESTION));
      press('3');
      await settle();
      expect(writers.calls()).toEqual([['upsertScore', CID, AVA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '']]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
    });
  });
});

describe('pin: Class Results’ Mark Missing, the writers it calls', () => {
  // What it saves and sends is pinned in
  // tests/pin-class-results-mark-missing.test.js; this adds the calls.
  let session = null;
  let writers = null;
  const late = { [BEN + ':' + EXIT]: 'LATE' };
  const seed = seedWith({ scores: { [AVA]: [entry(AVA, EXIT, QUESTION, 1)] }, statuses: late });
  const mark = which =>
    click(document.querySelector('#class-results [data-cr="markBlank"][data-status="' + which + '"]'));

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    ClassResults.close();
    if (writers) writers.stop();
    if (session) session.signOut();
    writers = session = null;
    closePages();
    clearClass(CID);
  });

  it('on the Assignments page it saves the whole status list, and again without the marks on Undo', async () => {
    openAssignments(seed, CID);
    session = signIn();
    writers = recordWriters();
    ClassResults.open(CID, EXIT);
    mark('NS');
    await settle();
    expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, { ...late, [CARA + ':' + EXIT]: 'NS' }]]);
    expect(session.since()).toEqual([status(CARA, EXIT, 'NS')]);

    executeUndo();
    await settle();
    expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, late]]);
    expect(session.since()).toEqual([status(CARA, EXIT, null)]);
  });

  it('on the gradebook it hands the job to Mark Blank Cells: the same call', async () => {
    mount(seed, { course: CID });
    session = signIn();
    writers = recordWriters();
    ClassResults.open(CID, EXIT);
    mark('EXC');
    await settle();
    expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, { ...late, [CARA + ':' + EXIT]: 'EXC' }]]);
    expect(session.since()).toEqual([status(CARA, EXIT, 'EXC')]);

    executeUndo();
    await settle();
    expect(writers.since()).toEqual([['saveAssignmentStatuses', CID, late]]);
    expect(session.since()).toEqual([status(CARA, EXIT, null)]);
  });
});
