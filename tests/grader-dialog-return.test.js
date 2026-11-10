/**
 * The desktop grader dialog's Draft row (S0-F2,
 * docs/plans/student-page-build-plan.md S0 and S1-F5).
 *
 * 1. With the build switch off the dialog's HTML is byte for byte what it
 *    was before this change. tests/fixtures/grader-dialog-switch-off.json
 *    holds the dialog as main drew it (commit 66d93c95, before S0-F2) for
 *    every kind of work, ungraded, graded, and after a level, a status and a
 *    step to the next student. It was written by this file's own walk run
 *    over main's shared/data.js, shared/grade-state.js, shared/grader.js
 *    and teacher/page-assignments.js:
 *      UPDATE_GRADER_SNAPSHOT=1 npx vitest run tests/grader-dialog-return.test.js
 *    Run that only on code from before a change the dialog is meant to
 *    keep out; never to make a failing comparison pass.
 * 2. With the switch on and When I Return Them: the Draft mark and "Saved.
 *    Not returned yet." after a save, Return, "Returned" with its date, and
 *    the one line about what the student still sees when a returned grade
 *    is changed. A status alone shows no draft.
 *
 * The dialog is opened over the gradebook on a linkedom document, as
 * tests/pin-grader-dialog-writes.test.js opens it.
 */
import './setup.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  typeAndLeave,
  openGrader,
  closePages,
} from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'grader-dialog-switch-off.json');
const UPDATE = process.env.UPDATE_GRADER_SNAPSHOT === '1';

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
const GOGGLES = U(74);
const CLAIM_RUBRIC = U(81);
const STATES = U(82);
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

// Ava has a grade on every piece; Ben has none.
const GRADED = {
  [AVA]: [
    entry(AVA, ESSAY, QUESTION, 3, { note: 'Careful work.', critNote: 'Ask a second question' }),
    entry(AVA, ESSAY, PLAN, 2, { mod: 1, note: 'Careful work.' }),
    entry(AVA, QUIZ, QUESTION, 7),
    entry(AVA, LAB, SAFETY, 3, { mod: -1, critNote: 'Goggles every time' }),
    entry(AVA, LAB, METHOD, 4),
    entry(AVA, EXIT, QUESTION, 1),
    entry(AVA, JOURNAL, 'overall', 3),
    entry(AVA, CLAIM, STATES, 3, { critNote: 'Say why', critBeyond: 'Two reasons' }),
    entry(AVA, TALK, QUESTION, 3),
  ],
  [BEN]: [entry(BEN, TALK, QUESTION, 3)],
};

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
              checks: [{ id: GOGGLES, level: 3, label: 'Goggles on' }],
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
      scores: GRADED,
      rubricChecks: { [AVA + ':' + LAB]: [GOGGLES] },
      ...more,
    });
}

const at = selector => document.querySelector('#grader-overlay ' + selector);
const tagLevel = (tag, n) => at('[data-action="graderTagLevel"][data-tag="' + tag + '"][data-level="' + n + '"]');
const critLevel = (criterion, n) =>
  at('[data-action="graderLevel"][data-critid="' + criterion + '"][data-level="' + n + '"]');
const statusButton = which => at('[data-action="toggleStudentStatus"][data-status="' + which + '"]');
const pointsBox = () => at('.grdp-input');
const html = () => document.getElementById('grader-overlay').outerHTML;
// The dialog brings its chrome up to date a moment after each event.
const settled = () => new Promise(r => setTimeout(r, 10));

const KINDS = { ESSAY, QUIZ, LAB, EXIT, JOURNAL, CLAIM, TALK };

/* The walk the snapshot records: every kind of work open on a graded
   student and an ungraded one, then a few things a teacher does. Returns
   { name: html }. */
