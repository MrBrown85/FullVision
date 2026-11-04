/**
 * Reporting periods (docs/DECISIONS.md, "Reporting periods" 2; Colin,
 * 2026-11-03). Teachers grade cumulatively: a report's grade is the year to
 * date as of its term's end date. While a term is active (the Reports page),
 * every grade counts every assessment dated on or before that term's end, and
 * undated work; work dated after it doesn't count. With no term active (the
 * year so far) nothing changes.
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

describe("a report reads the year to date as of its term's end", () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveTerm(CID, null);
  });
  afterEach(() => setActiveTerm(CID, null));

  // Colin's example from the term-scoping audit: Mean, one competency, a 2
  // in October and a 4 in December.
  it('Mean: a 2 in October and a 4 in December are 2.0 on Report 1, 3.0 on Report 2 and 3.0 in the gradebook', () => {
    seed({
      assessments: [level('oct', '2026-10-15'), level('dec', '2026-12-10')],
      scores: [score('oct', 2, '2026-10-15'), score('dec', 4, '2026-12-10')],
    });
    expect(getSectionProficiency(CID, SID, SEC)).toBe(3); // the gradebook: the year so far
    expect(getOverallProficiency(CID, SID)).toBe(3);
    setActiveTerm(CID, 1);
    expect(getSectionProficiency(CID, SID, SEC)).toBe(2); // Sep 1 – Nov 30
    expect(getCourseLetterData(CID, SID).R).toBe(50);
    setActiveTerm(CID, 2);
    expect(getSectionProficiency(CID, SID, SEC)).toBe(3); // Sep 1 – Mar 15, not only Term 2's 4
    expect(getOverallProficiency(CID, SID)).toBe(3);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });

  it("course % counts every assessment up to the report's end", () => {
    seed({
      assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
      scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
    });
    expect(getCourseLetterData(CID, SID).R).toBe(75); // 15/20 the year so far

    setActiveTerm(CID, 1);
    expect(getCourseLetterData(CID, SID).R).toBe(50); // 5/10 to Nov 30
    setActiveTerm(CID, 2);
    expect(getCourseLetterData(CID, SID).R).toBe(75); // 15/20 to Mar 15

    setActiveTerm(CID, null);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });

  it("work dated after the report's end does not count for that report", () => {
    seed({
      assessments: [level('a1', '2026-10-05'), level('a2', '2027-04-01')],
      scores: [score('a1', 2, '2026-10-05'), score('a2', 4, '2027-04-01')],
    });
    setActiveTerm(CID, 2);
    expect(getOverallProficiency(CID, SID)).toBe(2);
    expect(getTagScores(CID, SID, TAG)).toHaveLength(1);
    expect(assessmentInYearToDate(CID, { id: 'x', date: '2027-03-15' })).toBe(true);
    expect(assessmentInYearToDate(CID, { id: 'x', date: '2027-03-16' })).toBe(false);
  });

  it("a student with nothing yet in this term keeps the year's grade", () => {
    seed({
      assessments: [level('a1', '2026-10-05')],
      scores: [score('a1', 3, '2026-10-05')],
    });
    setActiveTerm(CID, 2);
    expect(getOverallProficiency(CID, SID)).toBe(3);
  });

  it('undated work counts in every report and in the year so far', () => {
    seed({
      assessments: [points('dated', 10, '2026-10-01'), points('undated', 10, undefined)],
      scores: [score('dated', 10, '2026-10-01'), score('undated', 0, '2026-10-01')],
    });
    expect(getCourseLetterData(CID, SID).R).toBe(50);
    setActiveTerm(CID, 1);
    expect(getCourseLetterData(CID, SID).R).toBe(50);
    expect(assessmentInYearToDate(CID, { id: 'x' })).toBe(true);
    // The term's own window, for what describes this term only, has no undated work.
    expect(assessmentInTermWindow(CID, { id: 'x' })).toBe(false);
  });

  it('the term window holds only the work dated inside the term', () => {
    seed({ assessments: [level('a1', '2026-10-05')], scores: [score('a1', 3, '2026-10-05')] });
    expect(assessmentInTermWindow(CID, { date: '2026-10-05' })).toBe(true); // no term: everything
    setActiveTerm(CID, 2);
    expect(assessmentInTermWindow(CID, { date: '2026-10-05' })).toBe(false);
    expect(assessmentInTermWindow(CID, { date: '2026-12-01' })).toBe(true);
    expect(assessmentInYearToDate(CID, { date: '2026-10-05' })).toBe(true);
  });

  it('a competency override applies year to date', () => {
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
    expect(getSectionProficiencyRaw(CID, SID, SEC)).toBe(1.5); // both pieces, the year to date
  });

  it('a Term 1 piece marked Missing still counts on Report 2', () => {
    seed({
      assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
      scores: [score('t2', 9, '2027-01-10')],
    });
    _cache.statuses[CID] = { [SID + ':t1']: 'NS' };
    clearProfCache();
    setActiveTerm(CID, 2);
    expect(getCourseLetterData(CID, SID).R).toBe(45); // 9/20, not 9/10
  });

  it('previousReportTerm is the term before the report, or the last ended term for the year so far', () => {
    seed({ assessments: [level('a1', '2026-10-05')], scores: [score('a1', 3, '2026-10-05')] });
    setActiveTerm(CID, 2);
    expect(previousReportTerm(CID).ordinal).toBe(1);
    setActiveTerm(CID, 1);
    expect(previousReportTerm(CID)).toBeNull();
    setActiveTerm(CID, null);
    const was = globalThis.courseToday;
    try {
      globalThis.courseToday = () => '2026-11-15';
      expect(previousReportTerm(CID)).toBeNull();
      globalThis.courseToday = () => '2026-12-05';
      expect(previousReportTerm(CID).ordinal).toBe(1);
    } finally {
      globalThis.courseToday = was;
    }
  });

  it('readAsOfTerm reads another report and puts the one in view back', () => {
    seed({
      assessments: [level('oct', '2026-10-15'), level('dec', '2026-12-10')],
      scores: [score('oct', 2, '2026-10-15'), score('dec', 4, '2026-12-10')],
    });
    setActiveTerm(CID, 2);
    expect(readAsOfTerm(CID, 1, () => getOverallProficiency(CID, SID))).toBe(2);
    expect(getActiveTerm(CID).ordinal).toBe(2);
    setActiveTerm(CID, null);
    expect(readAsOfTerm(CID, 1, () => getOverallProficiency(CID, SID))).toBe(2);
    expect(getActiveTerm(CID)).toBeNull();
  });

  it('cached results are kept per term', () => {
    seed({
      assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
      scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
    });
    setActiveTerm(CID, 1);
    getCourseLetterData(CID, SID);
    setActiveTerm(CID, 2);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
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
