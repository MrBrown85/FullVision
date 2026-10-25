/**
 * Work in a 0% category counts toward nothing: not the course % and not
 * competency proficiency. A Humanities 8 student with five Developing scores
 * on the summative showed Proficient because her Complete marks in the 0%
 * Formative category counted as Extending on the same and other competencies.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-zero-cat';
const SID = 'stu-1';
const SHARED = 'tag-shared';
const FORM_ONLY = 'tag-form-only';

function seed(formativeWeight) {
  saveCourses({ [CID]: { id: CID, name: 'Humanities 8', calcMethod: 'average', gradingSystem: 'proficiency' } });
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.categories[CID] = [
    { id: 'cat-sum', name: 'Summative Assessment', weight: 100 },
    { id: 'cat-form', name: 'Formative Assessment', weight: formativeWeight },
  ];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec-shared', name: 'Writing', tags: [{ id: SHARED, label: 'Writing' }] },
      { id: 'sec-form', name: 'Ethics', tags: [{ id: FORM_ONLY, label: 'Ethics' }] },
    ],
    _customized: true,
    _version: 1,
  };
  _cache.assessments[CID] = [
    { id: 'sum', title: 'Third Draft', categoryId: 'cat-sum', tagIds: [SHARED], date: '2026-10-20' },
    {
      id: 'goals',
      title: 'Goals',
      categoryId: 'cat-form',
      scoreMode: 'complete',
      maxPoints: 1,
      tagIds: [SHARED],
      date: '2026-09-14',
    },
    {
      id: 'intro',
      title: 'Getting To Know You',
      categoryId: 'cat-form',
      scoreMode: 'complete',
      maxPoints: 1,
      tagIds: [FORM_ONLY],
      date: '2026-09-11',
    },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'sum', tagId: SHARED, score: 2, date: '2026-10-20' },
      { assessmentId: 'goals', tagId: SHARED, score: 1, date: '2026-09-14' },
      { assessmentId: 'intro', tagId: FORM_ONLY, score: 1, date: '2026-09-11' },
    ],
  };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('0% category work in competency proficiency', () => {
  beforeEach(() => localStorage.clear());

  it('leaves 0% work out of a competency the summative also scores', () => {
    seed(0);
    expect(getTagProficiency(CID, SID, SHARED)).toBe(2);
  });

  it('leaves a competency scored only by 0% work without a level', () => {
    seed(0);
    expect(getTagProficiency(CID, SID, FORM_ONLY)).toBe(0);
  });

  it('keeps the overall grade at Developing', () => {
    seed(0);
    expect(getOverallProficiency(CID, SID)).toBe(2);
  });

  it('still lists the 0% work as evidence', () => {
    seed(0);
    expect(getTagScores(CID, SID, SHARED)).toHaveLength(2);
    expect(getCountedTagScores(CID, SID, SHARED)).toHaveLength(1);
  });

  it('counts the work once its category has a weight', () => {
    seed(10);
    // A Complete is 1/1, Extending; averaged with the summative's 2.
    expect(getTagProficiency(CID, SID, SHARED)).toBe(3);
    expect(getTagProficiency(CID, SID, FORM_ONLY)).toBe(4);
  });
});
