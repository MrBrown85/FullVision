/**
 * Pin: the three parts of the desktop grader dialog that
 * tests/pin-grader-dialog-writes.test.js leaves out: the DIBELS fields,
 * Grade Separately and Back to Group Grade (teacher/page-assignments.js).
 * S0-T2 moves these writes onto shared/grader.js; this was committed before
 * that move and passes on both sides of it.
 *
 * The dialog is opened and worked as a teacher works it, as in the other
 * pin. After each step this records what the data.js cache and localStorage
 * hold and the RPCs sent, in order. It records today's behaviour, oddities
 * included.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  levels,
  storedMatchesCache,
  click,
  settle,
  typeAndLeave,
  confirmOk,
  openGrader,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const READING = U(31); // a DIBELS 8 benchmark
const TALK = U(37); // pair work: Ava and Ben are graded together; Cara is in no pair
const QUESTION = U(41);

function seedWith(more) {
  return () =>
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
      ],
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: READING, title: 'Fall Reading', scoreMode: 'dibels', tagIds: [], date: '2026-10-10' },
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
      // An empty list, so a window saved by the test before is not read back.
      dibels: {},
      ...more,
    });
}

/* ── The RPCs, as the recorder lists them ─────────────────────────────── */
const dibels = (sid, period, wrc, errors, correct, incorrect) => [
  'upsert_dibels_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: READING,
    p_period: period,
    p_orf_wrc: wrc,
    p_orf_errors: errors,
    p_maze_correct: correct,
    p_maze_incorrect: incorrect,
  },
];
const tagScore = (sid, value, modifier, comment = null) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: TALK,
    p_tag_id: QUESTION,
    p_value: value,
    p_modifier: modifier,
    p_comment: comment,
  },
];
const comment = (sid, text) => ['save_score_comment', { p_enrollment_id: sid, p_assessment_id: TALK, p_comment: text }];
// Who is graded separately is kept on the assessment, in its group setup
// (save_collab). The first save of a seeded class sends the assessment
// too (update_assessment, shortened here to its id): the seed gives data.js
// no server copy of the assessments to compare with.
const assessment = ['update_assessment', TALK];
const collab = list => [
  'save_collab',
  {
    p_id: TALK,
    p_mode: 'pairs',
    p_config: list ? { pairs: [[AVA, BEN]], gradedSeparately: list } : { pairs: [[AVA, BEN]] },
  },
];
const separately = sent =>
  sent.map(([name, params]) => (name === 'update_assessment' ? [name, params.p_id] : [name, params]));

/* ── The dialog's controls, looked up when used: it redraws after a save. */
const at = selector => document.querySelector('#grader-overlay ' + selector);
const field = name => at('[data-action-blur="dibelsField"][data-field="' + name + '"]');
const windowButton = period => at('[data-action="setDibelsPeriod"][data-period="' + period + '"]');
const tagLevel = n => at('[data-action="graderTagLevel"][data-tag="' + QUESTION + '"][data-level="' + n + '"]');
const more = sid => at('[data-grader="member-menu"][data-sid="' + sid + '"]');
const gradeSeparately = sid => at('[data-grader="separate"][data-sid="' + sid + '"]');
const backToGroup = sid => at('[data-grader="rejoin"][data-sid="' + sid + '"]');
const openMember = sid => at('[data-grader="open-member"][data-sid="' + sid + '"]');
const overallComment = () => at('[data-action-blur="rsgOverallComment"]');
const talk = () => getAssessments(CID).find(a => a.id === TALK);

