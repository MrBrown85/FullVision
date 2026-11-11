/**
 * The grader's Return area, one part both layouts fill (S11-T1,
 * docs/plans/student-page-build-plan.md S11).
 *
 * GraderWork.returnArea (shared/grader.js) says what the place beside
 * Return shows for one student's piece; the desktop grader's row
 * (teacher/page-assignments.js) and the phone's bar (teacher-mobile/
 * tab-grade.js) each draw it. The move changed nothing either draws:
 * tests/grader-dialog-return.test.js and tests/phone-return.test.js hold
 * their HTML to the byte, and tests/markup-desktop.test.js holds "Marks
 * saved. Not returned yet.". This file holds the part's own answers in
 * every state a piece can be in.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const ESSAY = U(31);
const BENCH = U(32);
const QUESTION = U(41);
let wasDemo;

function seed(courseConfigs) {
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
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10' },
      { id: BENCH, title: 'Fall Benchmark', scoreMode: 'dibels', date: '2026-10-10' },
    ],
    courseConfigs,
  });
}
const piece = aid => getAssessments(CID).find(a => a.id === aid);
const area = (sid = AVA, aid = ESSAY, opts) => GraderWork.returnArea(CID, piece(aid), sid, [sid], opts);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T18:00:00.000Z'));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('GraderWork.returnArea', () => {
  it('nothing with the build switch off, on a DIBELS benchmark, or As Soon As I Save with nothing waiting', () => {
    seed({});
    expect(area()).toBeNull();
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
    expect(area()).toBeNull();
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    expect(area(AVA, BENCH)).toBeNull();
  });

  it('empty, then a draft, then returned, then a draft over the returned grade', () => {
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    expect(area()).toEqual({ kind: 'empty' });
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
    expect(area()).toEqual({ kind: 'draft', given: null });
    Grader.returnGrades(CID, ESSAY, [AVA]);
    expect(area()).toEqual({ kind: 'returned', returnedAt: '2026-11-03T18:00:00.000Z' });
    vi.setSystemTime(new Date('2026-11-04T18:00:00.000Z'));
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 4);
    expect(area()).toEqual({ kind: 'draft', given: { returnedAt: '2026-11-03T18:00:00.000Z' } });
  });

  it('a status with nothing in shows nothing; a status is never a draft', () => {
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    Grader.setStatus(CID, BEN, ESSAY, 'NS');
    expect(area(BEN)).toBeNull();
    Grader.setStatus(CID, BEN, ESSAY, 'LATE');
    expect(area(BEN)).toBeNull();
  });

  it('marks waiting on a returned grade only when the layout asks (the desktop)', () => {
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
    Grader.returnGrades(CID, ESSAY, [AVA]);
    const was = window.studentMarkupWaiting;
    window.studentMarkupWaiting = (cid, sid, aid) => cid === CID && sid === AVA && aid === ESSAY;
    try {
      expect(area(AVA, ESSAY, { marks: true })).toEqual({ kind: 'marks' });
      expect(area(AVA, ESSAY).kind).toBe('returned');
    } finally {
      window.studentMarkupWaiting = was;
    }
  });
});