async function walk(config) {
  const out = {};
  const open = (aid, sid) => openGrader(seedWith({ courseConfigs: config || {} }), CID, aid, sid);
  for (const kind of Object.keys(KINDS)) {
    for (const [who, sid] of [
      ['Ava, graded', AVA],
      ['Ben, not graded', BEN],
    ]) {
      open(KINDS[kind], sid);
      await settled();
      out[kind + ' › ' + who] = html();
      closePages();
      clearClass(CID);
    }
  }
  // A level, a status, another level, and a step to the next student.
  open(ESSAY, BEN);
  click(tagLevel(QUESTION, 3));
  await settled();
  out['ESSAY › Ben, after a level'] = html();
  click(statusButton('LATE'));
  await settled();
  out['ESSAY › Ben, after Late'] = html();
  click(at('[data-grader="prev"]'));
  await settled();
  out['ESSAY › after a step back to Ava'] = html();
  closePages();
  clearClass(CID);
  // Points typed, a rubric level, Missing.
  open(QUIZ, BEN);
  typeAndLeave(pointsBox(), '8');
  await settled();
  out['QUIZ › Ben, after points'] = html();
  closePages();
  clearClass(CID);
  open(LAB, BEN);
  click(critLevel(SAFETY, 2));
  await settled();
  out['LAB › Ben, after a level'] = html();
  closePages();
  clearClass(CID);
  open(LAB, BEN);
  click(statusButton('NS'));
  await settled();
  out['LAB › Ben, after Missing'] = html();
  closePages();
  clearClass(CID);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  // A test that closed its pages has no document left to take a toast off.
  const page = window.PageAssignments;
  if (typeof dismissUndoToast === 'function' && page && page.graderOpen && page.graderOpen()) dismissUndoToast();
  closePages();
  clearClass(CID);
  localStorage.clear();
});

describe('with the build switch off the dialog is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', async () => {
      writeFileSync(SNAPSHOT, JSON.stringify(await walk(), null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};

  it('the snapshot covers every kind of work', () => {
    expect(Object.keys(before).length).toBe(Object.keys(KINDS).length * 2 + 6);
    Object.keys(before).forEach(name => expect(before[name].length, name).toBeGreaterThan(1500));
  });

  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    ['a class whose student page was turned off again', { student_page_enabled: false, return_grades: 'on_return' }],
  ])('byte for byte, in %s', async (_, config) => {
    const now = await walk(config);
    expect(Object.keys(now)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
    expect(Object.keys(localStorage._store).filter(k => k.indexOf('grade-returns') >= 0)).toEqual([]);
  });

  it('byte for byte for a signed-in teacher, even with both settings on this device', async () => {
    const session = signIn();
    try {
      const now = await walk({ student_page_enabled: true, return_grades: 'on_return' });
      Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
    } finally {
      session.signOut();
    }
  });

  it('has no draft row and no Return button', async () => {
    openGrader(seedWith(), CID, ESSAY, BEN);
    click(tagLevel(QUESTION, 3));
    await settled();
    expect(at('.grader-return')).toBe(null);
    expect(at('[data-grader="return"]')).toBe(null);
    expect(html()).not.toMatch(/Draft|Not returned yet|still sees/);
  });
});