describe('pin: the grader dialog’s DIBELS fields, Grade Separately and Back to Group Grade', () => {
  let session = null;

  function open(aid, sid, extra) {
    openGrader(seedWith(extra), CID, aid, sid);
    session = signIn();
  }

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  describe('the DIBELS fields', () => {
    it('a field left saves its window’s four numbers and sends one upsert_dibels_score', () => {
      open(READING, AVA);
      click(windowButton('moy'));
      typeAndLeave(field('orfWrc'), '112');

      expect(getDibelsScores(CID)).toEqual({
        [AVA + ':' + READING]: { moy: { orfWrc: 112, orfErrors: null, mazeCorrect: null, mazeIncorrect: null } },
      });
      expect(storedMatchesCache('dibels', CID)).toBe(true);
      expect(session.sent()).toEqual([dibels(AVA, 'moy', 112, null, null, null)]);
      // No score entry: DIBELS counts toward no grade.
      expect(entries(CID, AVA)).toEqual([]);
    });

    it('each field sends all four again; an unchanged field sends nothing; a decimal is cut to a whole number', () => {
      open(READING, AVA);
      click(windowButton('moy'));
      typeAndLeave(field('orfWrc'), '112');
      session.since();

      typeAndLeave(field('orfErrors'), '4');
      expect(session.since()).toEqual([dibels(AVA, 'moy', 112, 4, null, null)]);
      typeAndLeave(field('orfErrors'), '4');
      expect(session.since()).toEqual([]);
      typeAndLeave(field('mazeCorrect'), '18.9');
      expect(field('mazeCorrect').value).toBe('18');
      expect(session.since()).toEqual([dibels(AVA, 'moy', 112, 4, 18, null)]);
    });

    it('a typo or a negative number empties the field; the last field emptied clears the window', () => {
      open(READING, AVA);
      click(windowButton('moy'));
      typeAndLeave(field('orfWrc'), '112');
      typeAndLeave(field('orfErrors'), '4');
      session.since();

      typeAndLeave(field('orfErrors'), 'abc');
      expect(field('orfErrors').value).toBe('');
      expect(session.since()).toEqual([dibels(AVA, 'moy', 112, null, null, null)]);
      typeAndLeave(field('orfWrc'), '-3');
      expect(getDibelsScores(CID)).toEqual({});
      expect(storedMatchesCache('dibels', CID)).toBe(true);
      expect(session.since()).toEqual([dibels(AVA, 'moy', null, null, null, null)]);
    });

    it('each window is saved on its own', () => {
      open(READING, AVA);
      click(windowButton('boy'));
      typeAndLeave(field('orfWrc'), '90');
      click(windowButton('eoy'));
      typeAndLeave(field('mazeIncorrect'), '2');

      expect(getDibelsScores(CID)[AVA + ':' + READING]).toEqual({
        boy: { orfWrc: 90, orfErrors: null, mazeCorrect: null, mazeIncorrect: null },
        eoy: { orfWrc: null, orfErrors: null, mazeCorrect: null, mazeIncorrect: 2 },
      });
      expect(session.sent()).toEqual([
        dibels(AVA, 'boy', 90, null, null, null),
        dibels(AVA, 'eoy', null, null, null, 2),
      ]);
    });

    it('with writes off, as in Demo Mode, the numbers are saved on this device', () => {
      openGrader(seedWith(), CID, READING, AVA);
      click(windowButton('moy'));
      typeAndLeave(field('mazeCorrect'), '20');
      expect(getDibelsScore(CID, AVA, READING, 'moy')).toEqual({
        orfWrc: null,
        orfErrors: null,
        mazeCorrect: 20,
        mazeIncorrect: null,
      });
      expect(storedMatchesCache('dibels', CID)).toBe(true);
    });
  });

  /* The assessment's save is sent a moment after the click (data.js queues
     it behind any earlier one), so each step waits for it, as the time
     between a teacher's clicks does. */
  async function separate(sid) {
    click(more(sid));
    click(gradeSeparately(sid));
    await settle();
  }
  async function sent() {
    await settle();
    return separately(session.since());
  }

  describe('Grade Separately', () => {
    it('keeps the member’s copy of the pair’s grade and sends the pairs with the list', async () => {
      open(TALK, AVA);
      click(tagLevel(3));
      session.since();
      await separate(BEN);

      expect(talk().gradedSeparately).toEqual([BEN]);
      expect(storedMatchesCache('assessments', CID)).toBe(true);
      expect(levels(CID, BEN, TALK)).toEqual({ [QUESTION]: 3 });
      expect(await sent()).toEqual([assessment, collab([BEN])]);
    });

    it('after it, a level for the pair no longer reaches that member, and theirs no longer reaches the pair', async () => {
      open(TALK, AVA);
      await separate(BEN);
      session.since();

      click(tagLevel(3));
      expect(levels(CID, AVA, TALK)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN, TALK)).toEqual({});
      click(openMember(BEN));
      click(tagLevel(2));
      expect(levels(CID, AVA, TALK)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN, TALK)).toEqual({ [QUESTION]: 2 });
      expect(await sent()).toEqual([tagScore(AVA, 3, 0), tagScore(BEN, 2, 0)]);
    });

    it('with writes off, as in Demo Mode, it is saved on this device', () => {
      openGrader(seedWith(), CID, TALK, AVA);
      click(more(BEN));
      click(gradeSeparately(BEN));
      expect(talk().gradedSeparately).toEqual([BEN]);
      expect(storedMatchesCache('assessments', CID)).toBe(true);
    });
  });

  describe('Back to Group Grade', () => {
    it('asks first, then replaces the member’s own level and Overall Comment with the pair’s', async () => {
      open(TALK, AVA);
      await separate(BEN);
      click(tagLevel(3));
      typeAndLeave(overallComment(), 'Good talk');
      click(openMember(BEN));
      click(tagLevel(2));
      typeAndLeave(overallComment(), 'Speak up');
      await sent();

      click(backToGroup(BEN));
      // Nothing changes until the question is answered.
      expect(talk().gradedSeparately).toEqual([BEN]);
      expect(await sent()).toEqual([]);
      confirmOk();

      expect(talk().gradedSeparately).toBeUndefined();
      expect(storedMatchesCache('assessments', CID)).toBe(true);
      expect(entries(CID, BEN, TALK).map(e => [e.id, e.score, e.note])).toEqual([
        [BEN + ':' + TALK + ':' + QUESTION, 3, 'Good talk'],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // The level and comment go first; the pairs, without the list, a moment later.
      expect(await sent()).toEqual([tagScore(BEN, 3, 0), comment(BEN, 'Good talk'), collab(null)]);
    });

    it('a member with a grade goes back to a pair that has none: their own grade is cleared', async () => {
      open(TALK, AVA);
      await separate(BEN);
      click(openMember(BEN));
      click(tagLevel(2));
      await sent();

      click(backToGroup(BEN));
      confirmOk();
      expect(levels(CID, BEN, TALK)).toEqual({});
      expect(await sent()).toEqual([tagScore(BEN, 0, 0), collab(null)]);
    });

    it('with nobody to copy from, nothing is asked and the member keeps their grade', async () => {
      open(TALK, AVA);
      await separate(BEN);
      await separate(AVA);
      click(tagLevel(2));
      await sent();

      // Ava's own view, with the Graded Separately From line.
      click(backToGroup(AVA));
      expect(document.getElementById('confirm-ok-btn')).toBeNull();
      expect(talk().gradedSeparately).toEqual([BEN]);
      expect(levels(CID, AVA, TALK)).toEqual({ [QUESTION]: 2 });
      expect(await sent()).toEqual([collab([BEN])]);
    });

    it('with writes off, as in Demo Mode, it is saved on this device', () => {
      openGrader(seedWith(), CID, TALK, AVA);
      click(more(BEN));
      click(gradeSeparately(BEN));
      click(tagLevel(3));
      click(backToGroup(BEN));
      confirmOk();
      expect(talk().gradedSeparately).toBeUndefined();
      expect(levels(CID, BEN, TALK)).toEqual({ [QUESTION]: 3 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
    });
  });
});
