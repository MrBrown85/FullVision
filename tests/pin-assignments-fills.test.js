/**
 * Pin: the Assignments page's fills and their Undo
 * (teacher/page-assignments.js), S0-P1. S1-T3 moves them onto
 * shared/grader.js.
 *
 * Set Everyone To, a row's fill and Clear, Set Unmarked to Complete, Set
 * Unmarked to points and Set Unmarked to Missing, each pressed on the real
 * page on a linkedom document, then undone from the toast. This records
 * which cells change and which RPCs go out, in order. restoreScoreCells
 * itself is covered by tests/fill-undo-cells.test.js and the Set Everyone
 * To plan by tests/set-everyone-unscored.test.js; neither covers what the
 * page sends.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  levels,
  storedMatchesCache,
  click,
  confirmOk,
  toastText,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ESSAY = U(31); // competency levels
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // a rubric
const EXIT = U(34); // Complete/Incomplete
const QUESTION = U(41);
const PLAN = U(42);
const RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);

// What each level of a criterion says; any wording does.
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };
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

function seed() {
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
        id: RUBRIC,
        name: 'Lab Skills',
        criteria: [
          { id: SAFETY, name: 'Safety', tagIds: [], levels: WORDS, checks: [] },
          { id: METHOD, name: 'Method', tagIds: [], levels: WORDS, checks: [] },
        ],
      },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      { id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
      { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
    ],
    // Ava has something on each piece; Ben has nothing anywhere.
    scores: {
      [AVA]: [
        entry(AVA, ESSAY, QUESTION, 3, { mod: 1 }),
        entry(AVA, LAB, SAFETY, 2),
        entry(AVA, QUIZ, QUESTION, 7),
        entry(AVA, EXIT, QUESTION, 0), // Incomplete
      ],
    },
    statuses: {
      [DEV + ':' + ESSAY]: 'NS',
      [DEV + ':' + LAB]: 'EXC',
      [DEV + ':' + QUIZ]: 'LATE',
      [DEV + ':' + EXIT]: 'LATE',
      [CARA + ':' + QUIZ]: 'EXC',
    },
  });
}

const rubricScore = (sid, criterion, value) => [
  'upsert_rubric_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: LAB,
    p_criterion_id: criterion,
    p_value: value,
    p_modifier: 0,
    p_comment: null,
    p_beyond: null,
  },
];
const tagScore = (sid, tag, value, modifier = 0) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: ESSAY,
    p_tag_id: tag,
    p_value: value,
    p_modifier: modifier,
    p_comment: null,
  },
];
const score = (sid, aid, value) => ['upsert_score', { p_enrollment_id: sid, p_assessment_id: aid, p_value: value }];
const status = (sid, aid, value) => [
  'set_score_status',
  { p_enrollment_id: sid, p_assessment_id: aid, p_status: value },
];
// An Undo of a score fill sends every write twice: restoreScoreCells saves
// the list, which sends the change, and then sends the same change itself.
const twice = list => list.concat(list);

describe('pin: the Assignments page’s fills', () => {
  let session = null;

  /* The page with one assessment's card open. */
  function open(aid) {
    openAssignments(seed, CID, { open: aid });
    session = signIn();
  }
  const press = (aid, selector) => click(document.getElementById('ac-' + aid).querySelector(selector));

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  describe('Set Everyone To, on competency work', () => {
    it('sets only the competencies with no score, leaves out Missing students, and sends one write each', () => {
      open(ESSAY);
      press(ESSAY, '[data-action="confirmFillAll"][data-score="3"]');
      expect(document.querySelector('.confirm-message').textContent).toBe(
        'Set 5 competencies with no score yet, for 3 students, to Proficient? Competencies already scored stay as they are. 1 student is marked Missing or Excused and left out.',
      );
      expect(session.sent()).toEqual([]);
      confirmOk();

      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: '3+', [PLAN]: 3 });
      expect(levels(CID, BEN, ESSAY)).toEqual({ [QUESTION]: 3, [PLAN]: 3 });
      expect(levels(CID, CARA, ESSAY)).toEqual({ [QUESTION]: 3, [PLAN]: 3 });
      expect(levels(CID, DEV, ESSAY)).toEqual({});
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([
        tagScore(AVA, PLAN, 3),
        tagScore(BEN, QUESTION, 3),
        tagScore(BEN, PLAN, 3),
        tagScore(CARA, QUESTION, 3),
        tagScore(CARA, PLAN, 3),
      ]);
      expect(toastText()).toBe('5 competencies set to Proficient');
    });

    it('Undo takes the filled cells back to 0, keeps their entries, and sends each 0 twice', () => {
      open(ESSAY);
      press(ESSAY, '[data-action="confirmFillAll"][data-score="3"]');
      confirmOk();
      session.since();
      executeUndo();

      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: '3+', [PLAN]: 0 });
      expect(levels(CID, BEN, ESSAY)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      expect(levels(CID, CARA, ESSAY)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(
        twice([
          tagScore(AVA, PLAN, 0),
          tagScore(BEN, QUESTION, 0),
          tagScore(BEN, PLAN, 0),
          tagScore(CARA, QUESTION, 0),
          tagScore(CARA, PLAN, 0),
        ]),
      );
    });
  });

  describe('a row’s fill, on competency work', () => {
    const row = (sid, n) => '[data-action="fillScoresAndClose"][data-sid="' + sid + '"][data-score="' + n + '"]';

    it('writes every competency of the student, over a score already there, dropping its +', () => {
      open(ESSAY);
      press(ESSAY, row(AVA, 4));
      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: 4, [PLAN]: 4 });
      expect(session.since()).toEqual([tagScore(AVA, QUESTION, 4), tagScore(AVA, PLAN, 4)]);
      expect(toastText()).toBe('Row filled');

      executeUndo();
      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: '3+', [PLAN]: 0 });
      expect(session.since()).toEqual(twice([tagScore(AVA, QUESTION, 3, 1), tagScore(AVA, PLAN, 0)]));
    });

    it('Clear sends a 0 for each competency, the unscored one included', () => {
      open(ESSAY);
      press(ESSAY, row(AVA, 0));
      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      expect(session.since()).toEqual([tagScore(AVA, QUESTION, 0), tagScore(AVA, PLAN, 0)]);
      expect(toastText()).toBe('Row cleared');

      executeUndo();
      expect(levels(CID, AVA, ESSAY)).toEqual({ [QUESTION]: '3+', [PLAN]: 0 });
      expect(session.since()).toEqual(twice([tagScore(AVA, QUESTION, 3, 1)]));
    });

    it('writes nothing for a Missing student, and the toast still says Row filled', () => {
      open(ESSAY);
      press(ESSAY, row(DEV, 4));
      expect(levels(CID, DEV, ESSAY)).toEqual({});
      expect(session.sent()).toEqual([]);
      expect(toastText()).toBe('Row filled');
    });
  });

  describe('on rubric work', () => {
    it('Set Everyone To sets the criteria with no score and sends one upsert_rubric_score each', () => {
      open(LAB);
      press(LAB, '[data-action="confirmFillRubricAll"][data-score="3"]');
      expect(document.getElementById('confirm-ok-btn').textContent).toBe('Set 5 Criteria');
      confirmOk();

      expect(levels(CID, AVA, LAB)).toEqual({ [SAFETY]: 2, [METHOD]: 3 });
      expect(levels(CID, BEN, LAB)).toEqual({ [SAFETY]: 3, [METHOD]: 3 });
      expect(levels(CID, CARA, LAB)).toEqual({ [SAFETY]: 3, [METHOD]: 3 });
      expect(levels(CID, DEV, LAB)).toEqual({}); // Excused
      expect(session.since()).toEqual([
        rubricScore(AVA, METHOD, 3),
        rubricScore(BEN, SAFETY, 3),
        rubricScore(BEN, METHOD, 3),
        rubricScore(CARA, SAFETY, 3),
        rubricScore(CARA, METHOD, 3),
      ]);
      expect(toastText()).toBe('5 criteria set to Proficient');

      executeUndo();
      expect(levels(CID, AVA, LAB)).toEqual({ [SAFETY]: 2, [METHOD]: 0 });
      expect(levels(CID, BEN, LAB)).toEqual({ [SAFETY]: 0, [METHOD]: 0 });
      expect(session.since()).toEqual(
        twice([
          rubricScore(AVA, METHOD, 0),
          rubricScore(BEN, SAFETY, 0),
          rubricScore(BEN, METHOD, 0),
          rubricScore(CARA, SAFETY, 0),
          rubricScore(CARA, METHOD, 0),
        ]),
      );
    });

    it('a row’s fill writes every criterion of the student, over a score already there', () => {
      open(LAB);
      press(LAB, '[data-action="fillRubricScoresAndClose"][data-sid="' + AVA + '"][data-score="4"]');
      expect(levels(CID, AVA, LAB)).toEqual({ [SAFETY]: 4, [METHOD]: 4 });
      expect(session.since()).toEqual([rubricScore(AVA, SAFETY, 4), rubricScore(AVA, METHOD, 4)]);

      executeUndo();
      expect(levels(CID, AVA, LAB)).toEqual({ [SAFETY]: 2, [METHOD]: 0 });
      expect(session.since()).toEqual(twice([rubricScore(AVA, SAFETY, 2), rubricScore(AVA, METHOD, 0)]));
    });
  });

  describe('on points work', () => {
    it('Set Unmarked to 10 / 10 skips a scored student and any status, Late included', () => {
      open(QUIZ);
      press(QUIZ, '[data-action="confirmFillPoints"]');
      expect(document.querySelector('.confirm-message').textContent).toBe('Set every unmarked student to 10 / 10?');
      confirmOk();

      expect(getPointsScore(CID, AVA, QUIZ)).toBe(7);
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(10);
      expect(getPointsScore(CID, CARA, QUIZ)).toBe(null); // Excused
      expect(getPointsScore(CID, DEV, QUIZ)).toBe(null); // Late
      expect(session.since()).toEqual([score(BEN, QUIZ, 10)]);
      expect(toastText()).toBe('Unmarked students set to 10 / 10');

      // Undo removes the entry the fill added and sends a null value twice.
      executeUndo();
      expect(getScores(CID)[BEN]).toEqual([]);
      expect(session.since()).toEqual(twice([score(BEN, QUIZ, null)]));
    });

    it('Set Unmarked to Missing marks the same students and sends the status alone; Undo takes it off', () => {
      open(QUIZ);
      press(QUIZ, '[data-action="confirmFillNotSubmitted"]');
      confirmOk();

      expect(getAssignmentStatus(CID, BEN, QUIZ)).toBe('NS');
      expect(getAssignmentStatus(CID, AVA, QUIZ)).toBe(null);
      expect(getAssignmentStatus(CID, DEV, QUIZ)).toBe('LATE');
      expect(storedMatchesCache('statuses', CID)).toBe(true);
      expect(session.since()).toEqual([status(BEN, QUIZ, 'NS')]);
      expect(toastText()).toBe('Unmarked students set to Missing');

      executeUndo();
      expect(getAssignmentStatus(CID, BEN, QUIZ)).toBe(null);
      expect(session.since()).toEqual([status(BEN, QUIZ, null)]);
    });
  });

  describe('on Complete/Incomplete work', () => {
    it('Set Unmarked to Complete skips Incomplete and any status; Undo removes the marks', () => {
      open(EXIT);
      press(EXIT, '[data-action="confirmFillCompletion"]');
      confirmOk();

      expect([AVA, BEN, CARA, DEV].map(sid => getCompletionMark(CID, sid, EXIT))).toEqual([
        'incomplete',
        'complete',
        'complete',
        null, // Late
      ]);
      expect(session.since()).toEqual([score(BEN, EXIT, 1), score(CARA, EXIT, 1)]);
      expect(toastText()).toBe('Unmarked students set to Complete');

      executeUndo();
      expect([AVA, BEN, CARA, DEV].map(sid => getCompletionMark(CID, sid, EXIT))).toEqual([
        'incomplete',
        null,
        null,
        null,
      ]);
      expect(session.since()).toEqual(twice([score(BEN, EXIT, null), score(CARA, EXIT, null)]));
    });

    it('Set Unmarked to Missing sends one status per student', () => {
      open(EXIT);
      press(EXIT, '[data-action="confirmFillNotSubmitted"]');
      confirmOk();
      expect(session.sent()).toEqual([status(BEN, EXIT, 'NS'), status(CARA, EXIT, 'NS')]);
      expect(getAssignmentStatus(CID, DEV, EXIT)).toBe('LATE');
    });
  });
});
