/**
 * Reporting periods (docs/DECISIONS.md, "Reporting periods"). While a class
 * is viewed in one reporting term, every grade counts only the assessments
 * whose assigned date falls inside it. All time, the default, is unchanged.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-terms';
const SID = 'stu-1';
const TAG = 'tag-1';
const SEC = 'sec-1';

const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-12-01', ends_on: '2027-03-15' },
];

function points(id, max, date, categoryId) {
  return { id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [TAG], categoryId, type: 'summative', date };
}
function level(id, date) {
  return { id, title: id, tagIds: [TAG], type: 'summative', date };
}
function score(assessmentId, value, date) {
  return { assessmentId, tagId: TAG, score: value, date };
}

function seed({ categories, assessments, scores, config }) {
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'both', calcMethod: 'average', gradeLevel: '8' } });
  _cache.categories[CID] = categories || [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = Object.assign({ reportingTerms: TERMS, calcMethod: 'average' }, config || {});
  _cache.learningMaps[CID] = {
    sections: [
      { id: SEC, name: 'Questioning', subject: 'Science', tags: [{ id: TAG, code: 'Q', name: 'Questioning' }] },
    ],
  };
  clearProfCache();
}

describe('reporting terms scope the grade math', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveTerm(CID, null);
  });
  afterEach(() => setActiveTerm(CID, null));

  it('course % counts only the assessments dated inside the active term', () => {
    seed({
      assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
      scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
    });
    expect(getCourseLetterData(CID, SID).R).toBe(75); // 15/20 all time

    setActiveTerm(CID, 1);
    expect(getCourseLetterData(CID, SID).R).toBe(50); // 5/10
    setActiveTerm(CID, 2);
    expect(getCourseLetterData(CID, SID).R).toBe(100); // 10/10

    setActiveTerm(CID, null);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });

  it('proficiency roll-ups use only in-term scores', () => {
    seed({
      assessments: [level('a1', '2026-10-05'), level('a2', '2027-02-01')],
      scores: [score('a1', 2, '2026-10-05'), score('a2', 4, '2027-02-01')],
    });
    expect(getOverallProficiency(CID, SID)).toBe(3); // mean of 2 and 4
    setActiveTerm(CID, 1);
    expect(getOverallProficiency(CID, SID)).toBe(2);
    expect(getSectionProficiency(CID, SID, SEC)).toBe(2);
    expect(getTagScores(CID, SID, TAG)).toHaveLength(1);
    setActiveTerm(CID, 2);
    expect(getOverallProficiency(CID, SID)).toBe(4);
  });

  it('an undated assessment is left out of a term and counted in all time', () => {
    seed({
      assessments: [points('dated', 10, '2026-10-01'), points('undated', 10, undefined)],
      scores: [score('dated', 10, '2026-10-01'), score('undated', 0, '2026-10-01')],
    });
    expect(getCourseLetterData(CID, SID).R).toBe(50);
    expect(undatedAssessmentCount(CID)).toBe(0);
    setActiveTerm(CID, 1);
    expect(getCourseLetterData(CID, SID).R).toBe(100);
    expect(undatedAssessmentCount(CID)).toBe(1);
    expect(assessmentInActiveTerm(CID, { id: 'x' })).toBe(false);
  });

  it('a competency override still wins inside a term with evidence', () => {
    seed({
      assessments: [level('a1', '2026-10-05'), level('a2', '2027-01-20')],
      scores: [score('a1', 1, '2026-10-05'), score('a2', 2, '2027-01-20')],
    });
    setSectionOverride(CID, SID, SEC, 4, 'Showed it in conversation');
    expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
    setActiveTerm(CID, 1);
    expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
    setActiveTerm(CID, 2);
    expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
    expect(getSectionProficiencyRaw(CID, SID, SEC)).toBe(2);
  });

  it('cached results are kept per term', () => {
    seed({
      assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
      scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
    });
    setActiveTerm(CID, 1);
    getCourseLetterData(CID, SID);
    setActiveTerm(CID, 2);
    getCourseLetterData(CID, SID);
    setActiveTerm(CID, 1);
    expect(getCourseLetterData(CID, SID).R).toBe(50);
    setActiveTerm(CID, null);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });

  it('an unknown ordinal, "all" or null means all time', () => {
    seed({ assessments: [points('t1', 10, '2026-10-01')], scores: [score('t1', 5, '2026-10-01')] });
    expect(setActiveTerm(CID, 9)).toBeNull();
    expect(getActiveTerm(CID)).toBeNull();
    expect(setActiveTerm(CID, 'all')).toBeNull();
    expect(setActiveTerm(CID, 2)).toMatchObject({ ordinal: 2, label: 'Term 2' });
    expect(getActiveTerm(CID).startsOn).toBe('2026-12-01');
  });

  it('the saved choice on this device is applied by activateSavedTerm', () => {
    seed({ assessments: [points('t1', 10, '2026-10-01')], scores: [score('t1', 5, '2026-10-01')] });
    expect(getSelectedTermOrdinal(CID)).toBeNull();
    setSelectedTermOrdinal(CID, 2);
    expect(getSelectedTermOrdinal(CID)).toBe(2);
    expect(getActiveTerm(CID).ordinal).toBe(2);
    setActiveTerm(CID, null);
    expect(activateSavedTerm(CID).ordinal).toBe(2);
    setSelectedTermOrdinal(CID, null);
    expect(activateSavedTerm(CID)).toBeNull();
    // A saved ordinal the class no longer has is ignored.
    localStorage.setItem('gb-term-' + CID, '6');
    expect(getSelectedTermOrdinal(CID)).toBeNull();
  });
});
