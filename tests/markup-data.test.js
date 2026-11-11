/**
 * Mark Up on the client (S9): marks on a page of student work, in Demo
 * Mode (shared/data.js, "Mark Up"; shared/seed-data.js, seedDemoMarkup).
 *
 * The answers have the server's shapes (batch-c-contract.md, PR 1043, not
 * applied): save_markup, list_assessment_markup, return_work, and the
 * student's markup(...) and feedback(...).marks.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const JORDAN = 'st10';
const NOOR = 'st2';
const CECE = 'st1';
const JORDAN_P1 = 'demo-sub-st10-sci8a1-p1';
const NOOR_P2 = 'demo-sub-st2-sci8a1-p2';
const CECE_P1 = 'demo-sub-st1-sci8a1-p1';
let wasDemo;
let n = 0;
const key = () => 'k' + ++n;
const page = (...marks) => ({ v: 1, marks });
const note = text => ({ type: 'note', x: 0.5, y: 0.5, text });
const tick = { type: 'tick', x: 0.1, y: 0.1 };

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function holdGrades() {
  saveCourseConfig(
    CID,
    Object.assign({}, getCourseConfig(CID) || {}, { student_page_enabled: true, return_grades: 'on_return' }),
  );
}

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});

afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});

beforeEach(() => {
  seedDemo();
});

describe('the sample marks', () => {
  it('are on Jordan’s and Noor’s pages, in list_assessment_markup’s shape', () => {
    const rows = getAssessmentMarkup(CID, LAB);
    expect(rows.map(r => r.file_id).sort()).toEqual([JORDAN_P1, NOOR_P2].sort());
    rows.forEach(r => {
      expect(Object.keys(r).sort()).toEqual(
        ['enrollment_id', 'file_id', 'given', 'given_at', 'given_rev', 'marks', 'rev', 'saved_at', 'waiting'].sort(),
      );
      expect(r.rev).toBe(1);
      expect(r.given_rev).toBe(1);
      expect(r.waiting).toBe(false);
      expect(r.given).toEqual(r.marks);
    });
    expect(getPageMarkup(CID, JORDAN_P1).enrollment_id).toBe(JORDAN);
  });

  it('counts the notes the student sees: "3 notes on your work"', () => {
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).toEqual({ pages: 1, notes: 3 });
    expect(getStudentMarkCounts(CID, NOOR, LAB)).toEqual({ pages: 1, notes: 1 });
    expect(getStudentMarkCounts(CID, CECE, LAB)).toBeNull();
  });

  it('are seeded once: a page cleared by the teacher stays cleared', async () => {
    await saveMarkup(CID, JORDAN_P1, page(), 1, key());
    seedIfNeeded();
    seedDemoMarkup();
    expect(getPageMarkup(CID, JORDAN_P1).marks).toEqual(page());
  });

  it('every mark in the sample is one save_markup takes', () => {
    Object.keys(DEMO_MARKUP).forEach(id => expect(_markupValid(DEMO_MARKUP[id])).toBe(true));
  });
});

describe('a page’s two copies', () => {
  it('a handed-in page with no marks has rev 0 and nothing given; a page not handed in is null', () => {
    expect(getPageMarkup(CID, CECE_P1)).toEqual({
      file_id: CECE_P1,
      enrollment_id: CECE,
      rev: 0,
      marks: { v: 1, marks: [] },
      saved_at: null,
      given: null,
      given_rev: null,
      given_at: null,
      waiting: false,
    });
    expect(getPageMarkup(CID, 'demo-sub-st11-sci8a1-p1')).toBeNull();
  });

  it('marks are data over the photo: the stored page never changes', async () => {
    const before = JSON.stringify(getCourseSubmissions(CID));
    await saveMarkup(CID, CECE_P1, page(tick, note('Nice drawing.')), 0, key());
    holdGrades();
    await saveMarkup(CID, CECE_P1, page(tick), 1, key());
    returnWork(CID, LAB, [CECE]);
    expect(JSON.stringify(getCourseSubmissions(CID))).toBe(before);
  });
});

describe('saveMarkup', () => {
  it('saves the whole set for the page and counts each save', async () => {
    const one = await saveMarkup(CID, CECE_P1, page(tick), 0, key());
    expect(one).toEqual({ result: 'saved', file_id: CECE_P1, rev: 1, given: true });
    const two = await saveMarkup(CID, CECE_P1, page(note('Label it.')), 1, key());
    expect(two.rev).toBe(2);
    expect(getPageMarkup(CID, CECE_P1).marks).toEqual(page(note('Label it.')));
  });

  it('is idempotent: the same key again is the same answer and saves nothing more', async () => {
    const k = key();
    const first = await saveMarkup(CID, CECE_P1, page(tick), 0, k);
    const again = await saveMarkup(CID, CECE_P1, page(tick), 0, k);
    expect(again).toEqual(first);
    expect(getPageMarkup(CID, CECE_P1).rev).toBe(1);
  });

  it('answers changed, writing nothing, when another save came first', async () => {
    await saveMarkup(CID, CECE_P1, page(tick), 0, key());
    const stale = await saveMarkup(CID, CECE_P1, page(note('Mine.')), 0, key());
    expect(stale).toEqual({ result: 'changed', file_id: CECE_P1, rev: 1, marks: page(tick) });
    expect(getPageMarkup(CID, CECE_P1).marks).toEqual(page(tick));
    // null skips the check.
    expect((await saveMarkup(CID, CECE_P1, page(), null, key())).result).toBe('saved');
  });

  it('refuses marks of the wrong shape, and a save with no key', async () => {
    const bad = [
      null,
      { v: 2, marks: [] },
      { v: 1 },
      page({ type: 'eraser' }),
      page({ type: 'note', text: '' }),
      page({ type: 'note', text: 'x'.repeat(501) }),
      page({ type: 'note' }),
      page('pen'),
      page(...Array.from({ length: 501 }, () => tick)),
      page({ type: 'pen', points: 'x'.repeat(256 * 1024) }),
    ];
    for (const marks of bad) expect(await saveMarkup(CID, CECE_P1, marks, 0, key())).toEqual({ result: 'invalid' });
    expect(await saveMarkup(CID, CECE_P1, page(tick), 0)).toEqual({ result: 'invalid' });
    expect(await saveMarkup(CID, CECE_P1, page(tick), -1, key())).toEqual({ result: 'invalid' });
    expect(getPageMarkup(CID, CECE_P1).rev).toBe(0);
    // The limits themselves are allowed.
    expect((await saveMarkup(CID, CECE_P1, page(note('x'.repeat(500))), 0, key())).result).toBe('saved');
    expect((await saveMarkup(CID, CECE_P1, page(...Array.from({ length: 500 }, () => tick)), 1, key())).result).toBe(
      'saved',
    );
  });

  it('answers not_found for a page not handed in, and for deleted work', async () => {
    expect(await saveMarkup(CID, 'nope', page(tick), 0, key())).toEqual({ result: 'not_found' });
    await deleteStudentWork(CID, JORDAN, LAB);
    expect(await saveMarkup(CID, JORDAN_P1, page(tick), 1, key())).toEqual({ result: 'not_found' });
    expect(getAssessmentMarkup(CID, LAB).map(r => r.file_id)).toEqual([NOOR_P2]);
    expect(getStudentMarkup(CID, JORDAN, LAB)).toEqual({ ok: true, files: [] });
  });
});

describe('what the student is given', () => {
  it('in a class that does not hold grades: each save, at once', async () => {
    await saveMarkup(CID, CECE_P1, page(tick), 0, key());
    expect(getStudentMarkup(CID, CECE, LAB).files.map(f => f.marks)).toEqual([page(tick)]);
    expect(studentMarkupWaiting(CID, CECE, LAB)).toBe(false);
  });

  it('in a class that holds grades: nothing until Return, and a mark erased before Return never reaches the student', async () => {
    holdGrades();
    const drawn = await saveMarkup(CID, CECE_P1, page(tick, note('Wrong cell, sorry.')), 0, key());
    expect(drawn.given).toBe(false);
    expect(getStudentMarkup(CID, CECE, LAB)).toEqual({ ok: true, files: [] });
    expect(getStudentMarkCounts(CID, CECE, LAB)).toBeNull();
    expect(studentMarkupWaiting(CID, CECE, LAB)).toBe(true);
    // Erased before Return.
    await saveMarkup(CID, CECE_P1, page(tick), 1, key());
    const back = returnWork(CID, LAB, [CECE]);
    expect(back).toMatchObject({ marks_given: 1, marks_enrollment_ids: [CECE] });
    expect(getStudentMarkup(CID, CECE, LAB).files.map(f => f.marks)).toEqual([page(tick)]);
    expect(JSON.stringify(getPageMarkup(CID, CECE_P1).given)).not.toContain('Wrong cell');
    expect(studentMarkupWaiting(CID, CECE, LAB)).toBe(false);
  });

  it('in a class that holds grades: a change after Return waits, and the student keeps what was given', async () => {
    holdGrades();
    await saveMarkup(CID, JORDAN_P1, page(note('A new note.')), 1, key());
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).toEqual({ pages: 1, notes: 3 });
    expect(getPageMarkup(CID, JORDAN_P1).waiting).toBe(true);
    returnWork(CID, LAB, JORDAN);
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).toEqual({ pages: 1, notes: 1 });
  });

  it('returnWork gives only the students listed, and answers as returnGrades does too', async () => {
    holdGrades();
    await saveMarkup(CID, JORDAN_P1, page(tick), 1, key());
    await saveMarkup(CID, NOOR_P2, page(tick), 1, key());
    const out = returnWork(CID, LAB, [JORDAN, 'st99']);
    expect(Object.keys(out).sort()).toEqual(
      ['enrollment_ids', 'marks_enrollment_ids', 'marks_given', 'returned', 'returned_at'].sort(),
    );
    expect(out.marks_enrollment_ids).toEqual([JORDAN]);
    expect(getPageMarkup(CID, NOOR_P2).waiting).toBe(true);
    expect(returnWork(CID, LAB, [JORDAN]).marks_given).toBe(0);
  });

  it('nothing while Students See Your Mark Up is off, or Missing or Excused is on the piece', async () => {
    const work = getCourseSubmissions(CID);
    work.assessments = work.assessments.map(a =>
      a.id === LAB ? Object.assign({}, a, { students_see_markup: false }) : a,
    );
    saveDemoStudentWork(CID, work);
    expect(getStudentMarkup(CID, JORDAN, LAB)).toEqual({ ok: true, files: [] });
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).toBeNull();
    // The teacher still has them.
    expect(getPageMarkup(CID, JORDAN_P1).marks.marks).toHaveLength(5);
    work.assessments = work.assessments.map(a =>
      a.id === LAB ? Object.assign({}, a, { students_see_markup: true }) : a,
    );
    saveDemoStudentWork(CID, work);
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).not.toBeNull();
    ['NS', 'EXC'].forEach(status => {
      const all = getAssignmentStatuses(CID);
      all[JORDAN + ':' + LAB] = status;
      saveAssignmentStatuses(CID, all);
      expect(getStudentMarkup(CID, JORDAN, LAB)).toEqual({ ok: true, files: [] });
      expect(getStudentMarkCounts(CID, JORDAN, LAB)).toBeNull();
    });
  });

  it('a piece not in the class is not_found', () => {
    expect(getStudentMarkup(CID, JORDAN, 'nope')).toEqual({ ok: false, error: 'not_found' });
  });

  it('a student is given only their own pages', () => {
    expect(getStudentMarkup(CID, NOOR, LAB).files.map(f => f.file_id)).toEqual([NOOR_P2]);
  });
});

describe('signed in: nothing yet', () => {
  it('reads nothing, answers not_available, stores nothing and calls nothing', async () => {
    window.isDemoMode = () => false;
    const rpc = vi.fn();
    globalThis.getSupabase = rpc;
    const before = localStorage.getItem('gb-student-feedback-' + CID);
    expect(await saveMarkup(CID, JORDAN_P1, page(tick), 1, key())).toEqual({ result: 'not_available' });
    expect(getPageMarkup(CID, JORDAN_P1)).toBeNull();
    expect(getAssessmentMarkup(CID, LAB)).toEqual([]);
    expect(getStudentMarkup(CID, JORDAN, LAB)).toEqual({ ok: true, files: [] });
    expect(getStudentMarkCounts(CID, JORDAN, LAB)).toBeNull();
    expect(returnWork(CID, LAB, [JORDAN])).toMatchObject({ marks_given: 0, marks_enrollment_ids: [] });
    expect(saveDemoMarkup(CID, { [JORDAN_P1]: page(tick) })).toBe(false);
    expect(localStorage.getItem('gb-student-feedback-' + CID)).toBe(before);
    expect(rpc).not.toHaveBeenCalled();
    delete globalThis.getSupabase;
  });

  it('data.js names none of the Mark Up functions the server will have', () => {
    const src = readFileSync('shared/data.js', 'utf-8');
    expect(src).not.toMatch(/['"`](save_markup|list_assessment_markup|return_work)['"`]/);
  });
});

describe('the class’s marks go with the class', () => {
  it('deleting the class’s local state removes them', () => {
    expect(localStorage.getItem('gb-student-feedback-' + CID)).not.toBeNull();
    _clearCourseLocalState(CID);
    expect(localStorage.getItem('gb-student-feedback-' + CID)).toBeNull();
  });
});
