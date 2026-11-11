/**
 * Pin: what the Assignments page writes (teacher/page-assignments.js),
 * before S1-T3 moves these writes onto shared/grader.js.
 *
 * The real page is drawn on a linkedom document and worked the way a
 * teacher works it: a card open for the whole class, a click or a key on
 * its grid. After each one this records
 * - which score writers in shared/data.js the page called, with which
 *   arguments, in which order (tests/helpers/pin-writer-calls.js), and,
 *   in the same list, each refreshSidebarGrades the page asked for;
 * - whether the page drew the card again (drew());
 * - the RPCs sent, in order, and what the cache holds.
 *
 * What is here:
 * - the rubric grid: a level, + and −, a clear and its Undo, the 1–4, +, −
 *   and 0 keys, an Advanced rubric's ticks, the criterion comment box, a
 *   single-point rubric's Work On and Went Beyond, the Overall Comment,
 *   Missing, and the Competencies view of rubric work;
 * - the competency grid: a level, + and −, a clear, work with no date and
 *   work scored as a whole;
 * - the fills: Set Everyone To, a row's fill and Clear, and their Undo
 *   (what they send is in tests/pin-assignments-fills.test.js);
 * - the points ledger and the Complete/Incomplete ledger, their keys,
 *   Set Unmarked to …, and their Undo;
 * - pair work on the list: a level, Grade Separately, a fill;
 * - the edit form: an Overall level carried onto newly ticked
 *   competencies, and Edit a Copy's score move;
 * - Delete Assessment;
 * - the grader dialog's points box and Note for the Report, which were
 *   left on data.js when the rest of the dialog moved (S0-T2);
 * - two paths no control on the page reaches (the comment popover's
 *   Overall Comment, a column fill), pressed through a made-up button so
 *   their writes are held too.
 *
 * It records today's behaviour, oddities included; the PR that added it
 * lists them.
 */
import './setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  tick,
  typeAndLeave,
  openAssignments,
  openGrader,
  closePages,
  confirmOk,
  toastText,
} from './helpers/pin-save-paths.js';
import { recordWriters } from './helpers/pin-writer-calls.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric: its criteria have no competencies
const EXIT = U(34); // Complete/Incomplete
const JOURNAL = U(35); // a level on one competency; the work has no date
const REPORT = U(36); // a rubric whose criteria feed competencies
const CLAIM = U(37); // a single-point rubric
const NOTES = U(38); // no competency: scored as a whole
const TALK = U(39); // pair work, a level on one competency
const DUET = U(40); // pair work, Complete/Incomplete
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74);
const STATION = U(75);
const REPORT_RUBRIC = U(81);
const EVIDENCE = U(82); // feeds Question
const REASONING = U(83); // feeds Question
const LAYOUT = U(84); // feeds Plan
const CLAIM_RUBRIC = U(91);
const CLEAR = U(92);

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
  [REPORT]: {
    id: REPORT,
    title: 'Report',
    rubricId: REPORT_RUBRIC,
    tagIds: [QUESTION, PLAN],
    date: '2026-10-14',
    type: 'summative',
  },
  [CLAIM]: { id: CLAIM, title: 'Claim', rubricId: CLAIM_RUBRIC, tagIds: [], date: '2026-10-15', type: 'summative' },
  [NOTES]: { id: NOTES, title: 'Notes', tagIds: [], date: '2026-10-16', type: 'formative' },
  [TALK]: {
    id: TALK,
    title: 'Talk',
    tagIds: [QUESTION],
    date: '2026-10-17',
    type: 'summative',
    collaboration: 'pair',
    pairs: [[AVA, BEN]],
  },
  [DUET]: {
    id: DUET,
    title: 'Duet',
    scoreMode: 'complete',
    maxPoints: 1,
    tagIds: [QUESTION],
    date: '2026-10-18',
    collaboration: 'pair',
    pairs: [[AVA, BEN]],
  },
};

/* A score entry as the recorder and entries() show it (no `created`). */
const entry = (sid, aid, tagId, score, more) => ({
  id: sid + ':' + aid + ':' + tagId,
  assessmentId: aid,
  tagId,
  score,
  date: WORK[aid].date || '2026-09-01',
  type: WORK[aid].type || 'summative',
  note: '',
  ...more,
});
const withClock = scores =>
  Object.fromEntries(
    Object.entries(scores).map(([sid, list]) => [sid, list.map(e => ({ ...e, created: '2026-10-10T17:00:00.000Z' }))]),
  );

/* `only` keeps the class to the work a pin is about. */
function seedWith({ only, scores = {}, statuses = {}, rubricChecks = {}, work = {} } = {}) {
  return () =>
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
        { id: DEV, firstName: 'Dev', lastName: 'Das' },
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
        {
          id: REPORT_RUBRIC,
          name: 'Report',
          criteria: [
            { id: EVIDENCE, name: 'Evidence', tagIds: [QUESTION], levels: WORDS, checks: [] },
            { id: REASONING, name: 'Reasoning', tagIds: [QUESTION], levels: WORDS, checks: [] },
            { id: LAYOUT, name: 'Layout', tagIds: [PLAN], levels: WORDS, checks: [] },
          ],
        },
        {
          id: CLAIM_RUBRIC,
          name: 'Claim',
          style: 'single_point',
          criteria: [{ id: CLEAR, name: 'Clear', tagIds: [], levels: WORDS, checks: [] }],
        },
      ],
      assessments: Object.values(WORK)
        .filter(a => !only || only.includes(a.id))
        .map(a => ({ ...a, ...work[a.id] })),
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
const rubricScore = (sid, aid, criterion, value, modifier = 0, comment = null, beyond = null) => [
  'upsert_rubric_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_criterion_id: criterion,
    p_value: value,
    p_modifier: modifier,
    p_comment: comment,
    p_beyond: beyond,
  },
];
// A whole-work level carries p_modifier; points, marks and a clear do not.
const score = (sid, aid, value, modifier) => [
  'upsert_score',
  modifier === undefined
    ? { p_enrollment_id: sid, p_assessment_id: aid, p_value: value }
    : { p_enrollment_id: sid, p_assessment_id: aid, p_value: value, p_modifier: modifier },
];
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
const twice = list => list.concat(list);

/* ── The writer calls, as the recorder lists them ─────────────────────── */
// A level through the page: dated and typed from the work, no comment, and
// the + or − only where the page passes one.
const level = (sid, aid, key, value, ...mod) => [
  'upsertScore',
  CID,
  sid,
  aid,
  key,
  value,
  WORK[aid].date,
  WORK[aid].type || 'formative',
  '',
  ...mod,
];
const sidebar = (...sid) => ['refreshSidebarGrades', ...sid];
/* The class's scores as the recorder shows a list it was handed. */
const scoresNow = () =>
  Object.fromEntries(Object.keys(getScores(CID)).map(sid => [sid, entries(CID, sid).map(e => ({ ...e }))]));

/* ── The page's controls. Rows are redrawn after some saves, so each is
   looked up when it is used. ─────────────────────────────────────────── */
