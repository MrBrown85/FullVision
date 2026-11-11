/**
 * Pin: what the desktop grader dialog writes (teacher/page-assignments.js),
 * S0-P1. S0-T2 moves these writes onto shared/grader.js.
 *
 * The dialog is opened over the gradebook on a linkedom document
 * (PageAssignments.openGrader) and worked the way a teacher works it: a
 * level, + and −, the 1–4 keys, points, Complete/Incomplete, Missing,
 * Excused and Late, a checklist tick, a criterion or competency comment,
 * the Overall Comment, the Note for the Report, clearing a level and Undo.
 * After each one this records the score entries in the data.js cache, the
 * copy in localStorage, and the RPCs sent, in order. It records today's
 * behaviour, oddities included; the PR that added it lists them.
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
  click,
  key,
  fire,
  tick,
  typeAndLeave,
  toastText,
  openGrader,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const ESSAY = U(31); // competency levels
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric
const EXIT = U(34); // Complete/Incomplete
const JOURNAL = U(35); // one Overall level, no competency
const CLAIM = U(36); // a single-point rubric
const TALK = U(37); // pair work: Ava and Ben are graded together
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74); // Safety, level 3
const STATION = U(75); // Safety, level 3
const REMINDS = U(76); // Safety, level 4
const CLAIM_RUBRIC = U(81);
const STATES = U(82);

// What each level of a criterion says; any wording does.
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

function seedWith(more) {
  return () =>
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
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
                { id: REMINDS, level: 4, label: 'Reminds others' },
              ],
            },
            { id: METHOD, name: 'Method', tagIds: [], levels: WORDS, checks: [] },
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
      ],
      ...more,
    });
}

/* ── The RPCs, as the recorder lists them ─────────────────────────────── */
const rubricScore = (sid, aid, criterion, value, modifier, comment = null, beyond = null) => [
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
const tagScore = (sid, aid, tag, value, modifier, comment = null) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_tag_id: tag,
    p_value: value,
    p_modifier: modifier,
    p_comment: comment,
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

/* ── The dialog's controls. It redraws after most saves, so each is looked
   up when it is used. ───────────────────────────────────────────────── */
const at = selector => document.querySelector('#grader-overlay ' + selector);
const level = (criterion, n) =>
  at('[data-action="graderLevel"][data-critid="' + criterion + '"][data-level="' + n + '"]');
const plusMinus = (criterion, mod) =>
  at('[data-action="graderMod"][data-critid="' + criterion + '"][data-mod="' + mod + '"]');
const tagLevel = (tag, n) => at('[data-action="graderTagLevel"][data-tag="' + tag + '"][data-level="' + n + '"]');
const tagPlusMinus = (tag, mod) => at('[data-action="graderTagMod"][data-tag="' + tag + '"][data-mod="' + mod + '"]');
const box = id => at('[data-action="graderTick"][data-checkid="' + id + '"]');
const statusButton = which => at('[data-action="toggleStudentStatus"][data-status="' + which + '"]');
const mark = which => at('[data-action="graderMark"][data-mark="' + which + '"]');
// A rubric criterion's comment box opens from its Comment chip.
const criterionNote = criterion => {
  const sel = '[data-action-blur="graderCritNote"][data-critid="' + criterion + '"]';
  if (!document.querySelector('#grader-overlay ' + sel))
    click(at('[data-action="graderNote"][data-critid="' + criterion + '"]'));
  return at(sel);
};
const tagNote = tag => at('[data-action-blur="graderTagNote"][data-tag="' + tag + '"]');
const overallComment = () => at('[data-action-blur="rsgOverallComment"]');
const pointsBox = () => at('.grdp-input');

describe('pin: the grader dialog’s writes', () => {
  let session = null;

  function open(aid, sid, more) {
    openGrader(seedWith(more), CID, aid, sid);
    session = signIn();
  }

  afterEach(() => {
    vi.useRealTimers();
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  describe('a rubric criterion', () => {
    it('a level makes one entry under the criterion’s id and sends one upsert_rubric_score', () => {
      open(LAB, AVA);
      click(level(METHOD, 3));

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + LAB + ':' + METHOD,
          assessmentId: LAB,
          tagId: METHOD,
          score: 3,
          date: '2026-10-12', // the assessment's date, not today's
          type: 'summative',
          note: '',
        },
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 0)]);
    });

    it('+ and − are sent as p_modifier with the level; a second press takes it off; a new level drops it', () => {
      open(LAB, AVA);
      click(level(METHOD, 3));
      click(plusMinus(METHOD, 1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3+' });
      click(plusMinus(METHOD, 1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 3 });
      click(plusMinus(METHOD, -1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3-' });
      click(level(METHOD, 4));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 4 });
      // Extending takes no +.
      click(plusMinus(METHOD, 1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 4 });

      expect(session.sent()).toEqual([
        rubricScore(AVA, LAB, METHOD, 3, 0),
        rubricScore(AVA, LAB, METHOD, 3, 1),
        rubricScore(AVA, LAB, METHOD, 3, 0),
        rubricScore(AVA, LAB, METHOD, 3, -1),
        rubricScore(AVA, LAB, METHOD, 4, 0),
      ]);
    });

    it('the 1–4 and + − keys on a focused criterion write what the clicks do', () => {
      open(LAB, AVA);
      const card = () => at('.grdt-crit[data-critid="' + METHOD + '"]');
      card().focus();
      key(card(), '2');
      key(card(), '+');
      key(card(), '-');
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '2-' });
      expect(session.sent()).toEqual([
        rubricScore(AVA, LAB, METHOD, 2, 0),
        rubricScore(AVA, LAB, METHOD, 2, 1),
        rubricScore(AVA, LAB, METHOD, 2, -1),
      ]);
    });

    it('the chosen level clicked again clears it: the entry stays with score 0 and a 0 is sent', () => {
      open(LAB, AVA);
      click(level(METHOD, 4));
      click(plusMinus(METHOD, -1));
      session.since();
      click(level(METHOD, 4));

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + LAB + ':' + METHOD,
          assessmentId: LAB,
          tagId: METHOD,
          score: 0,
          date: '2026-10-12',
          type: 'summative',
          note: '',
        },
      ]);
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 0, 0)]);
      expect(toastText()).toBe('Score cleared');
    });

    it('Undo after a clear puts the level and its − back, and sends it twice', () => {
      open(LAB, AVA);
      click(level(METHOD, 4));
      click(plusMinus(METHOD, -1));
      click(level(METHOD, 4));
      session.since();
      executeUndo();

      expect(levels(CID, AVA)).toEqual({ [METHOD]: '4-' });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // restoreScoreCells saves the list (which sends the change) and then
      // sends the same change itself.
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 4, -1), rubricScore(AVA, LAB, METHOD, 4, -1)]);
    });

    it('a comment with no level yet makes an unscored entry and sends a null value', () => {
      open(LAB, AVA);
      typeAndLeave(criterionNote(SAFETY), '  Wear goggles  ');

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + LAB + ':' + SAFETY,
          assessmentId: LAB,
          tagId: SAFETY,
          score: 0,
          date: '2026-10-12',
          type: 'summative',
          note: '',
          critNote: 'Wear goggles',
        },
      ]);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, SAFETY, null, 0, 'Wear goggles')]);
    });

    it('a comment on a scored criterion goes up with its level; unchanged sends nothing; emptied sends ""', () => {
      open(LAB, AVA);
      click(level(METHOD, 3));
      click(plusMinus(METHOD, 1));
      session.since();

      typeAndLeave(criterionNote(METHOD), 'Label the axes');
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 1, 'Label the axes')]);
      typeAndLeave(criterionNote(METHOD), ' Label the axes ');
      expect(session.since()).toEqual([]);
      // A later level change sends the comment again with it.
      click(level(METHOD, 2));
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 2, 0, 'Label the axes')]);
      typeAndLeave(criterionNote(METHOD), '');
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 2, 0, '')]);
      expect(entries(CID, AVA)[0].critNote).toBeUndefined();
    });

    it('a single-point rubric sends Work On and Went Beyond together, each time either changes', () => {
      open(CLAIM, AVA);
      typeAndLeave(at('[data-action-blur="graderCritBeyond"]'), 'Cited two sources');
      typeAndLeave(criterionNote(STATES), 'Add evidence');
      click(level(STATES, 3));

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + CLAIM + ':' + STATES,
          assessmentId: CLAIM,
          tagId: STATES,
          score: 3,
          date: '2026-10-15',
          type: 'summative',
          note: '',
          critBeyond: 'Cited two sources',
          critNote: 'Add evidence',
        },
      ]);
      expect(session.sent()).toEqual([
        rubricScore(AVA, CLAIM, STATES, null, 0, null, 'Cited two sources'),
        rubricScore(AVA, CLAIM, STATES, null, 0, 'Add evidence', 'Cited two sources'),
        rubricScore(AVA, CLAIM, STATES, 3, 0, 'Add evidence', 'Cited two sources'),
      ]);
    });
  });

  describe('an Advanced rubric’s checklist', () => {
    it('a tick sends set_rubric_check; the tick that completes a level also writes that level', () => {
      open(LAB, AVA);
      tick(box(GOGGLES), true);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES]);
      expect(levels(CID, AVA)).toEqual({});
      expect(session.since()).toEqual([check(AVA, LAB, GOGGLES, true)]);

      tick(box(STATION), true);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3 });
      expect(session.since()).toEqual([check(AVA, LAB, STATION, true), rubricScore(AVA, LAB, SAFETY, 3, 0)]);
      expect(storedMatchesCache('rubricChecks', CID)).toBe(true);
    });

    it('clearing a tick takes the suggested level back to 0', () => {
      open(LAB, AVA);
      tick(box(GOGGLES), true);
      tick(box(STATION), true);
      session.since();
      tick(box(STATION), false);

      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 0 });
      expect(session.since()).toEqual([check(AVA, LAB, STATION, false), rubricScore(AVA, LAB, SAFETY, 0, 0)]);
    });

    it('a level the teacher picked by hand stays when the boxes say otherwise', () => {
      open(LAB, AVA);
      click(level(SAFETY, 2));
      session.since();
      tick(box(GOGGLES), true);
      tick(box(STATION), true);

      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 2 });
      expect(session.since()).toEqual([check(AVA, LAB, GOGGLES, true), check(AVA, LAB, STATION, true)]);
    });
  });

  describe('a competency (no rubric)', () => {
    it('a level, a −, and a comment each send one upsert_tag_score', () => {
      open(ESSAY, AVA);
      click(tagLevel(QUESTION, 3));
      click(tagPlusMinus(QUESTION, -1));
      typeAndLeave(tagNote(QUESTION), 'A sharp question');

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + ESSAY + ':' + QUESTION,
          assessmentId: ESSAY,
          tagId: QUESTION,
          score: 3,
          mod: -1,
          date: '2026-10-10',
          type: 'summative',
          note: '',
          critNote: 'A sharp question',
        },
      ]);
      expect(session.sent()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 3, 0),
        tagScore(AVA, ESSAY, QUESTION, 3, -1),
        tagScore(AVA, ESSAY, QUESTION, 3, -1, 'A sharp question'),
      ]);
    });

    it('a comment with no level yet makes an unscored entry and sends a null value', () => {
      open(ESSAY, AVA);
      typeAndLeave(tagNote(PLAN), 'Needs a plan');

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + ESSAY + ':' + PLAN,
          assessmentId: ESSAY,
          tagId: PLAN,
          score: 0,
          date: '2026-10-10',
          type: 'summative',
          note: '',
          critNote: 'Needs a plan',
        },
      ]);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, PLAN, null, 0, 'Needs a plan')]);
    });

    it('clearing the level keeps the comment; Undo puts the level back and sends it twice', () => {
      open(ESSAY, AVA);
      click(tagLevel(QUESTION, 3));
      click(tagPlusMinus(QUESTION, -1));
      typeAndLeave(tagNote(QUESTION), 'A sharp question');
      session.since();

      click(tagLevel(QUESTION, 3));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 0 });
      expect(entries(CID, AVA)[0].critNote).toBe('A sharp question');
      expect(session.since()).toEqual([tagScore(AVA, ESSAY, QUESTION, 0, 0, 'A sharp question')]);
      expect(toastText()).toBe('Score cleared');

      executeUndo();
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: '3-' });
      expect(session.since()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 3, -1, 'A sharp question'),
        tagScore(AVA, ESSAY, QUESTION, 3, -1, 'A sharp question'),
      ]);
    });
  });

  describe('work scored as a whole (no competency ticked)', () => {
    it('the level is kept under the key "overall" and sent as upsert_score with its + or −', () => {
      open(JOURNAL, AVA);
      click(tagLevel('overall', 3));
      click(tagPlusMinus('overall', 1));

      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + JOURNAL + ':overall',
          assessmentId: JOURNAL,
          tagId: 'overall',
          score: 3,
          mod: 1,
          date: '2026-10-14',
          type: 'summative',
          note: '',
        },
      ]);
      expect(session.sent()).toEqual([score(AVA, JOURNAL, 3, 0), score(AVA, JOURNAL, 3, 1)]);
    });

    it('clearing it sends a null value with no modifier; Undo sends the level twice', () => {
      open(JOURNAL, AVA);
      click(tagLevel('overall', 3));
      click(tagPlusMinus('overall', 1));
      session.since();

      click(tagLevel('overall', 3));
      expect(levels(CID, AVA)).toEqual({ overall: 0 });
      expect(session.since()).toEqual([score(AVA, JOURNAL, null)]);

      executeUndo();
      expect(levels(CID, AVA)).toEqual({ overall: '3+' });
      expect(session.since()).toEqual([score(AVA, JOURNAL, 3, 1), score(AVA, JOURNAL, 3, 1)]);
    });

    it('the comment box under the level saves on this device only: nothing is sent', () => {
      open(JOURNAL, AVA);
      click(tagLevel('overall', 3));
      session.since();
      typeAndLeave(tagNote('overall'), 'A note under the level');

      expect(entries(CID, AVA)[0].critNote).toBe('A note under the level');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual([]);
    });
  });

  describe('points', () => {
    const points = () => getPointsScore(CID, AVA, QUIZ);

    it('a typed score makes one entry under the first competency and sends upsert_score with no modifier', () => {
      open(QUIZ, AVA);
      typeAndLeave(pointsBox(), '7');

      const saved = entries(CID, AVA);
      expect(saved).toEqual([
        {
          id: saved[0].id, // a new local id each time (uid()), unlike a level's
          assessmentId: QUIZ,
          tagId: QUESTION,
          score: 7,
          date: '2026-10-11',
          // No category and no type of its own: formative (scoreTypeFor).
          type: 'formative',
          note: '',
        },
      ]);
      expect(saved[0].id).not.toContain(':');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 7)]);
    });

    it('the same score, or a typo, saves nothing; a decimal and a 0 are scores; an empty box clears', () => {
      open(QUIZ, AVA);
      typeAndLeave(pointsBox(), '7');
      session.since();

      typeAndLeave(pointsBox(), '7');
      typeAndLeave(pointsBox(), 'abc');
      expect(points()).toBe(7);
      expect(session.since()).toEqual([]);

      typeAndLeave(pointsBox(), '7.5');
      expect(session.since()).toEqual([score(AVA, QUIZ, 7.5)]);

      typeAndLeave(pointsBox(), '0');
      expect(points()).toBe(0);
      expect(session.since()).toEqual([score(AVA, QUIZ, 0)]);

      typeAndLeave(pointsBox(), '');
      expect(points()).toBe(null);
      // The entry is removed, not kept at 0.
      expect(entries(CID, AVA)).toEqual([]);
      expect(session.since()).toEqual([score(AVA, QUIZ, null)]);
    });

    it('a score over twice the maximum is saved at the limit; Undo puts back the score before', () => {
      open(QUIZ, AVA);
      typeAndLeave(pointsBox(), '7.5');
      session.since();

      typeAndLeave(pointsBox(), '25');
      expect(points()).toBe(20);
      expect(session.since()).toEqual([score(AVA, QUIZ, 20)]);
      expect(toastText()).toBe('25 is more than twice the 10-point maximum, so it was saved as 20.');

      executeUndo();
      expect(points()).toBe(7.5);
      expect(session.since()).toEqual([score(AVA, QUIZ, 7.5)]);
    });

    it('a score typed after an Overall Comment fills the comment’s entry and sends the comment again', () => {
      open(QUIZ, AVA);
      typeAndLeave(overallComment(), 'Rewrite Friday');
      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + QUIZ + ':' + QUESTION,
          assessmentId: QUIZ,
          tagId: QUESTION,
          score: null, // a 0 here would be a score
          date: '2026-10-11',
          type: 'formative',
          note: 'Rewrite Friday',
        },
      ]);
      expect(session.since()).toEqual([comment(AVA, QUIZ, 'Rewrite Friday')]);

      typeAndLeave(pointsBox(), '9');
      expect(entries(CID, AVA).map(e => [e.score, e.note])).toEqual([[9, 'Rewrite Friday']]);
      expect(session.since()).toEqual([score(AVA, QUIZ, 9), comment(AVA, QUIZ, 'Rewrite Friday')]);
    });
  });

  describe('Complete/Incomplete', () => {
    it('Complete is 1, Incomplete is 0, and the mark clicked again clears it', () => {
      open(EXIT, AVA);
      click(mark('complete'));
      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.type])).toEqual([[QUESTION, 1, 'formative']]);
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('complete');
      click(mark('incomplete'));
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('incomplete');
      click(mark('incomplete'));
      expect(getCompletionMark(CID, AVA, EXIT)).toBe(null);
      expect(entries(CID, AVA)).toEqual([]);

      expect(session.sent()).toEqual([score(AVA, EXIT, 1), score(AVA, EXIT, 0), score(AVA, EXIT, null)]);
    });
  });

  describe('Missing, Excused and Late', () => {
    it('Missing on unscored rubric work sends the status, then a 0 for every criterion', () => {
      open(LAB, BEN);
      click(statusButton('NS'));

      expect(getAssignmentStatuses(CID)).toEqual({ [BEN + ':' + LAB]: 'NS' });
      expect(storedMatchesCache('statuses', CID)).toBe(true);
      // Each criterion gets an entry with score 0.
      expect(levels(CID, BEN)).toEqual({ [SAFETY]: 0, [METHOD]: 0 });
      expect(session.sent()).toEqual([
        status(BEN, LAB, 'NS'),
        rubricScore(BEN, LAB, SAFETY, 0, 0),
        rubricScore(BEN, LAB, METHOD, 0, 0),
      ]);
    });

    it('Missing on unscored competency work does the same with upsert_tag_score', () => {
      open(ESSAY, BEN);
      click(statusButton('NS'));

      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      expect(session.sent()).toEqual([
        status(BEN, ESSAY, 'NS'),
        tagScore(BEN, ESSAY, QUESTION, 0, 0),
        tagScore(BEN, ESSAY, PLAN, 0, 0),
      ]);
    });

    it('Missing on points or Complete/Incomplete work sends the status alone', () => {
      open(QUIZ, BEN);
      click(statusButton('NS'));
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([status(BEN, QUIZ, 'NS')]);
    });

    it('Excused sends the status alone', () => {
      open(LAB, BEN);
      click(statusButton('EXC'));
      expect(getAssignmentStatus(CID, BEN, LAB)).toBe('EXC');
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([status(BEN, LAB, 'EXC')]);
    });

    it('the same button pressed again within 300 ms is ignored; after it, it takes the status off', () => {
      open(QUIZ, BEN);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      click(statusButton('NS'));
      click(statusButton('NS'));
      expect(getAssignmentStatus(CID, BEN, QUIZ)).toBe('NS');
      expect(session.since()).toEqual([status(BEN, QUIZ, 'NS')]);

      vi.advanceTimersByTime(300);
      click(statusButton('NS'));
      expect(getAssignmentStatus(CID, BEN, QUIZ)).toBe(null);
      expect(session.since()).toEqual([status(BEN, QUIZ, null)]);
    });

    it('a level and a tick are refused on Missing work', () => {
      open(LAB, BEN, { statuses: { [BEN + ':' + LAB]: 'NS' } });
      click(level(METHOD, 3));
      tick(box(GOGGLES), true);
      expect(entries(CID, BEN)).toEqual([]);
      expect(getRubricCheckIds(CID, BEN, LAB)).toEqual([]);
      expect(session.sent()).toEqual([]);
    });

    it('points are refused on Excused work, and a mark on Missing work', () => {
      open(QUIZ, BEN, { statuses: { [BEN + ':' + QUIZ]: 'EXC', [BEN + ':' + EXIT]: 'NS' } });
      expect(pointsBox().disabled).toBe(true);
      typeAndLeave(pointsBox(), '5');
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(null);
      window.PageAssignments.openGrader(CID, EXIT, BEN);
      click(mark('complete'));
      expect(getCompletionMark(CID, BEN, EXIT)).toBe(null);
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([]);
    });

    it('Late on scored work sends the status and leaves the score; Missing and Excused are refused there', () => {
      open(LAB, AVA);
      click(level(METHOD, 3));
      session.since();

      click(statusButton('LATE'));
      expect(getAssignmentStatus(CID, AVA, LAB)).toBe('LATE');
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 3 });
      expect(session.since()).toEqual([status(AVA, LAB, 'LATE')]);

      click(statusButton('NS'));
      click(statusButton('EXC'));
      expect(getAssignmentStatus(CID, AVA, LAB)).toBe('LATE');
      expect(session.since()).toEqual([]);
    });
  });

  describe('the Overall Comment', () => {
    it('saves on leaving the box: the trimmed text on every entry of the work, and one save_score_comment', () => {
      open(LAB, AVA);
      click(level(SAFETY, 3));
      click(level(METHOD, 2));
      session.since();
      typeAndLeave(overallComment(), '  Solid lab.  ');

      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.note])).toEqual([
        [SAFETY, 3, 'Solid lab.'],
        [METHOD, 2, 'Solid lab.'],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual([comment(AVA, LAB, 'Solid lab.')]);

      // A level picked afterwards keeps it and does not send it again.
      click(level(METHOD, 4));
      expect(entries(CID, AVA).map(e => e.note)).toEqual(['Solid lab.', 'Solid lab.']);
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 4, 0)]);
    });

    it('on unscored rubric work it makes an entry with score 0 under the first criterion', () => {
      open(LAB, AVA);
      typeAndLeave(overallComment(), 'See me');
      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + LAB + ':' + SAFETY,
          assessmentId: LAB,
          tagId: SAFETY,
          score: 0,
          date: '2026-10-12',
          type: 'summative',
          note: 'See me',
        },
      ]);
      expect(session.sent()).toEqual([comment(AVA, LAB, 'See me')]);
    });

    it('saves 800 ms after the last key, and leaving the box then sends nothing more', () => {
      open(ESSAY, AVA);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const field = overallComment();
      field.focus();
      field.value = 'Clear thesis';
      fire(field, 'input');
      vi.advanceTimersByTime(799);
      expect(session.sent()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
      typeAndLeave(overallComment(), 'Clear thesis');
      expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
    });
  });

  describe('pair work, graded together', () => {
    it('a level is written for the student shown, then for their partner', () => {
      open(TALK, AVA);
      click(tagLevel(QUESTION, 3));

      expect(levels(CID, AVA, TALK)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN, TALK)).toEqual({ [QUESTION]: 3 });
      expect(entries(CID, BEN)[0].id).toBe(BEN + ':' + TALK + ':' + QUESTION);
      expect(session.sent()).toEqual([tagScore(AVA, TALK, QUESTION, 3, 0), tagScore(BEN, TALK, QUESTION, 3, 0)]);
    });

    it('the Overall Comment goes to both, and the partner’s level is sent again with it', () => {
      open(TALK, AVA);
      click(tagLevel(QUESTION, 3));
      session.since();
      typeAndLeave(overallComment(), 'Good talk');

      expect(getScoreComment(CID, AVA, TALK)).toBe('Good talk');
      expect(getScoreComment(CID, BEN, TALK)).toBe('Good talk');
      expect(session.since()).toEqual([
        comment(AVA, TALK, 'Good talk'),
        tagScore(BEN, TALK, QUESTION, 3, 0),
        comment(BEN, TALK, 'Good talk'),
      ]);
    });
  });

  describe('the Note for the Report', () => {
    it('saves on change, on every entry of the work, with an idempotency key', () => {
      open(LAB, AVA);
      click(level(METHOD, 3));
      session.since();
      const field = at('.grader-report-note-input');
      field.value = '  ran   the test twice ';
      fire(field, 'change');

      expect(entries(CID, AVA)[0].reportNote).toBe('ran the test twice');
      expect(session.since()).toEqual([
        [
          'save_score_report_note',
          { p_enrollment_id: AVA, p_assessment_id: LAB, p_note: 'ran the test twice', p_idempotency_key: '<key>' },
        ],
      ]);
    });
  });

  describe('with writes off, as in Demo Mode', () => {
    it('everything is saved on this device', () => {
      openGrader(seedWith(), CID, LAB, AVA);
      click(level(METHOD, 3));
      click(plusMinus(METHOD, 1));
      tick(box(GOGGLES), true);
      typeAndLeave(overallComment(), 'Solid lab');
      click(statusButton('LATE'));

      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.mod, e.note])).toEqual([[METHOD, 3, 1, 'Solid lab']]);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES]);
      expect(getAssignmentStatus(CID, AVA, LAB)).toBe('LATE');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(storedMatchesCache('statuses', CID)).toBe(true);
    });
  });
});
