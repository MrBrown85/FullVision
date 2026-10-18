/**
 * Editing a rubric that already carries scores (teacher/rubric-guard.js).
 * Removing a scored criterion drops its scores, so the editor asks first;
 * changing a scored criterion's top value changes what past scores are
 * worth, so the editor says so.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const C = 'cls-sci8';

function rubric() {
  return {
    id: 'rub1',
    name: 'Lab rubric',
    criteria: [
      { id: 'cr1', name: 'Scientific inquiry', tagIds: ['t1', 't2'], levelValues: null },
      { id: 'cr2', name: 'Communication', tagIds: [], levelValues: null },
      { id: 'cr3', name: 'Neatness', tagIds: ['t3'], levelValues: null },
    ],
  };
}

describe('rubric edit guard', () => {
  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    _cache.assessments[C] = [
      { id: 'a1', name: 'Lab 1', rubricId: 'rub1' },
      { id: 'a2', name: 'Quiz', tagIds: ['t1'] },
    ];
    _cache.scores[C] = {
      st1: [
        { assessmentId: 'a1', tagId: 't1', score: 3 },
        { assessmentId: 'a1', tagId: 't2', score: 3 },
        { assessmentId: 'a1', tagId: 'cr2', score: 2 },
      ],
      st2: [
        { assessmentId: 'a1', tagId: 't1', score: 4 },
        // A quiz score on the same competency is not a rubric score.
        { assessmentId: 'a2', tagId: 't3', score: 2 },
      ],
      st3: [{ assessmentId: 'a2', tagId: 't1', score: 1 }],
    };
  });

  it('counts a student once per criterion, only on assessments that use the rubric', () => {
    const counts = RubricGuard.scoredStudentsByCriterion(C, rubric());
    expect(counts).toEqual({ cr1: 2, cr2: 1, cr3: 0 });
  });

  it('reports removed and re-valued criteria that have scores, and ignores the rest', () => {
    const before = rubric();
    const counts = RubricGuard.scoredStudentsByCriterion(C, before);
    const after = rubric();
    after.criteria.splice(1, 1); // Communication removed (scored)
    after.criteria.splice(1, 1); // Neatness removed (unscored)
    after.criteria[0].levelValues = { 4: 10 }; // inquiry now out of 10
    const review = RubricGuard.reviewEdit(before, after, counts);
    expect(review.removed).toEqual([{ id: 'cr2', name: 'Communication', students: 1 }]);
    expect(review.topChanged).toEqual([{ id: 'cr1', name: 'Scientific inquiry', from: 4, to: 10, students: 2 }]);
  });

  it('is quiet when nothing scored changed', () => {
    const before = rubric();
    const after = rubric();
    after.criteria[2].levelValues = { 4: 8 }; // Neatness has no scores
    after.criteria[0].levelValues = { 2: 2.5 }; // not the top value
    const review = RubricGuard.reviewEdit(before, after, RubricGuard.scoredStudentsByCriterion(C, before));
    expect(review).toEqual({ removed: [], topChanged: [] });
    expect(RubricGuard.topChangeNote(review)).toBe('');
  });

  it('words the question and the note plainly', () => {
    expect(RubricGuard.removeMessage({ name: 'Communication' }, 1)).toBe(
      '"Communication" has scores from 1 student. Removing it drops those scores from every assessment that uses this rubric.',
    );
    const note = RubricGuard.topChangeNote({
      topChanged: [{ id: 'cr1', name: 'Scientific inquiry', from: 4, to: 10, students: 2 }],
    });
    expect(note).toContain('"Scientific inquiry" (4 to 10 points)');
    expect(note).toContain('Past scores keep their level');
  });

  it('reads the top value from level overrides', () => {
    expect(RubricGuard.topValue({ levelValues: null })).toBe(4);
    expect(RubricGuard.topValue({ levelValues: { 4: 6 } })).toBe(6);
    expect(RubricGuard.topValue({ levelValues: { 1: 7 } })).toBe(7);
  });
});