describe.skipIf(UPDATE)('with the build switch on and When I Return Them', () => {
  const HELD = { student_page_enabled: true, return_grades: 'on_return' };
  const open = (aid, sid, more) => openGrader(seedWith({ courseConfigs: HELD, ...more }), CID, aid, sid);
  const row = () => at('.grader-return');
  const text = selector => (at(selector) ? at(selector).textContent : null);
  const today = () => formatShortDate('2026-11-09T18:00:00.000Z');

  it('a save shows the Draft mark, "Saved. Not returned yet." and Return, under the Note for the Report', async () => {
    open(ESSAY, BEN);
    await settled();
    // Nothing to return yet.
    expect(at('[data-grader="return"]').disabled).toBe(true);
    expect(at('.grader-draft')).toBe(null);
    click(tagLevel(QUESTION, 3));
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
    expect(text('.grader-draft-text')).toBe('Saved. Not returned yet.');
    expect(text('[data-grader="return"]')).toBe('Return');
    expect(at('[data-grader="return"]').disabled).toBe(false);
    expect(at('.grader-draft-still')).toBe(null);
    expect(row().previousElementSibling.className).toBe('grader-report-note');
    expect(row().parentNode.className).toBe('grader-scroll');
  });

  it('Return makes it Returned, with the date; a change after that says what the student still sees', async () => {
    open(ESSAY, BEN);
    click(tagLevel(QUESTION, 3));
    await settled();
    click(at('[data-grader="return"]'));
    await settled();
    expect(GradeState.stateOf(CID, BEN, ESSAY)).toBe('returned');
    expect(text('.grader-returned')).toBe('Returned ' + today());
    expect(today()).toMatch(/^Nov\.? 9$/);
    expect(at('[data-grader="return"]')).toBe(null);
    expect(at('.grader-draft')).toBe(null);

    vi.setSystemTime(new Date('2026-11-12T18:00:00.000Z'));
    click(tagLevel(QUESTION, 4));
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
    expect(text('.grader-draft-text')).toBe('Saved. Not returned yet.');
    expect(text('.grader-draft-still')).toBe('Ben still sees the grade you returned ' + today() + '.');
    // Put back to what was returned: not a draft.
    click(tagLevel(QUESTION, 3));
    await settled();
    expect(at('.grader-draft')).toBe(null);
    expect(text('.grader-returned')).toBe('Returned ' + today());
  });

  it('a grade from before the switch came on is Returned with no date, and a change to it waits', async () => {
    open(ESSAY, AVA);
    await settled();
    expect(text('.grader-returned')).toBe('Returned');
    click(tagLevel(QUESTION, 4));
    await settled();
    expect(text('.grader-draft-still')).toBe('Ava still sees the grade you returned.');
  });

  it('the name goes into the page as text', async () => {
    open(ESSAY, AVA, {
      students: [
        { id: AVA, firstName: '<b>Ava</b>', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      ],
    });
    click(tagLevel(QUESTION, 4));
    await settled();
    expect(row().innerHTML).toContain('&lt;b&gt;Ava&lt;/b&gt; still sees');
    expect(row().querySelector('b')).toBe(null);
  });

  it('points, a rubric level and a comment each show the draft', async () => {
    open(QUIZ, BEN);
    typeAndLeave(pointsBox(), '8');
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
    closePages();
    clearClass(CID);
    open(LAB, BEN);
    click(critLevel(SAFETY, 2));
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
    closePages();
    clearClass(CID);
    open(ESSAY, BEN);
    typeAndLeave(at('[data-action-blur="rsgOverallComment"]'), 'See me.');
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
  });

  it.each(['NS', 'EXC', 'LATE'])('a status alone (%s) shows no draft', async status => {
    open(ESSAY, BEN);
    click(statusButton(status));
    await settled();
    expect(getAssignmentStatus(CID, BEN, ESSAY)).toBe(status);
    expect(at('.grader-draft')).toBe(null);
    expect(html()).not.toMatch(/Not returned yet/);
    expect(at('[data-grader="return"]').disabled).toBe(true);
  });

  it('Late on a draft: the grade still waits', async () => {
    open(ESSAY, BEN);
    click(tagLevel(QUESTION, 3));
    click(statusButton('LATE'));
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
  });

  it('pair work is returned to both, and the line names the pair', async () => {
    open(TALK, AVA);
    click(tagLevel(QUESTION, 4));
    await settled();
    expect([GradeState.stateOf(CID, AVA, TALK), GradeState.stateOf(CID, BEN, TALK)]).toEqual(['draft', 'draft']);
    expect(text('.grader-draft-still')).toBe('Pair 1 still sees the grade you returned.');
    click(at('[data-grader="return"]'));
    await settled();
    expect([GradeState.stateOf(CID, AVA, TALK), GradeState.stateOf(CID, BEN, TALK)]).toEqual(['returned', 'returned']);
    expect(text('.grader-returned')).toBe('Returned ' + today());
  });

  it('the row follows the student shown', async () => {
    open(ESSAY, BEN);
    click(tagLevel(QUESTION, 3));
    await settled();
    expect(text('.grader-draft-mark')).toBe('Draft');
    click(at('[data-grader="prev"]'));
    await settled();
    expect(at('.grader-student').textContent).toContain('Ava');
    expect(at('.grader-draft')).toBe(null);
    expect(text('.grader-returned')).toBe('Returned');
  });

  it('As Soon As I Save: every save is returned at once, and there is no row', async () => {
    openGrader(seedWith({ courseConfigs: { student_page_enabled: true, return_grades: 'on_save' } }), CID, ESSAY, BEN);
    click(tagLevel(QUESTION, 3));
    await settled();
    expect(GradeState.stateOf(CID, BEN, ESSAY)).toBe('returned');
    expect(row()).toBe(null);
  });
});