const card = aid => document.getElementById('ac-' + aid);
const inCard = (aid, selector) => card(aid).querySelector(selector);
const critRow = (aid, sid, criterion) =>
  inCard(aid, '.rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + criterion + '"]');
const tagRow = (aid, sid, tag) =>
  inCard(aid, '.rsg-criterion-row.is-tag[data-student="' + sid + '"][data-tag="' + tag + '"]');
const levelOf = (row, n) => row.querySelector('.rsg-level.l' + n);
const plusMinus = (row, mod) => row.querySelector('.rsg-mod[data-mod="' + mod + '"]');
const chosen = row => Array.from(row.querySelectorAll('.rsg-level.active')).map(el => Number(el.dataset.level));
const statusButton = (aid, sid, which) =>
  inCard(aid, '[data-action="toggleStudentStatus"][data-sid="' + sid + '"][data-status="' + which + '"]');
const pointsBox = (aid, sid) => inCard(aid, '.ldg-pts-input[data-sid="' + sid + '"]');
const markButton = (aid, sid, which) =>
  inCard(aid, '[data-action="setCompletion"][data-sid="' + sid + '"][data-mark="' + which + '"]');
const ledgerRow = (aid, sid) => inCard(aid, '.ldg-row[data-status-student="' + sid + '"]');
const checkBox = (aid, sid, id) =>
  inCard(aid, '[data-action="tickRubricCheck"][data-sid="' + sid + '"][data-checkid="' + id + '"]');
const cmdZ = () => key(document.body, 'z', { metaKey: true });
/* A control the page does not draw, for a path nothing on it reaches. */
function madeUpButton(aid, attrs) {
  const btn = document.createElement('button');
  Object.keys(attrs).forEach(name => btn.setAttribute('data-' + name, attrs[name]));
  card(aid).appendChild(btn);
  return btn;
}

describe('pin: what the Assignments page writes', () => {
  let session = null;
  let writers = null;

  /* The page with one assessment's card open for the whole class. */
  function open(aid, seed, more) {
    openAssignments(seedWith(seed), CID, { open: aid });
    session = signIn();
    writers = recordWriters(['refreshSidebarGrades'].concat(more || []));
    mark(aid);
    // linkedom draws no layout. The criterion comment box asks which
    // comment buttons are on screen: here, all of them.
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('div')));
    if (!proto.getClientRects) proto.getClientRects = () => [{}];
  }
  /* drew(aid): has the page drawn the card again since the last look? */
  function mark(aid) {
    if (card(aid)) card(aid).setAttribute('data-pin-seen', '1');
  }
  function drew(aid) {
    const again = !card(aid) || !card(aid).hasAttribute('data-pin-seen');
    mark(aid);
    return again;
  }

  afterEach(() => {
    vi.useRealTimers();
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (writers) writers.stop();
    if (session) session.signOut();
    writers = session = null;
    closePages();
    clearClass(CID);
  });

  describe('the rubric grid', () => {
    it('a level is one upsertScore under the criterion’s id, then the sidebar; the row changes in place', () => {
      open(LAB);
      click(levelOf(critRow(LAB, AVA, METHOD), 3));

      expect(writers.calls()).toEqual([level(AVA, LAB, METHOD, 3), sidebar(AVA)]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, LAB, METHOD, 3)]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, 3)]);
      expect(chosen(critRow(LAB, AVA, METHOD))).toEqual([3]);
      expect(drew(LAB)).toBe(false);
      expect(toastText()).toBe(null);
    });

    it('+ and − pass the level again with the mark; a second press passes 0; a new level passes none', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3)] } });
      click(plusMinus(critRow(LAB, AVA, METHOD), 1));
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 3, 1), sidebar(AVA)]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3+' });
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 1)]);

      click(plusMinus(critRow(LAB, AVA, METHOD), 1));
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 3, 0), sidebar(AVA)]);
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 0)]);

      click(plusMinus(critRow(LAB, AVA, METHOD), -1));
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 3, -1), sidebar(AVA)]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3-' });
      session.since();

      click(levelOf(critRow(LAB, AVA, METHOD), 2));
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 2), sidebar(AVA)]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 2 });
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 2, 0)]);
      expect(drew(LAB)).toBe(false);
    });

    it('a + or − with no level, or one the level cannot take, writes nothing', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 4)] } });
      // No level yet: the buttons are not drawn, and the key does nothing.
      click(levelOf(critRow(LAB, BEN, METHOD), 3));
      click(levelOf(critRow(LAB, BEN, METHOD), 3));
      dismissUndoToast();
      writers.since();
      key(document.body, '+');
      // Extending takes no +.
      click(critRow(LAB, AVA, METHOD));
      key(document.body, '+');
      expect(writers.since()).toEqual([]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 4 });
    });

    it('the chosen level clicked again clears it: a 0, the Score Cleared toast, and Undo puts it back', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3, { mod: -1 })] } });
      const before = scoresNow();
      click(levelOf(critRow(LAB, AVA, METHOD), 3));

      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 0), sidebar(AVA)]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, LAB, METHOD, 0)]);
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 0)]);
      expect(chosen(critRow(LAB, AVA, METHOD))).toEqual([]);
      expect(toastText()).toBe('Score cleared');
      expect(drew(LAB)).toBe(false);
      const after = scoresNow();

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3-' });
      expect(session.since()).toEqual(twice([rubricScore(AVA, LAB, METHOD, 3, -1)]));
      expect(drew(LAB)).toBe(true);
    });

    it('Cmd+Z takes the Score Cleared toast’s Undo while it is up', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3)] } });
      const before = scoresNow();
      click(levelOf(critRow(LAB, AVA, METHOD), 3));
      const after = scoresNow();
      writers.since();
      cmdZ();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 3 });
      // Nothing more to undo.
      cmdZ();
      expect(writers.since()).toEqual([]);
    });

    it('the 1–4, +, − and 0 keys on the row last clicked write what the clicks do', () => {
      open(LAB);
      click(critRow(LAB, AVA, METHOD));
      key(document.body, '2');
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 2), sidebar(AVA)]);

      // The key moved down a row; click back.
      click(critRow(LAB, AVA, METHOD));
      key(document.body, '=');
      key(document.body, '-');
      expect(writers.since()).toEqual([
        level(AVA, LAB, METHOD, 2, 1),
        sidebar(AVA),
        level(AVA, LAB, METHOD, 2, -1),
        sidebar(AVA),
      ]);

      key(document.body, 'Backspace');
      expect(writers.since()).toEqual([level(AVA, LAB, METHOD, 0), sidebar(AVA)]);
      expect(toastText()).toBe('Score cleared');
      // Nothing chosen now: 0 writes nothing.
      dismissUndoToast();
      click(critRow(LAB, AVA, METHOD));
      key(document.body, '0');
      expect(writers.since()).toEqual([]);
      expect(session.sent()).toEqual([
        rubricScore(AVA, LAB, METHOD, 2),
        rubricScore(AVA, LAB, METHOD, 2, 1),
        rubricScore(AVA, LAB, METHOD, 2, -1),
        rubricScore(AVA, LAB, METHOD, 0),
      ]);
    });

    it('Missing work takes no level and no tick: no writer is called', () => {
      open(LAB, { statuses: { [AVA + ':' + LAB]: 'NS' } });
      click(levelOf(critRow(LAB, AVA, METHOD), 3));
      const box = checkBox(LAB, AVA, GOGGLES);
      tick(box, true);
      expect(writers.calls()).toEqual([]);
      expect(session.sent()).toEqual([]);
      expect(entries(CID, AVA)).toEqual([]);
    });

    it('Missing on unscored work is applyAssignmentStatus; the status goes, then a 0 for each criterion', () => {
      open(LAB);
      click(statusButton(LAB, BEN, 'NS'));
      expect(writers.calls()).toEqual([['applyAssignmentStatus', CID, BEN, LAB, 'NS'], sidebar(BEN)]);
      expect(getAssignmentStatus(CID, BEN, LAB)).toBe('NS');
      expect(session.sent()).toEqual([
        status(BEN, LAB, 'NS'),
        rubricScore(BEN, LAB, SAFETY, 0),
        rubricScore(BEN, LAB, METHOD, 0),
      ]);
      expect(drew(LAB)).toBe(false);
    });

    it('a tick is setRubricCheck; the tick that completes a level writes that level after it', () => {
      open(LAB);
      tick(checkBox(LAB, AVA, GOGGLES), true);
      expect(writers.since()).toEqual([['setRubricCheck', CID, AVA, LAB, GOGGLES, true]]);
      expect(session.since()).toEqual([check(AVA, LAB, GOGGLES, true)]);

      tick(checkBox(LAB, AVA, STATION), true);
      expect(writers.since()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, STATION, true],
        level(AVA, LAB, SAFETY, 3),
        sidebar(AVA),
      ]);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES, STATION]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3 });
      expect(session.since()).toEqual([check(AVA, LAB, STATION, true), rubricScore(AVA, LAB, SAFETY, 3)]);

      // Clearing a tick takes the suggested level back to 0.
      tick(checkBox(LAB, AVA, GOGGLES), false);
      expect(writers.since()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, false],
        level(AVA, LAB, SAFETY, 0),
        sidebar(AVA),
      ]);
      expect(session.since()).toEqual([check(AVA, LAB, GOGGLES, false), rubricScore(AVA, LAB, SAFETY, 0)]);
      expect(drew(LAB)).toBe(false);
    });

    it('a level picked by hand stays when the boxes say otherwise: the tick alone is written', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, SAFETY, 2)] } });
      tick(checkBox(LAB, AVA, GOGGLES), true);
      tick(checkBox(LAB, AVA, STATION), true);
      expect(writers.calls()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, true],
        ['setRubricCheck', CID, AVA, LAB, STATION, true],
      ]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 2 });
    });

    describe('the criterion comment box', () => {
      function openBox(sid, criterion) {
        click(critRow(LAB, sid, criterion).querySelector('[data-action="openCriterionComment"]'));
        // The overlay cancels on a click on its backdrop (`e.target ===
        // this`). linkedom calls an onclick with `this` as the click's
        // target, so every click inside the box would cancel it first.
        document.getElementById('crit-comment-overlay').onclick = null;
      }
      const field = () => document.getElementById('crit-comment-input');
      const press = action => click(document.querySelector('#crit-comment-overlay [data-action="' + action + '"]'));
      function type(text) {
        field().value = text;
        fire(field(), 'input');
      }

      it('Save is saveRubricCriterionComment with the trimmed text; on an unscored criterion a null level goes up', () => {
        open(LAB);
        openBox(AVA, METHOD);
        type('  Label the axes ');
        press('saveCriterionComment');

        expect(writers.calls()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, METHOD, 'Label the axes']]);
        expect(entries(CID, AVA)).toEqual([entry(AVA, LAB, METHOD, 0, { critNote: 'Label the axes' })]);
        expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, null, 0, 'Label the axes')]);
        expect(critRow(LAB, AVA, METHOD).querySelector('.rsg-crit-note').textContent).toBe('Label the axes');
        expect(drew(LAB)).toBe(false);
      });

      it('unchanged text saves nothing; Remove Comment saves ""', () => {
        open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3, { critNote: 'Label the axes' })] } });
        openBox(AVA, METHOD);
        field().focus();
        key(field(), 'Enter');
        expect(writers.calls()).toEqual([]);
        expect(field()).toBe(null);

        openBox(AVA, METHOD);
        press('removeCriterionComment');
        expect(writers.calls()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, METHOD, '']]);
        expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 0, '')]);
        expect(critRow(LAB, AVA, METHOD).querySelector('.rsg-crit-note')).toBe(null);
      });

      it('Enter saves; Cmd+Enter saves and opens the next criterion’s box', () => {
        open(LAB);
        openBox(AVA, SAFETY);
        type('Goggles');
        field().focus();
        key(field(), 'Enter', { metaKey: true });
        expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, SAFETY, 'Goggles']]);

        // The box is now Method's.
        expect(document.querySelector('#crit-comment-overlay .crit-comment-crit').textContent).toBe('Method');
        type('Two trials');
        field().focus();
        key(field(), 'Enter');
        expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, METHOD, 'Two trials']]);
        expect(session.sent()).toEqual([
          rubricScore(AVA, LAB, SAFETY, null, 0, 'Goggles'),
          rubricScore(AVA, LAB, METHOD, null, 0, 'Two trials'),
        ]);
      });
    });

    it('a single-point rubric: Work On is saveRubricCriterionComment, Went Beyond saveRubricCriterionBeyond', () => {
      open(CLAIM);
      const workOn = () => inCard(CLAIM, '[data-action-blur="rsgWorkOn"][data-sid="' + AVA + '"]');
      const beyond = () => inCard(CLAIM, '[data-action-blur="rsgBeyond"][data-sid="' + AVA + '"]');
      typeAndLeave(workOn(), ' Name the source ');
      expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, AVA, CLAIM, CLEAR, 'Name the source']]);
      expect(session.since()).toEqual([rubricScore(AVA, CLAIM, CLEAR, null, 0, 'Name the source', null)]);

      typeAndLeave(beyond(), 'Two sources');
      expect(writers.since()).toEqual([['saveRubricCriterionBeyond', CID, AVA, CLAIM, CLEAR, 'Two sources']]);
      expect(session.since()).toEqual([rubricScore(AVA, CLAIM, CLEAR, null, 0, 'Name the source', 'Two sources')]);

      // Left as it is: nothing. Emptied: "".
      typeAndLeave(workOn(), 'Name the source');
      expect(writers.since()).toEqual([]);
      typeAndLeave(beyond(), '');
      expect(writers.since()).toEqual([['saveRubricCriterionBeyond', CID, AVA, CLAIM, CLEAR, '']]);
      expect(entries(CID, AVA)).toEqual([entry(AVA, CLAIM, CLEAR, 0, { critNote: 'Name the source' })]);
      expect(drew(CLAIM)).toBe(false);
    });

    it('the Overall Comment under a student’s criteria is saveScoreComment, on leaving the box', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3)] } });
      const box = inCard(LAB, '[data-action-blur="rsgOverallComment"][data-sid="' + AVA + '"]');
      typeAndLeave(box, ' Solid lab ');
      expect(writers.calls()).toEqual([['saveScoreComment', CID, AVA, LAB, 'Solid lab']]);
      expect(session.sent()).toEqual([comment(AVA, LAB, 'Solid lab')]);
      typeAndLeave(box, 'Solid lab');
      expect(writers.calls().length).toBe(1);
    });

    describe('the Competencies view of rubric work', () => {
      const showCompetencies = () =>
        click(document.querySelector('[data-action="setRubricView"][data-aid="' + REPORT + '"][data-rubric="false"]'));

      it('a level on a competency goes to each criterion that feeds it, in rubric order', () => {
        open(REPORT);
        showCompetencies();
        click(levelOf(tagRow(REPORT, AVA, QUESTION), 3));
        expect(writers.since()).toEqual([
          level(AVA, REPORT, EVIDENCE, 3),
          level(AVA, REPORT, REASONING, 3),
          sidebar(AVA),
        ]);
        expect(levels(CID, AVA)).toEqual({ [EVIDENCE]: 3, [REASONING]: 3 });
        expect(session.since()).toEqual([
          rubricScore(AVA, REPORT, EVIDENCE, 3),
          rubricScore(AVA, REPORT, REASONING, 3),
        ]);

        click(plusMinus(tagRow(REPORT, AVA, QUESTION), 1));
        expect(writers.since()).toEqual([
          level(AVA, REPORT, EVIDENCE, 3, 1),
          level(AVA, REPORT, REASONING, 3, 1),
          sidebar(AVA),
        ]);

        // The chosen level again clears both, with the toast.
        click(levelOf(tagRow(REPORT, AVA, QUESTION), 3));
        expect(writers.since()).toEqual([
          level(AVA, REPORT, EVIDENCE, 0),
          level(AVA, REPORT, REASONING, 0),
          sidebar(AVA),
        ]);
        expect(toastText()).toBe('Score cleared');
      });

      it('criteria that disagree show the lowest as mixed; a click on it sets them all to it', () => {
        open(REPORT, { scores: { [AVA]: [entry(AVA, REPORT, EVIDENCE, 2), entry(AVA, REPORT, REASONING, 4)] } });
        showCompetencies();
        click(levelOf(tagRow(REPORT, AVA, QUESTION), 2));
        expect(writers.calls()).toEqual([
          level(AVA, REPORT, EVIDENCE, 2),
          level(AVA, REPORT, REASONING, 2),
          sidebar(AVA),
        ]);
        // Evidence already held 2, so only Reasoning is sent.
        expect(session.sent()).toEqual([rubricScore(AVA, REPORT, REASONING, 2)]);
        expect(toastText()).toBe(null);
      });
    });
  });

  describe('the competency grid', () => {
    it('a level, a −, and the level again to clear: one upsertScore each, under the competency’s id', () => {
      open(ESSAY);
      click(levelOf(tagRow(ESSAY, CARA, PLAN), 3));
      expect(writers.since()).toEqual([level(CARA, ESSAY, PLAN, 3), sidebar(CARA)]);
      expect(session.since()).toEqual([tagScore(CARA, ESSAY, PLAN, 3)]);
      expect(chosen(tagRow(ESSAY, CARA, PLAN))).toEqual([3]);

      click(plusMinus(tagRow(ESSAY, CARA, PLAN), -1));
      expect(writers.since()).toEqual([level(CARA, ESSAY, PLAN, 3, -1), sidebar(CARA)]);
      expect(session.since()).toEqual([tagScore(CARA, ESSAY, PLAN, 3, -1)]);

      const before = scoresNow();
      click(levelOf(tagRow(ESSAY, CARA, PLAN), 3));
      expect(writers.since()).toEqual([level(CARA, ESSAY, PLAN, 0), sidebar(CARA)]);
      expect(entries(CID, CARA)).toEqual([entry(CARA, ESSAY, PLAN, 0)]);
      expect(session.since()).toEqual([tagScore(CARA, ESSAY, PLAN, 0)]);
      expect(toastText()).toBe('Score cleared');
      const after = scoresNow();
      expect(drew(ESSAY)).toBe(false);

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(levels(CID, CARA)).toEqual({ [PLAN]: '3-' });
      expect(session.since()).toEqual(twice([tagScore(CARA, ESSAY, PLAN, 3, -1)]));
      expect(drew(ESSAY)).toBe(true);
    });

    it('work with no date passes no date: a first level is dated today, a later one keeps its date', () => {
      open(JOURNAL, { scores: { [AVA]: [entry(AVA, JOURNAL, QUESTION, 2)] } });
      click(levelOf(tagRow(JOURNAL, AVA, QUESTION), 4));
      click(levelOf(tagRow(JOURNAL, BEN, QUESTION), 3));
      expect(writers.calls()).toEqual([
        ['upsertScore', CID, AVA, JOURNAL, QUESTION, 4, undefined, 'formative', ''],
        sidebar(AVA),
        ['upsertScore', CID, BEN, JOURNAL, QUESTION, 3, undefined, 'formative', ''],
        sidebar(BEN),
      ]);
      expect(entries(CID, AVA).map(e => [e.score, e.date])).toEqual([[4, '2026-09-01']]);
      expect(entries(CID, BEN).map(e => [e.score, e.date])).toEqual([[3, courseToday(CID)]]);
    });

    it('work scored as a whole keeps its level under "overall" and sends upsert_score with the + or −', () => {
      open(NOTES);
      click(levelOf(tagRow(NOTES, AVA, 'overall'), 3));
      click(plusMinus(tagRow(NOTES, AVA, 'overall'), 1));
      expect(writers.calls()).toEqual([
        level(AVA, NOTES, 'overall', 3),
        sidebar(AVA),
        level(AVA, NOTES, 'overall', 3, 1),
        sidebar(AVA),
      ]);
      expect(levels(CID, AVA)).toEqual({ overall: '3+' });
      expect(session.sent()).toEqual([score(AVA, NOTES, 3, 0), score(AVA, NOTES, 3, 1)]);
    });

    it('Late on scored work is applyAssignmentStatus and leaves the level', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      click(statusButton(ESSAY, AVA, 'LATE'));
      expect(writers.calls()).toEqual([['applyAssignmentStatus', CID, AVA, ESSAY, 'LATE'], sidebar(AVA)]);
      expect(session.sent()).toEqual([status(AVA, ESSAY, 'LATE')]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      // Missing is refused on scored work: no writer is called.
      click(statusButton(ESSAY, AVA, 'NS'));
      expect(writers.calls().length).toBe(2);
    });
  });

  describe('the fills', () => {
    const FILL_SCORES = {
      [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { mod: 1 }), entry(AVA, LAB, SAFETY, 2)],
    };
    const FILL = { scores: FILL_SCORES, statuses: { [DEV + ':' + ESSAY]: 'NS', [DEV + ':' + LAB]: 'EXC' } };
    const row = (action, sid, n) => '[data-action="' + action + '"][data-sid="' + sid + '"][data-score="' + n + '"]';

    it('Set Everyone To, competencies: one upsertScore per unscored cell, student by student, then the sidebar', () => {
      open(ESSAY, FILL);
      const before = scoresNow();
      click(inCard(ESSAY, '[data-action="confirmFillAll"][data-score="3"]'));
      expect(writers.calls()).toEqual([]);
      confirmOk();

      expect(writers.since()).toEqual([
        level(AVA, ESSAY, PLAN, 3),
        level(BEN, ESSAY, QUESTION, 3),
        level(BEN, ESSAY, PLAN, 3),
        level(CARA, ESSAY, QUESTION, 3),
        level(CARA, ESSAY, PLAN, 3),
        sidebar(),
      ]);
      expect(toastText()).toBe('5 competencies set to Proficient');
      expect(drew(ESSAY)).toBe(false);
      const after = scoresNow();

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      expect(drew(ESSAY)).toBe(true);
    });

    it('a fill’s Undo is also Cmd+Z while the toast is up', () => {
      open(ESSAY, FILL);
      const before = scoresNow();
      click(inCard(ESSAY, row('fillScoresAndClose', BEN, 2)));
      const after = scoresNow();
      writers.since();
      cmdZ();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
    });

    it('a row’s fill, competencies: every competency of the student; Clear is the same with 0', () => {
      open(ESSAY, FILL);
      click(inCard(ESSAY, row('fillScoresAndClose', AVA, 4)));
      expect(writers.since()).toEqual([level(AVA, ESSAY, QUESTION, 4), level(AVA, ESSAY, PLAN, 4), sidebar()]);
      expect(toastText()).toBe('Row filled');

      const before = scoresNow();
      click(inCard(ESSAY, row('fillScoresAndClose', AVA, 0)));
      expect(writers.since()).toEqual([level(AVA, ESSAY, QUESTION, 0), level(AVA, ESSAY, PLAN, 0), sidebar()]);
      expect(toastText()).toBe('Row cleared');
      const after = scoresNow();
      expect(drew(ESSAY)).toBe(false);

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: 4, [PLAN]: 4 });
    });

    it('a row’s fill on a Missing student calls no score writer, and still offers Undo', () => {
      open(ESSAY, FILL);
      const before = scoresNow();
      click(inCard(ESSAY, row('fillScoresAndClose', DEV, 4)));
      expect(writers.since()).toEqual([sidebar()]);
      expect(toastText()).toBe('Row filled');
      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, before], sidebar()]);
      expect(session.sent()).toEqual([]);
    });

    it('Set Everyone To, rubric: one upsertScore per unscored criterion', () => {
      open(LAB, FILL);
      const before = scoresNow();
      click(inCard(LAB, '[data-action="confirmFillRubricAll"][data-score="3"]'));
      confirmOk();
      expect(writers.since()).toEqual([
        level(AVA, LAB, METHOD, 3),
        level(BEN, LAB, SAFETY, 3),
        level(BEN, LAB, METHOD, 3),
        level(CARA, LAB, SAFETY, 3),
        level(CARA, LAB, METHOD, 3),
        sidebar(),
      ]);
      expect(toastText()).toBe('5 criteria set to Proficient');
      expect(drew(LAB)).toBe(false);
      const after = scoresNow();

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(drew(LAB)).toBe(true);
    });

    it('a row’s fill, rubric: every criterion of the student, and nothing for an Excused one', () => {
      open(LAB, FILL);
      click(inCard(LAB, row('fillRubricScoresAndClose', AVA, 4)));
      expect(writers.since()).toEqual([level(AVA, LAB, SAFETY, 4), level(AVA, LAB, METHOD, 4), sidebar()]);
      expect(toastText()).toBe('Row filled');
      click(inCard(LAB, row('fillRubricScoresAndClose', DEV, 4)));
      expect(writers.since()).toEqual([sidebar()]);
    });

    it('a fill does not touch the ticks: a filled level stays with no box ticked', () => {
      open(LAB, FILL);
      click(inCard(LAB, row('fillRubricScoresAndClose', BEN, 3)));
      expect(writers.calls().map(c => c[0])).toEqual(['upsertScore', 'upsertScore', 'refreshSidebarGrades']);
      expect(getRubricCheckIds(CID, BEN, LAB)).toEqual([]);
    });

    /* No control on the page asks for a column fill (scope "col"); the
       branch is still there. Pressed through a made-up button. */
    it('a column fill, which nothing on the page asks for, writes one level per student with no status', () => {
      open(ESSAY, FILL);
      click(madeUpButton(ESSAY, { action: 'fillScoresAndClose', aid: ESSAY, sid: PLAN, score: 2, scope: 'col' }));
      expect(writers.since()).toEqual([
        level(AVA, ESSAY, PLAN, 2),
        level(BEN, ESSAY, PLAN, 2),
        level(CARA, ESSAY, PLAN, 2),
        sidebar(),
      ]);
      expect(toastText()).toBe('Column filled');
    });

    it('a column fill on a rubric, the same way, writes the criterion for each student with no status', () => {
      open(LAB, FILL);
      click(madeUpButton(LAB, { action: 'fillRubricScoresAndClose', aid: LAB, sid: METHOD, score: 2, scope: 'col' }));
      expect(writers.since()).toEqual([
        level(AVA, LAB, METHOD, 2),
        level(BEN, LAB, METHOD, 2),
        level(CARA, LAB, METHOD, 2),
        sidebar(),
      ]);
      expect(toastText()).toBe('Criterion filled');
    });
  });

  describe('the points ledger', () => {
    const POINTS = {
      scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 7, { type: 'formative' })] },
      statuses: { [CARA + ':' + QUIZ]: 'EXC', [DEV + ':' + QUIZ]: 'LATE' },
    };

    it('a score typed and left is one setPointsScore; the row changes in place and no sidebar is asked for', () => {
      open(QUIZ, POINTS);
      typeAndLeave(pointsBox(QUIZ, BEN), '8');
      expect(writers.since()).toEqual([['setPointsScore', CID, BEN, QUIZ, 8]]);
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual([score(BEN, QUIZ, 8)]);
      expect(drew(QUIZ)).toBe(false);
    });

    it('the same score or a typo writes nothing; a decimal and a 0 are scores; an empty box passes null', () => {
      open(QUIZ, POINTS);
      typeAndLeave(pointsBox(QUIZ, AVA), '7');
      typeAndLeave(pointsBox(QUIZ, AVA), 'abc');
      typeAndLeave(pointsBox(QUIZ, BEN), '');
      expect(writers.since()).toEqual([]);
      expect(pointsBox(QUIZ, AVA).value).toBe('7');

      typeAndLeave(pointsBox(QUIZ, AVA), '7,5');
      typeAndLeave(pointsBox(QUIZ, AVA), '0');
      typeAndLeave(pointsBox(QUIZ, AVA), '');
      expect(writers.since()).toEqual([
        ['setPointsScore', CID, AVA, QUIZ, 7.5],
        ['setPointsScore', CID, AVA, QUIZ, 0],
        ['setPointsScore', CID, AVA, QUIZ, null],
      ]);
      expect(entries(CID, AVA)).toEqual([]);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 7.5), score(AVA, QUIZ, 0), score(AVA, QUIZ, null)]);
    });

    it('Return saves the box; Escape puts the saved score back and saves nothing', () => {
      open(QUIZ, POINTS);
      const box = pointsBox(QUIZ, BEN);
      box.focus();
      box.value = '9';
      key(box, 'Enter');
      expect(writers.since()).toEqual([['setPointsScore', CID, BEN, QUIZ, 9]]);

      const again = pointsBox(QUIZ, BEN);
      again.focus();
      again.value = '4';
      key(again, 'Escape');
      expect(again.value).toBe('9');
      expect(writers.since()).toEqual([]);
      expect(session.sent()).toEqual([score(BEN, QUIZ, 9)]);
    });

    it('a score over twice the maximum is saved at the limit; the toast’s Undo is setPointsScore with the score before', () => {
      open(QUIZ, POINTS);
      typeAndLeave(pointsBox(QUIZ, AVA), '45');
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 20]]);
      expect(toastText()).toBe('45 is more than twice the 10-point maximum, so it was saved as 20.');
      expect(drew(QUIZ)).toBe(false);

      executeUndo();
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 7], sidebar(AVA)]);
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(7);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 20), score(AVA, QUIZ, 7)]);
      expect(drew(QUIZ)).toBe(true);
    });

    it('L in a score box saves the number typed, then Late; N on an empty box is Missing', () => {
      open(QUIZ, POINTS);
      const box = pointsBox(QUIZ, BEN);
      box.focus();
      box.value = '6';
      key(box, 'l');
      expect(writers.since()).toEqual([
        ['setPointsScore', CID, BEN, QUIZ, 6],
        ['applyAssignmentStatus', CID, BEN, QUIZ, 'LATE'],
        sidebar(BEN),
      ]);
      expect(session.since()).toEqual([score(BEN, QUIZ, 6), status(BEN, QUIZ, 'LATE')]);

      // Dev is Late with no score: N makes it Missing.
      const dev = pointsBox(QUIZ, DEV);
      dev.focus();
      key(dev, 'n');
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, DEV, QUIZ, 'NS'], sidebar(DEV)]);
      expect(session.since()).toEqual([status(DEV, QUIZ, 'NS')]);
      expect(pointsBox(QUIZ, DEV).disabled).toBe(true);
    });

    it('a status chip is applyAssignmentStatus; pressed again it passes null', () => {
      open(QUIZ, POINTS);
      vi.useFakeTimers();
      click(statusButton(QUIZ, BEN, 'EXC'));
      vi.advanceTimersByTime(400);
      click(statusButton(QUIZ, BEN, 'EXC'));
      expect(writers.calls()).toEqual([
        ['applyAssignmentStatus', CID, BEN, QUIZ, 'EXC'],
        sidebar(BEN),
        ['applyAssignmentStatus', CID, BEN, QUIZ, null],
        sidebar(BEN),
      ]);
      expect(session.sent()).toEqual([status(BEN, QUIZ, 'EXC'), status(BEN, QUIZ, null)]);
      expect(drew(QUIZ)).toBe(false);
    });

    it('Set Unmarked to 10 / 10 is one setPointsScore per student with no score and no status; Undo is restoreScoreCells', () => {
      open(QUIZ, POINTS);
      const before = scoresNow();
      click(inCard(QUIZ, '[data-action="confirmFillPoints"]'));
      expect(writers.calls()).toEqual([]);
      confirmOk();
      expect(writers.since()).toEqual([['setPointsScore', CID, BEN, QUIZ, 10], sidebar()]);
      expect(toastText()).toBe('Unmarked students set to 10 / 10');
      expect(drew(QUIZ)).toBe(true);
      const after = scoresNow();

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(null);
      expect(drew(QUIZ)).toBe(true);
    });

    it('Set Unmarked to Missing is applyAssignmentStatus each; Undo is setAssignmentStatus with null, the status alone', () => {
      open(QUIZ, { scores: POINTS.scores });
      click(inCard(QUIZ, '[data-action="confirmFillNotSubmitted"]'));
      confirmOk();
      expect(writers.since()).toEqual([
        ['applyAssignmentStatus', CID, BEN, QUIZ, 'NS'],
        ['applyAssignmentStatus', CID, CARA, QUIZ, 'NS'],
        ['applyAssignmentStatus', CID, DEV, QUIZ, 'NS'],
        sidebar(),
      ]);
      expect(session.since()).toEqual([status(BEN, QUIZ, 'NS'), status(CARA, QUIZ, 'NS'), status(DEV, QUIZ, 'NS')]);
      expect(toastText()).toBe('Unmarked students set to Missing');
      expect(drew(QUIZ)).toBe(true);

      executeUndo();
      expect(writers.since()).toEqual([
        ['setAssignmentStatus', CID, BEN, QUIZ, null],
        ['setAssignmentStatus', CID, CARA, QUIZ, null],
        ['setAssignmentStatus', CID, DEV, QUIZ, null],
        sidebar(),
      ]);
      expect(session.since()).toEqual([status(BEN, QUIZ, null), status(CARA, QUIZ, null), status(DEV, QUIZ, null)]);
      expect(getAssignmentStatuses(CID)).toEqual({});
      expect(drew(QUIZ)).toBe(true);
    });

    it('Set Unmarked to Missing with nobody unmarked calls no writer and shows no toast', () => {
      open(QUIZ, {
        scores: POINTS.scores,
        statuses: { [BEN + ':' + QUIZ]: 'LATE', [CARA + ':' + QUIZ]: 'EXC', [DEV + ':' + QUIZ]: 'NS' },
      });
      click(inCard(QUIZ, '[data-action="confirmFillNotSubmitted"]'));
      confirmOk();
      expect(writers.calls()).toEqual([sidebar()]);
      expect(toastText()).toBe(null);
    });
  });

  describe('the Complete/Incomplete ledger', () => {
    const MARKS = {
      scores: { [AVA]: [entry(AVA, EXIT, QUESTION, 0, { type: 'formative' })] }, // Incomplete
      statuses: { [DEV + ':' + EXIT]: 'LATE' },
    };

    it('a mark is setCompletionMark, then the sidebar; the mark again passes null', () => {
      open(EXIT, MARKS);
      click(markButton(EXIT, BEN, 'complete'));
      expect(writers.since()).toEqual([['setCompletionMark', CID, BEN, EXIT, 'complete'], sidebar(BEN)]);
      expect(getCompletionMark(CID, BEN, EXIT)).toBe('complete');
      expect(session.since()).toEqual([score(BEN, EXIT, 1)]);

      click(markButton(EXIT, BEN, 'incomplete'));
      expect(writers.since()).toEqual([['setCompletionMark', CID, BEN, EXIT, 'incomplete'], sidebar(BEN)]);
      expect(session.since()).toEqual([score(BEN, EXIT, 0)]);

      click(markButton(EXIT, BEN, 'incomplete'));
      expect(writers.since()).toEqual([['setCompletionMark', CID, BEN, EXIT, null], sidebar(BEN)]);
      expect(getCompletionMark(CID, BEN, EXIT)).toBe(null);
      expect(session.since()).toEqual([score(BEN, EXIT, null)]);
      expect(drew(EXIT)).toBe(false);
    });

    it('C and I on a focused row mark it; on Missing work they call no writer', () => {
      open(EXIT, { ...MARKS, statuses: { [CARA + ':' + EXIT]: 'NS' } });
      ledgerRow(EXIT, BEN).focus();
      key(ledgerRow(EXIT, BEN), 'c');
      expect(writers.since()).toEqual([['setCompletionMark', CID, BEN, EXIT, 'complete'], sidebar(BEN)]);
      ledgerRow(EXIT, BEN).focus();
      key(ledgerRow(EXIT, BEN), 'i');
      expect(writers.since()).toEqual([['setCompletionMark', CID, BEN, EXIT, 'incomplete'], sidebar(BEN)]);

      ledgerRow(EXIT, CARA).focus();
      key(ledgerRow(EXIT, CARA), 'c');
      expect(writers.since()).toEqual([]);
      expect(session.sent()).toEqual([score(BEN, EXIT, 1), score(BEN, EXIT, 0)]);
    });

    it('L on a focused row is Late, through applyAssignmentStatus', () => {
      open(EXIT, MARKS);
      ledgerRow(EXIT, BEN).focus();
      key(ledgerRow(EXIT, BEN), 'l');
      expect(writers.calls()).toEqual([['applyAssignmentStatus', CID, BEN, EXIT, 'LATE'], sidebar(BEN)]);
      expect(session.sent()).toEqual([status(BEN, EXIT, 'LATE')]);
    });

    it('Set Unmarked to Complete is one setCompletionMark per unmarked student; Undo is restoreScoreCells', () => {
      open(EXIT, MARKS);
      const before = scoresNow();
      click(inCard(EXIT, '[data-action="confirmFillCompletion"]'));
      confirmOk();
      expect(writers.since()).toEqual([
        ['setCompletionMark', CID, BEN, EXIT, 'complete'],
        ['setCompletionMark', CID, CARA, EXIT, 'complete'],
        sidebar(),
      ]);
      expect(toastText()).toBe('Unmarked students set to Complete');
      expect(drew(EXIT)).toBe(true);
      const after = scoresNow();

      executeUndo();
      expect(writers.since()).toEqual([['restoreScoreCells', CID, before, after], sidebar()]);
      expect(drew(EXIT)).toBe(true);
    });

    it('Set Unmarked to Missing leaves a marked student and any status; Undo takes the marks off one by one', () => {
      open(EXIT, MARKS);
      click(inCard(EXIT, '[data-action="confirmFillNotSubmitted"]'));
      confirmOk();
      expect(writers.since()).toEqual([
        ['applyAssignmentStatus', CID, BEN, EXIT, 'NS'],
        ['applyAssignmentStatus', CID, CARA, EXIT, 'NS'],
        sidebar(),
      ]);
      executeUndo();
      expect(writers.since()).toEqual([
        ['setAssignmentStatus', CID, BEN, EXIT, null],
        ['setAssignmentStatus', CID, CARA, EXIT, null],
        sidebar(),
      ]);
      expect(session.sent()).toEqual([
        status(BEN, EXIT, 'NS'),
        status(CARA, EXIT, 'NS'),
        status(BEN, EXIT, null),
        status(CARA, EXIT, null),
      ]);
    });
  });

  describe('pair work on the list', () => {
    it('a level is one upsertScore for the pair’s first member; data.js copies it to the partner', async () => {
      open(TALK);
      click(levelOf(tagRow(TALK, AVA, QUESTION), 3));
      await settle();
      expect(writers.calls()).toEqual([level(AVA, TALK, QUESTION, 3), sidebar(AVA)]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 3 });
      expect(session.sent()).toEqual([tagScore(AVA, TALK, QUESTION, 3), tagScore(BEN, TALK, QUESTION, 3)]);
      // The partner has no row of their own.
      expect(tagRow(TALK, BEN, QUESTION)).toBe(null);
    });

    it('Grade Separately, in a member’s ⋯ menu, is setGradedSeparately(…, true), then the sidebar and a redraw', async () => {
      open(TALK, { scores: { [AVA]: [entry(AVA, TALK, QUESTION, 3)], [BEN]: [entry(BEN, TALK, QUESTION, 3)] } }, [
        'saveAssessments',
      ]);
      click(inCard(TALK, '[data-action="groupMemberMenu"][data-sid="' + BEN + '"]'));
      click(inCard(TALK, '[data-action="groupGradeSeparately"][data-sid="' + BEN + '"]'));
      await settle();

      expect(writers.calls()).toEqual([['setGradedSeparately', CID, TALK, BEN, true], sidebar()]);
      expect(getAssessments(CID).find(a => a.id === TALK).gradedSeparately).toEqual([BEN]);
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 3 });
      expect(drew(TALK)).toBe(true);
      // Ben now has a row of his own, with Back to Group Grade.
      expect(tagRow(TALK, BEN, QUESTION)).not.toBe(null);

      writers.since();
      click(inCard(TALK, '[data-action="groupBackToGroup"][data-sid="' + BEN + '"]'));
      // It asks first, even when Ben's grade is the pair's.
      expect(writers.since()).toEqual([]);
      confirmOk();
      await settle();
      expect(writers.since()).toEqual([['setGradedSeparately', CID, TALK, BEN, false], sidebar()]);
      expect(getAssessments(CID).find(a => a.id === TALK).gradedSeparately).toBe(undefined);
    });

    it('Set Unmarked to Complete on pair work: the first member’s mark reaches the partner, who is then passed over', () => {
      open(DUET);
      click(inCard(DUET, '[data-action="confirmFillCompletion"]'));
      confirmOk();
      expect(writers.calls()).toEqual([
        ['setCompletionMark', CID, AVA, DUET, 'complete'],
        ['setCompletionMark', CID, CARA, DUET, 'complete'],
        ['setCompletionMark', CID, DEV, DUET, 'complete'],
        sidebar(),
      ]);
      expect([AVA, BEN, CARA, DEV].map(sid => getCompletionMark(CID, sid, DUET))).toEqual([
        'complete',
        'complete',
        'complete',
        'complete',
      ]);
      expect(session.sent()).toEqual([
        score(AVA, DUET, 1),
        score(BEN, DUET, 1),
        score(CARA, DUET, 1),
        score(DEV, DUET, 1),
      ]);
    });

    it('Set Unmarked to Missing on pair work asks for each member in turn', () => {
      open(DUET);
      click(inCard(DUET, '[data-action="confirmFillNotSubmitted"]'));
      confirmOk();
      expect(writers.calls()).toEqual([
        ['applyAssignmentStatus', CID, AVA, DUET, 'NS'],
        ['applyAssignmentStatus', CID, BEN, DUET, 'NS'],
        ['applyAssignmentStatus', CID, CARA, DUET, 'NS'],
        ['applyAssignmentStatus', CID, DEV, DUET, 'NS'],
        sidebar(),
      ]);
    });
  });

  describe('the edit form', () => {
    const editForm = aid => {
      click(document.querySelector('[data-action="editAssess"][data-aid="' + aid + '"]'));
      return document.getElementById('new-assess-form');
    };

    it('an Overall level carried onto newly ticked competencies: the work is saved, then one upsertScore per copy', async () => {
      const overall = (sid, level, more) => entry(sid, NOTES, 'overall', level, { date: '2026-10-08', ...more });
      open(NOTES, { only: [NOTES], scores: { [AVA]: [overall(AVA, 3, { mod: 1 })], [BEN]: [overall(BEN, 2)] } }, [
        'saveAssessments',
      ]);
      const form = editForm(NOTES);
      [QUESTION, PLAN].forEach(id => tick(form.querySelector('.af-tag-cb[value="' + id + '"]'), true));
      click(form.querySelector('[data-action="saveEditAssess"]'));
      await settle();

      expect(writers.calls().map(c => (c[0] === 'saveAssessments' ? ['saveAssessments', c[1]] : c))).toEqual([
        ['saveAssessments', CID],
        // The Overall entry's date and type, not the work's; no comment.
        ['upsertScore', CID, AVA, NOTES, QUESTION, 3, '2026-10-08', 'formative', '', 1],
        ['upsertScore', CID, AVA, NOTES, PLAN, 3, '2026-10-08', 'formative', '', 1],
        ['upsertScore', CID, BEN, NOTES, QUESTION, 2, '2026-10-08', 'formative', ''],
        ['upsertScore', CID, BEN, NOTES, PLAN, 2, '2026-10-08', 'formative', ''],
        sidebar(),
      ]);
      expect(levels(CID, AVA)).toEqual({ overall: '3+', [QUESTION]: '3+', [PLAN]: '3+' });
    });

    it('a change that carries nothing calls no score writer', async () => {
      open(ESSAY, { only: [ESSAY], scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } }, ['saveAssessments']);
      const form = editForm(ESSAY);
      form.querySelector('#af-title').value = 'Essay 2';
      fire(form.querySelector('#af-title'), 'input');
      click(form.querySelector('[data-action="saveEditAssess"]'));
      await settle();
      expect(writers.calls().map(c => c[0])).toEqual(['saveAssessments']);
      expect(getAssessments(CID)[0].title).toBe('Essay 2');
    });

    /* Edit a Copy on scored work (the rubric is used by other work too):
       the copy's criteria and boxes have new ids, and this work's scores
       and ticks move to them. With writes off, as in Demo Mode: signed in,
       the move waits for the server's ids for the copy
       (e2e/assessment-form-copy-keeps-scores.spec.js runs both). */
    it('Edit a Copy: the copy is saved, the work is saved on it, then one moveRubricScores with the id maps', async () => {
      openAssignments(
        seedWith({
          only: [LAB, CLAIM],
          work: { [CLAIM]: { rubricId: LAB_RUBRIC } },
          scores: {
            [AVA]: [entry(AVA, LAB, SAFETY, 3, { mod: 1 }), entry(AVA, LAB, METHOD, 2), entry(AVA, CLAIM, SAFETY, 4)],
          },
          rubricChecks: { [AVA + ':' + LAB]: [GOGGLES, STATION] },
        }),
        CID,
        { open: LAB },
      );
      writers = recordWriters(['refreshSidebarGrades', 'saveAssessments', 'saveRubrics']);
      // linkedom's <select> has no value to set; the form chooses the copy
      // by setting it.
      const selectProto = Object.getPrototypeOf(document.createElement('select'));
      const readValue = Object.getOwnPropertyDescriptor(selectProto, 'value').get;
      Object.defineProperty(selectProto, 'value', {
        configurable: true,
        get() {
          return '_pinValue' in this ? this._pinValue : readValue.call(this);
        },
        set(v) {
          this._pinValue = String(v);
        },
      });
      const form = editForm(LAB);
      click(form.querySelector('[data-action="editRubricFromForm"]'));
      const copy = Array.from(document.querySelectorAll('.af-dialog-card button')).find(b =>
        b.textContent.startsWith('Edit a Copy for'),
      );
      click(copy);
      click(document.querySelector('[data-action="saveRubricEdit"]'));
      expect(writers.calls()).toEqual([]);
      click(document.getElementById('new-assess-form').querySelector('[data-action="saveEditAssess"]'));
      await settle();

      const made = getRubrics(CID).find(r => ![LAB_RUBRIC, REPORT_RUBRIC, CLAIM_RUBRIC].includes(r.id));
      const [safety2, method2] = made.criteria.map(c => c.id);
      const [goggles2, station2] = made.criteria[0].checks.map(k => k.id);
      expect(writers.calls().map(c => (/^save(Assessments|Rubrics)$/.test(c[0]) ? [c[0], c[1]] : c))).toEqual([
        ['saveRubrics', CID],
        ['saveAssessments', CID],
        [
          'moveRubricScores',
          CID,
          LAB,
          {
            aid: LAB,
            rubricId: made.id,
            criteria: { [SAFETY]: safety2, [METHOD]: method2 },
            checks: { [GOGGLES]: goggles2, [STATION]: station2 },
          },
        ],
      ]);
      expect(getAssessments(CID).find(a => a.id === LAB).rubricId).toBe(made.id);
      expect(levels(CID, AVA, LAB)).toEqual({ [safety2]: '3+', [method2]: 2 });
      // The other work on the original rubric keeps its score and its key.
      expect(levels(CID, AVA, CLAIM)).toEqual({ [SAFETY]: 4 });
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([goggles2, station2]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // The rubric editor focuses its name 50 ms after it opens.
      await new Promise(done => setTimeout(done, 60));
    });
  });

  describe('Delete Assessment', () => {
    it('saves the work list, then the score list without the work’s scores; its status clean-up is never reached', async () => {
      open(
        ESSAY,
        {
          only: [ESSAY, QUIZ],
          scores: {
            [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, QUIZ, QUESTION, 7, { type: 'formative' })],
            [BEN]: [entry(BEN, ESSAY, PLAN, 2)],
          },
          statuses: { [CARA + ':' + ESSAY]: 'NS', [CARA + ':' + QUIZ]: 'EXC' },
        },
        ['saveAssessments', 'deleteAssessmentObservations'],
      );
      click(document.querySelector('[data-action="deleteAssess"][data-aid="' + ESSAY + '"]'));
      expect(writers.calls()).toEqual([]);
      confirmOk();
      await settle();

      expect(writers.calls().map(c => (c[0] === 'saveAssessments' ? ['saveAssessments', c[1]] : c))).toEqual([
        ['saveAssessments', CID],
        ['saveScores', CID, { [AVA]: [entry(AVA, QUIZ, QUESTION, 7, { type: 'formative' })], [BEN]: [] }],
        // saveAssessments has already dropped the work's statuses, so the
        // page finds none to remove and never saves the status list.
        ['deleteAssessmentObservations', CID, ESSAY],
        sidebar(),
      ]);
      expect(getAssessments(CID).map(a => a.id)).toEqual([QUIZ]);
      expect(getAssignmentStatuses(CID)).toEqual({ [CARA + ':' + QUIZ]: 'EXC' });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent().map(c => c[0])).toEqual(['delete_assessment']);
    });

    it('a signed-in class whose work is not read yet: the dialog waits for the read, and says photos may go when it failed (S9-W1)', async () => {
      open(ESSAY, { only: [ESSAY, QUIZ] }, ['saveAssessments', 'deleteAssessmentObservations']);
      const was = globalThis.readStudentWorkForDelete;
      let release;
      globalThis.readStudentWorkForDelete = vi.fn(() => new Promise(r => (release = r)));
      try {
        click(document.querySelector('[data-action="deleteAssess"][data-aid="' + ESSAY + '"]'));
        expect(document.querySelector('.confirm-card')).toBeNull();
        release({ known: false });
        await settle();
        expect(document.querySelector('.confirm-message').textContent).toContain(
          " Any photos students sent for it are deleted too. Deleted photos can't come back.",
        );
      } finally {
        globalThis.readStudentWorkForDelete = was;
      }
    });
  });

  describe('the grader dialog’s two writes left on data.js', () => {
    const at = selector => document.querySelector('#grader-overlay ' + selector);
    function openDialog(aid, sid, seed) {
      openGrader(seedWith(seed), CID, aid, sid);
      session = signIn();
      writers = recordWriters(['refreshSidebarGrades']);
    }

    it('the points box is setPointsScore, then the sidebar', () => {
      openDialog(QUIZ, AVA);
      typeAndLeave(at('.grdp-input'), '7');
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 7], sidebar(AVA)]);
      expect(session.since()).toEqual([score(AVA, QUIZ, 7)]);

      typeAndLeave(at('.grdp-input'), '7');
      typeAndLeave(at('.grdp-input'), 'abc');
      expect(writers.since()).toEqual([]);

      typeAndLeave(at('.grdp-input'), '');
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, null], sidebar(AVA)]);

      // Over the limit: saved at twice the maximum; Undo passes the score before.
      typeAndLeave(at('.grdp-input'), '25');
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 20], sidebar(AVA)]);
      executeUndo();
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, null], sidebar(AVA)]);
    });

    it('the Note for the Report is saveScoreReportNote with the text as typed; data.js tidies it', () => {
      openDialog(LAB, AVA, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3)] } });
      const field = at('.grader-report-note-input');
      field.value = '  ran   the test twice ';
      fire(field, 'change');
      expect(writers.calls()).toEqual([['saveScoreReportNote', CID, AVA, LAB, '  ran   the test twice ']]);
      expect(entries(CID, AVA)[0].reportNote).toBe('ran the test twice');
      expect(field.value).toBe('ran the test twice');
      expect(session.sent()).toEqual([
        [
          'save_score_report_note',
          { p_enrollment_id: AVA, p_assessment_id: LAB, p_note: 'ran the test twice', p_idempotency_key: '<key>' },
        ],
      ]);
    });
  });

  describe('one student’s grader on the page', () => {
    it('its points box writes as the dialog’s does', () => {
      openAssignments(seedWith(), CID, { open: QUIZ, student: AVA });
      session = signIn();
      writers = recordWriters(['refreshSidebarGrades']);
      typeAndLeave(inCard(QUIZ, '.grdp-input'), '6.5');
      expect(writers.calls()).toEqual([['setPointsScore', CID, AVA, QUIZ, 6.5], sidebar(AVA)]);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 6.5)]);
    });
  });

  /* Nothing on the page opens the comment popover (renderStatusToggles,
     which draws its Comment button, is never called). Its Overall Comment
     edit and delete are still there; opened through a made-up button. */
  describe('the comment popover, which nothing on the page opens', () => {
    function openPopover() {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 3, { note: 'Solid lab' })] } });
      click(madeUpButton(LAB, { action: 'openCommentPopover', cid: CID, sid: AVA, aid: LAB }));
      const overlay = document.getElementById('comment-popover-overlay');
      // As the criterion comment box: linkedom would close it on any click.
      overlay.onclick = null;
      return overlay;
    }

    it('editing the Overall Comment is saveScoreComment with the trimmed text', () => {
      const popover = openPopover();
      click(popover.querySelector('[data-action="editComment"][data-obid="overall"]'));
      popover.querySelector('.comment-entry-input').value = ' Careful lab ';
      click(popover.querySelector('[data-action="saveCommentEdit"]'));
      expect(writers.calls()).toEqual([['saveScoreComment', CID, AVA, LAB, 'Careful lab']]);
      expect(session.sent()).toEqual([comment(AVA, LAB, 'Careful lab')]);
    });

    it('deleting it is saveScoreComment with ""', () => {
      const popover = openPopover();
      click(popover.querySelector('[data-action="deleteComment"][data-obid="overall"]'));
      expect(writers.calls()).toEqual([['saveScoreComment', CID, AVA, LAB, '']]);
      expect(getScoreComment(CID, AVA, LAB)).toBe('');
      expect(session.sent()).toEqual([comment(AVA, LAB, '')]);
    });
  });

  describe('with writes off, as in Demo Mode', () => {
    it('the page calls the same writers and everything is saved on this device', () => {
      openAssignments(seedWith(), CID, { open: LAB });
      writers = recordWriters(['refreshSidebarGrades']);
      click(levelOf(critRow(LAB, AVA, METHOD), 3));
      click(plusMinus(critRow(LAB, AVA, METHOD), 1));
      tick(checkBox(LAB, AVA, GOGGLES), true);
      click(statusButton(LAB, BEN, 'EXC'));
      click(inCard(LAB, '[data-action="fillRubricScoresAndClose"][data-sid="' + CARA + '"][data-score="2"]'));

      expect(writers.calls()).toEqual([
        level(AVA, LAB, METHOD, 3),
        sidebar(AVA),
        level(AVA, LAB, METHOD, 3, 1),
        sidebar(AVA),
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, true],
        ['applyAssignmentStatus', CID, BEN, LAB, 'EXC'],
        sidebar(BEN),
        level(CARA, LAB, SAFETY, 2),
        level(CARA, LAB, METHOD, 2),
        sidebar(),
      ]);
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3+' });
      expect(levels(CID, CARA)).toEqual({ [SAFETY]: 2, [METHOD]: 2 });
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES]);
      expect(getAssignmentStatus(CID, BEN, LAB)).toBe('EXC');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(storedMatchesCache('statuses', CID)).toBe(true);
    });
  });
});
