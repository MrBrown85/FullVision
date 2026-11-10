/**
 * GradeState.draftsIn (S1-F1, docs/plans/student-page-build-plan.md 1.4):
 * the students whose piece of work is a draft. A screen's To Return count
 * for a piece is the length of this list, and Return N Graded returns it,
 * so the gradebook, the graders and the phone count from one place.
 *
 * It is stateOf, the function the desktop grader dialog reads for its Draft
 * row, asked for each student; a DIBELS benchmark, which the dialog never
 * offers to return, has none.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'c-drafts-in';
const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'] };
const QUIZ = { id: 'quiz', title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };
const TALK = {
  id: 'talk',
  title: 'Talk',
  date: '2026-10-15',
  type: 'summative',
  tagIds: ['t1'],
  collaboration: 'pair',
  pairs: [['s1', 's2']],
};
const BENCH = { id: 'bench', title: 'Reading Benchmark', date: '2026-10-16', scoreMode: 'dibels', tagIds: [] };
const IDS = ['s1', 's2', 's3', 's4'];
const STUDENTS = IDS.map((id, i) => ({ id, firstName: ['Jordan', 'Avery', 'Noor', 'Lena'][i], lastName: 'Test' }));

const level = (sid, aid, value) => upsertScore(CID, sid, aid, 't1', value, '2026-10-10', 'summative', '', 0);
const drafts = (aid, ids = IDS) => GradeState.draftsIn(CID, aid, ids);

function seed(config) {
  localStorage.clear();
  clearClass(CID);
  seedClass(CID, {
    students: STUDENTS,
    assessments: [ESSAY, QUIZ, TALK, BENCH].map(a => structuredClone(a)),
    courseConfigs: config || {},
  });
}

beforeEach(() => seed({ student_page_enabled: true, return_grades: 'on_return' }));
afterEach(() => {
  clearClass(CID);
  localStorage.clear();
});

describe('GradeState.draftsIn', () => {
  it('lists the students with a draft, in the order asked, and no one else', () => {
    expect(drafts('essay')).toEqual([]);
    level('s3', 'essay', 3);
    level('s1', 'essay', 2);
    expect(drafts('essay')).toEqual(['s1', 's3']);
    expect(drafts('essay', ['s4', 's3', 's1'])).toEqual(['s3', 's1']);
    // Only the students asked about.
    expect(drafts('essay', ['s2', 's3'])).toEqual(['s3']);
    expect(drafts('essay', [])).toEqual([]);
    expect(drafts('essay', null)).toEqual([]);
    // Another piece of work has its own.
    expect(drafts('quiz')).toEqual([]);
  });

  it('agrees with stateOf, which the grader dialog reads, for every student and piece', () => {
    level('s1', 'essay', 3);
    setPointsScore(CID, 's2', 'quiz', 7);
    setPointsScore(CID, 's3', 'quiz', 0);
    level('s1', 'talk', 4);
    Grader.returnGrades(CID, 'quiz', ['s2']);
    ['essay', 'quiz', 'talk'].forEach(aid => {
      expect(drafts(aid), aid).toEqual(IDS.filter(sid => GradeState.stateOf(CID, sid, aid) === GradeState.DRAFT));
    });
    expect(drafts('quiz')).toEqual(['s3']);
    // Pair work: one save is a draft for both.
    expect(drafts('talk')).toEqual(['s1', 's2']);
  });

  it('a returned grade is not in it; changed since, it is again', () => {
    level('s1', 'essay', 3);
    Grader.returnGrades(CID, 'essay', drafts('essay'));
    expect(drafts('essay')).toEqual([]);
    level('s1', 'essay', 4);
    expect(drafts('essay')).toEqual(['s1']);
    // Put back to what was returned: nothing waits.
    level('s1', 'essay', 3);
    expect(drafts('essay')).toEqual([]);
  });

  it('Missing, Excused and Late alone are never drafts; Missing or Excused over a draft hides it', () => {
    applyAssignmentStatus(CID, 's1', 'essay', 'NS');
    applyAssignmentStatus(CID, 's2', 'essay', 'EXC');
    applyAssignmentStatus(CID, 's3', 'essay', 'LATE');
    expect(drafts('essay')).toEqual([]);
    // Late is only a label: a grade under it is a draft like any other.
    level('s3', 'essay', 3);
    expect(drafts('essay')).toEqual(['s3']);
    // Missing set over a draft's grade leaves no draft to show.
    level('s4', 'essay', 2);
    const statuses = getAssignmentStatuses(CID);
    statuses['s4:essay'] = 'NS';
    saveAssignmentStatuses(CID, statuses);
    expect(GradeState.stateOf(CID, 's4', 'essay')).toBe(null);
    expect(drafts('essay')).toEqual(['s3']);
  });

  it('a DIBELS benchmark has none, and neither does work that is not in the class', () => {
    saveScoreComment(CID, 's1', 'bench', 'Read with expression.');
    expect(drafts('bench')).toEqual([]);
    expect(drafts('no-such-work')).toEqual([]);
  });

  it('a class that returns each save at once has none', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    level('s1', 'essay', 3);
    expect(drafts('essay')).toEqual([]);
    seed({});
    level('s1', 'essay', 3);
    expect(drafts('essay')).toEqual([]);
  });
});
