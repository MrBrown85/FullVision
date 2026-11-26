/**
 * A grader box saves for the student the teacher went into it for, and a
 * step to another student leaves the box first (teacher/assign-inputs.js
 * _boxStudent, teacher/assign-focus.js _finishField).
 *
 * Before Nov 26, 2026 the four boxes that save on blur (points, a
 * criterion's comment, Went Beyond, a competency's comment) saved for the
 * student on the page when the blur ran. Chrome blurs a box as a redraw
 * takes it away, and by then a step had put the page on the next student:
 * ← or → in the points box gave the next student the first student's
 * points, and from an empty box erased theirs.
 *
 * linkedom sends no blur for a box that is taken away. stepThenBlur() makes
 * the order Chrome's: the page moves on, then the old box's blur arrives.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  click,
  leave,
  openGrader,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const ESSAY = U(31); // competency levels, a comment box under each
const QUIZ = U(32); // points, out of 10
const CLAIM = U(36); // a single-point rubric: Work On and Went Beyond
const QUESTION = U(41);
const CLAIM_RUBRIC = U(81);
const STATES = U(82);

const points = (id, sid, score) => ({
  id,
  assessmentId: QUIZ,
  tagId: QUESTION,
  score,
  date: '2026-10-11',
  type: 'formative',
  note: '',
});

function seed() {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: CLAIM_RUBRIC,
        name: 'Claim',
        style: 'single_point',
        criteria: [{ id: STATES, name: 'States a Claim', tagIds: [], levels: { 3: 'States a claim' }, checks: [] }],
      },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      { id: CLAIM, title: 'Claim', rubricId: CLAIM_RUBRIC, tagIds: [], date: '2026-10-15', type: 'summative' },
    ],
    // Ava has 6 on the quiz and Ben has 8.
    scores: { [AVA]: [points('p-ava', AVA, 6)], [BEN]: [points('p-ben', BEN, 8)] },
  });
}

const at = selector => document.querySelector('#grader-overlay ' + selector);
const pointsBox = () => at('.grdp-input');
const next = () => at('[data-grader="next"]');
const onPage = () => at('.grader-student').textContent;
/* The students the writes sent to the server were for. */
const sentFor = session => session.since().map(([, params]) => params.p_enrollment_id);

/* Chrome's order: Next draws Ben while the box still has the focus, then the
   box that was taken away gets its blur. */
function stepThenBlur(field) {
  field.blur = () => {};
  click(next());
  expect(onPage()).toContain('Ben');
  window.AssignInputs._handleBlur({ target: field, relatedTarget: null });
}

describe('a grader box saves for the student the teacher went into it for', () => {
  let session = null;

  function open(aid) {
    openGrader(seed, CID, aid, AVA);
    session = signIn();
  }

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  it('points: a blur that arrives after the step leaves the next student’s points alone', () => {
    open(QUIZ);
    const box = pointsBox();
    box.focus();
    expect(box.value).toBe('6');
    stepThenBlur(box);

    expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
    expect(getPointsScore(CID, AVA, QUIZ)).toBe(6);
    expect(sentFor(session)).toEqual([]);
  });

  it('points: an empty box does not erase the next student’s points', () => {
    open(QUIZ);
    const box = pointsBox();
    box.focus();
    box.value = '';
    stepThenBlur(box);

    expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
    // The emptied box was Ava's: hers are cleared, as leaving it does.
    expect(getPointsScore(CID, AVA, QUIZ)).toBeNull();
    expect(sentFor(session)).toEqual([AVA]);
  });

  it('points typed and not yet saved go to the student they were typed for', () => {
    open(QUIZ);
    const box = pointsBox();
    box.focus();
    box.value = '7';
    stepThenBlur(box);

    expect(getPointsScore(CID, AVA, QUIZ)).toBe(7);
    expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
    expect(sentFor(session)).toEqual([AVA]);
  });

  it('a competency’s comment goes to the student it was written for', () => {
    open(ESSAY);
    const note = at('[data-action-blur="graderTagNote"][data-tag="' + QUESTION + '"]');
    note.focus();
    note.value = 'For Ava';
    stepThenBlur(note);

    expect(getTagComment(CID, AVA, ESSAY, QUESTION)).toBe('For Ava');
    expect(getTagComment(CID, BEN, ESSAY, QUESTION)).toBe('');
  });

  it('a criterion’s comment (Work On) goes to the student it was written for', () => {
    open(CLAIM);
    const note = at('[data-action-blur="graderCritNote"][data-critid="' + STATES + '"]');
    note.focus();
    note.value = 'Add evidence';
    stepThenBlur(note);

    expect(entries(CID, AVA, CLAIM)[0].critNote).toBe('Add evidence');
    expect(entries(CID, BEN, CLAIM)).toEqual([]);
    expect(sentFor(session)).toEqual([AVA]);
  });

  it('Went Beyond goes to the student it was written for', () => {
    open(CLAIM);
    const note = at('[data-action-blur="graderCritBeyond"]');
    note.focus();
    note.value = 'Cited two sources';
    stepThenBlur(note);

    expect(entries(CID, AVA, CLAIM)[0].critBeyond).toBe('Cited two sources');
    expect(entries(CID, BEN, CLAIM)).toEqual([]);
    expect(sentFor(session)).toEqual([AVA]);
  });

  it('a step leaves the box in focus first, so what is typed is saved before the next student is drawn', () => {
    open(QUIZ);
    const box = pointsBox();
    box.focus();
    box.value = '7';
    // The page's own blur() is linkedom's, which reaches no listener: the helper's does.
    box.blur = () => leave(box);
    click(next());

    expect(onPage()).toContain('Ben');
    expect(getPointsScore(CID, AVA, QUIZ)).toBe(7);
    expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
    expect(pointsBox().value).toBe('8');
    expect(sentFor(session)).toEqual([AVA]);
  });

  it('on the Assignments page, a box drawn for a new student saves under their server id once the server gives it', () => {
    const doc = openAssignments(
      () => {
        seed();
        // Ava is new: her local id until the server answers.
        _cache.students[CID][0].id = 'cava1';
        _cache.scores[CID] = { cava1: [points('p-ava', 'cava1', 6)], [BEN]: [points('p-ben', BEN, 8)] };
      },
      CID,
      { student: 'cava1', open: QUIZ },
    );
    session = signIn();
    const box = doc.querySelector('#ac-' + QUIZ + ' .grdp-input');
    box.focus();
    box.value = '9';
    // The server's answer. data.js tells the page with a CustomEvent, made here as the test page makes one.
    const nodeEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = document.defaultView.CustomEvent;
    try {
      _rekey(CID, 'student', 'cava1', AVA);
    } finally {
      globalThis.CustomEvent = nodeEvent;
    }
    leave(box);

    expect(getPointsScore(CID, AVA, QUIZ)).toBe(9);
    expect(getScores(CID).cava1 || []).toEqual([]);
    expect(getPointsScore(CID, BEN, QUIZ)).toBe(8);
  });
});
