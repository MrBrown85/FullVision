/**
 * GradeState.draftsWaiting(cid): how many grades in a class wait as drafts
 * (S1-F4). It counts what a screen shows as Draft (GradeState.stateOf), so
 * the number Class Settings names when a class leaves When I Return Them is
 * the number of Draft marks the teacher can find.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'c-waiting';
const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1'] };
const QUIZ = { id: 'quiz', title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };
const STUDENTS = ['s1', 's2', 's3'].map((id, i) => ({
  id,
  firstName: ['Jordan', 'Avery', 'Noor'][i],
  lastName: 'Test',
}));

function seed(config) {
  localStorage.clear();
  clearClass(CID);
  seedClass(CID, {
    students: STUDENTS,
    assessments: [ESSAY, QUIZ].map(a => structuredClone(a)),
    courseConfigs: config,
  });
}
const level = (sid, value) => Grader.setLevel(CID, sid, 'essay', 't1', value, 0);

describe('GradeState.draftsWaiting', () => {
  var originalUseSupabase;
  beforeEach(() => {
    originalUseSupabase = _useSupabase;
    _useSupabase = false;
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    return () => {
      _useSupabase = originalUseSupabase;
      clearClass(CID);
    };
  });

  it('is 0 in a class with no rows, and in a class nobody has heard of', () => {
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    expect(GradeState.draftsWaiting('no-such-class')).toBe(0);
    expect(GradeState.draftsWaiting(undefined)).toBe(0);
  });

  it('counts each grade that waits, across assessments, and drops one once it is returned', () => {
    level('s1', 3);
    level('s2', 2);
    Grader.setPoints(CID, 's1', 'quiz', 7);
    expect(GradeState.draftsWaiting(CID)).toBe(3);

    Grader.returnGrades(CID, 'essay', ['s1']);
    expect(GradeState.draftsWaiting(CID)).toBe(2);

    // A change to the returned grade waits again.
    level('s1', 4);
    expect(GradeState.draftsWaiting(CID)).toBe(3);
  });

  it('agrees with stateOf cell by cell', () => {
    level('s1', 3);
    level('s3', 1);
    Grader.setPoints(CID, 's2', 'quiz', 4);
    Grader.returnGrades(CID, 'essay', ['s3']);
    var marks = 0;
    ['essay', 'quiz'].forEach(aid =>
      STUDENTS.forEach(s => {
        if (GradeState.stateOf(CID, s.id, aid) === GradeState.DRAFT) marks++;
      }),
    );
    expect(marks).toBe(2);
    expect(GradeState.draftsWaiting(CID)).toBe(marks);
  });

  it('leaves out a draft under Missing or Excused: the screen shows the status, not Draft', () => {
    level('s1', 3);
    level('s2', 3);
    level('s3', 3);
    // A screen refuses Missing or Excused on scored work, but a class can
    // hold one (a status that arrived from another device): the whole list,
    // as a load saves it.
    saveAssignmentStatuses(CID, { 's1:essay': 'NS', 's2:essay': 'EXC' });
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBeNull();
    expect(GradeState.stateOf(CID, 's2', 'essay')).toBeNull();
    expect(getGradeReturn(CID, 's1', 'essay').is_draft).toBe(true);
    expect(GradeState.draftsWaiting(CID)).toBe(1);
    // Late is only a label.
    saveAssignmentStatuses(CID, { 's1:essay': 'NS', 's2:essay': 'EXC', 's3:essay': 'LATE' });
    expect(GradeState.draftsWaiting(CID)).toBe(1);
  });

  it('leaves out a row whose student or assessment is no longer in the class', () => {
    level('s1', 3);
    level('s2', 3);
    Grader.setPoints(CID, 's1', 'quiz', 7);
    expect(GradeState.draftsWaiting(CID)).toBe(3);
    // The rows stay; the class no longer lists the student or the piece.
    _cache.students[CID] = STUDENTS.filter(s => s.id !== 's2');
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    _cache.assessments[CID] = [structuredClone(ESSAY)];
    expect(GradeState.draftsWaiting(CID)).toBe(1);
    expect(getGradeReturn(CID, 's2', 'essay').is_draft).toBe(true);
  });

  it('is 0 where nothing is held: As Soon As I Save, or the switch off', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    level('s1', 3);
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    seed({});
    level('s1', 3);
    expect(GradeState.draftsWaiting(CID)).toBe(0);
  });
});
