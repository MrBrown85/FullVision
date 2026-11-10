/**
 * withReturnedOnly (student page build plan 1.3, S0-F1): shared/calc.js
 * works a grade out from returned grades only while a function runs, then
 * puts the set of scores in use back.
 *
 * - It gives back what the function returns, puts the set back after a
 *   throw, and can sit inside itself.
 * - It fails closed: with nothing to give the returned set, a grade worked
 *   out inside it throws. It never falls back to every score, which would
 *   show a draft to a family.
 * - Statuses and DIBELS numbers are the same in both sets; scores, points,
 *   Complete/Incomplete marks and the Overall Comment follow the set.
 * - The two sets never share a cached number.
 *
 * The four draft cases on the Demo class and the eval fixture are in
 * tests/returned-only-drafts.test.js; the invariant is in
 * tests/returned-only-invariant.test.js.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftNeverReturned, draftOnReturned, installReturnedScores } from './helpers/returned-scores.js';

const CID = 'course-returned';
const TAG = 'T1';
const STUDENTS = ['s1', 's2'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const ASSESSMENTS = [
  { id: 'lv', title: 'Level', scoreMode: 'proficiency', tagIds: [TAG], date: '2026-10-01', categoryId: 'cat' },
  { id: 'lv2', title: 'Level 2', scoreMode: 'proficiency', tagIds: [TAG], date: '2026-10-08', categoryId: 'cat' },
  { id: 'pt', title: 'Points', scoreMode: 'points', maxPoints: 10, tagIds: [], date: '2026-10-02', categoryId: 'cat' },
  { id: 'cp', title: 'Check', scoreMode: 'complete', maxPoints: 1, tagIds: [], date: '2026-10-03', categoryId: 'cat' },
];
const entry = (assessmentId, score, tagId, extra) =>
  Object.assign({ assessmentId, tagId, score, date: ASSESSMENTS.find(a => a.id === assessmentId).date }, extra);

// The working copy: s1 has a level 2 on each level piece, 4/10 and Incomplete.
function working() {
  return {
    s1: [
      entry('lv', 2, TAG, { note: 'Draft words.' }),
      entry('lv2', 2, TAG),
      entry('pt', 4, 'overall'),
      entry('cp', 0, 'overall'),
    ],
    s2: [entry('lv', 3, TAG), entry('lv2', 3, TAG)],
  };
}
// What s1 was given before the teacher changed it: level 4, 9/10, Complete.
const RETURNED = {
  lv: { v: 1, value: null, modifier: 0, comment: 'Returned words.', tags: { [TAG]: { value: 4, modifier: 0 } } },
  pt: { v: 1, value: 9, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
  cp: { v: 1, value: 1, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
};

let rowsByClass;
let installed;

beforeEach(() => {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'both', levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = working();
  _cache.statuses[CID] = {};
  _cache.dibels[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [{ id: 'S1', subject: 'SUB', name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.courseConfigs[CID] = {
    reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-05' }],
  };
  // s1: every piece but lv2 changed since it was returned; lv2 never returned.
  rowsByClass = {
    [CID]: {
      lv: { s1: draftOnReturned(RETURNED.lv) },
      pt: { s1: draftOnReturned(RETURNED.pt) },
      cp: { s1: draftOnReturned(RETURNED.cp) },
      lv2: { s1: draftNeverReturned() },
    },
  };
  installed = installReturnedScores(rowsByClass);
  setActiveTerm(CID, null);
  clearProfCache();
});

afterEach(() => {
  installed.remove();
  _scoreSet = 'all';
  setActiveTerm(CID, null);
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
});

describe('withReturnedOnly scopes the set of scores', () => {
  it('runs the function with returned grades only and gives back what it returns', () => {
    expect(_scoreSet).toBe('all');
    const result = withReturnedOnly(() => ({ set: _scoreSet, level: getTagProficiency(CID, 's1', TAG) }));
    expect(result).toEqual({ set: 'returned', level: 4 });
    expect(_scoreSet).toBe('all');
    // All work: the two draft levels, 2 and 2.
    expect(getTagProficiency(CID, 's1', TAG)).toBe(2);
  });

  it('is on window.Calc with calc.js’s other public functions', () => {
    expect(window.Calc.withReturnedOnly).toBe(withReturnedOnly);
  });

  it('puts the set back when the function throws', () => {
    expect(() =>
      withReturnedOnly(() => {
        throw new Error('a report block failed');
      }),
    ).toThrow('a report block failed');
    expect(_scoreSet).toBe('all');
    expect(getTagProficiency(CID, 's1', TAG)).toBe(2);
  });

  it('can sit inside itself, and a throw inside leaves the outer call in returned grades', () => {
    const seen = [];
    withReturnedOnly(() => {
      seen.push(_scoreSet);
      withReturnedOnly(() => seen.push(_scoreSet));
      seen.push(_scoreSet);
      try {
        withReturnedOnly(() => {
          throw new Error('inner');
        });
      } catch (err) {
        seen.push('caught ' + err.message);
      }
      seen.push(_scoreSet);
      seen.push(getTagProficiency(CID, 's1', TAG));
    });
    expect(seen).toEqual(['returned', 'returned', 'returned', 'caught inner', 'returned', 4]);
    expect(_scoreSet).toBe('all');
  });

  it('refuses work that does not finish at once, and still puts the set back', () => {
    expect(() => withReturnedOnly(async () => getTagProficiency(CID, 's1', TAG))).toThrow(/does not finish at once/);
    expect(_scoreSet).toBe('all');
    expect(() => withReturnedOnly(() => ({ then() {} }))).toThrow(/does not finish at once/);
    expect(_scoreSet).toBe('all');
  });

  it('works with a report’s term: the key carries both', () => {
    withReturnedOnly(() => {
      expect(_ck(CID)).toBe(CID + '#returned');
      readAsOfTerm(CID, 1, () => {
        expect(_ck(CID)).toBe(CID + '@1#returned');
        // As of Oct 5: lv (returned at 4) is in; lv2 is after it, and a draft anyway.
        expect(getTagProficiency(CID, 's1', TAG)).toBe(4);
      });
      expect(_ck(CID)).toBe(CID + '#returned');
    });
    expect(_ck(CID)).toBe(CID + '#all');
  });
});

describe('returned grades fail closed', () => {
  const READS = {
    'a competency level': () => getTagProficiency(CID, 's1', TAG),
    'the overall grade': () => studentGradeSummary(CID, 's1'),
    'the course letter': () => getCourseLetterData(CID, 's1'),
    'a gradebook cell': () => assessmentCellValue(CID, 's1', ASSESSMENTS[0]),
    'a class average': () => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[2] }),
    'the Overall Comment': () => _scoreRead.comment(CID, 's1', 'lv'),
  };

  it.each(Object.keys(READS))('with nothing to give the returned set, %s throws', name => {
    installed.remove();
    expect(typeof getReturnedScores).toBe('undefined');
    expect(() => withReturnedOnly(READS[name])).toThrow(/Returned grades were asked for.*No grade was worked out/);
    expect(_scoreSet).toBe('all');
    // All work is untouched, and nothing wrong was cached for returned grades.
    expect(() => READS[name]()).not.toThrow();
    installed = installReturnedScores(rowsByClass);
    expect(() => withReturnedOnly(READS[name])).not.toThrow();
    expect(withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toBe(4);
  });

  it('never falls back to every score: no draft value comes out', () => {
    installed.remove();
    let got = 'nothing';
    try {
      got = withReturnedOnly(() => getTagProficiency(CID, 's1', TAG));
    } catch (err) {
      got = 'threw';
    }
    expect(got).toBe('threw');
  });

  it.each([null, undefined, 0, 'scores'])('a builder that gives %s throws too', nothing => {
    installed.remove();
    globalThis.getReturnedScores = () => nothing;
    try {
      expect(() => withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toThrow(/none came back/);
    } finally {
      delete globalThis.getReturnedScores;
      installed = installReturnedScores(rowsByClass);
    }
  });

  it('a set calc.js does not know throws', () => {
    _scoreSet = 'another';
    expect(() => getTagProficiency(CID, 's1', TAG)).toThrow(/no set of scores called "another"/);
    _scoreSet = 'all';
    expect(getTagProficiency(CID, 's1', TAG)).toBe(2);
  });
});

describe('what follows the set and what does not', () => {
  it('scores, points, Complete/Incomplete marks and the Overall Comment are the returned ones', () => {
    const read = () => ({
      level: getTagProficiency(CID, 's1', TAG),
      points: _scoreRead.pointsScore(CID, 's1', 'pt'),
      mark: _scoreRead.completionMark(CID, 's1', 'cp'),
      comment: _scoreRead.comment(CID, 's1', 'lv'),
      cell: assessmentCellValue(CID, 's1', ASSESSMENTS[2]).value,
      neverReturned: getAssessmentOverallScore(CID, 's1', 'lv2'),
    });
    expect(read()).toEqual({
      level: 2,
      points: 4,
      mark: 'incomplete',
      comment: 'Draft words.',
      cell: 4,
      neverReturned: 2,
    });
    expect(withReturnedOnly(read)).toEqual({
      level: 4,
      points: 9,
      mark: 'complete',
      comment: 'Returned words.',
      cell: 9,
      neverReturned: null,
    });
    // A student with no draft reads the same both ways.
    const other = () => [getTagProficiency(CID, 's2', TAG), _scoreRead.comment(CID, 's2', 'lv')];
    expect(withReturnedOnly(other)).toEqual(other());
  });

  it('feedback counts follow the returned comment', () => {
    // Returned with a comment; the draft takes it off.
    _cache.scores[CID].s1[0].note = '';
    clearProfCache();
    expect(classFeedbackCounts(CID, STUDENTS, ASSESSMENTS[0]).withComment).toEqual([]);
    expect(withReturnedOnly(() => classFeedbackCounts(CID, STUDENTS, ASSESSMENTS[0]).withComment)).toEqual(['s1']);
  });

  it('statuses are the same in both sets, and one set on a draft shows at once', () => {
    expect(withReturnedOnly(() => _scoreRead.statuses(CID))).toBe(_scoreRead.statuses(CID));
    _cache.statuses[CID]['s1:lv2'] = 'LATE';
    _cache.statuses[CID]['s2:pt'] = 'NS';
    clearProfCache();
    const read = () => ({
      late: _scoreRead.status(CID, 's1', 'lv2'),
      lateCell: assessmentCellValue(CID, 's1', ASSESSMENTS[1]).late,
      missing: _scoreRead.status(CID, 's2', 'pt'),
      missingCounts: getAssessmentOverallScore(CID, 's2', 'pt'),
    });
    const want = { late: 'LATE', lateCell: true, missing: 'NS', missingCounts: 0 };
    expect(read()).toEqual(want);
    expect(withReturnedOnly(read)).toEqual(want);
    // The Late piece's grade still waits: a draft never returned.
    expect(assessmentCellValue(CID, 's1', ASSESSMENTS[1]).kind).toBe('level');
    expect(withReturnedOnly(() => assessmentCellValue(CID, 's1', ASSESSMENTS[1]).kind)).toBe('none');
  });

  it('DIBELS numbers have no returned set: the same in both', () => {
    _cache.dibels[CID] = { 's1:lv': { boy: { orfWrc: 92, orfErrors: 3 } } };
    const read = () => _scoreRead.dibels(CID, 's1', 'lv', 'boy');
    expect(read()).toMatchObject({ orfWrc: 92, orfErrors: 3 });
    expect(withReturnedOnly(read)).toEqual(read());
  });

  it('section overrides apply in both sets, as today (question 1 for Colin)', () => {
    _cache.overrides[CID] = { s1: { S1: { level: 3, reason: 'Conference', date: '2026-10-09', calculated: 2 } } };
    clearProfCache();
    expect(getSectionProficiency(CID, 's1', 'S1')).toBe(3);
    expect(withReturnedOnly(() => getSectionProficiency(CID, 's1', 'S1'))).toBe(3);
    // Without the override the two sets differ: 2 from the drafts, 4 as returned.
    expect(getSectionProficiencyRaw(CID, 's1', 'S1')).toBe(2);
    expect(withReturnedOnly(() => getSectionProficiencyRaw(CID, 's1', 'S1'))).toBe(4);
  });
});

describe('the two sets never share a cached number', () => {
  const grade = () => ({
    level: getTagProficiency(CID, 's1', TAG),
    overall: getOverallProficiency(CID, 's1'),
    percent: getCourseLetterData(CID, 's1').R,
    summary: studentGradeSummary(CID, 's1').text,
  });

  it('all work, then returned only with drafts present, then all work again, on warm caches', () => {
    const all = grade();
    const returned = withReturnedOnly(grade);
    const allAgain = grade();
    const returnedAgain = withReturnedOnly(grade);
    // All work: levels 2 and 2, 4/10, Incomplete: 8 of 19 points. (The class's
    // one term ended Oct 5, so under 50% is F, not IE, whatever today is.)
    expect(all).toEqual({ level: 2, overall: 2, percent: 42.1, summary: '2.0 · F 42.1%' });
    // Returned only: level 4, 9/10, Complete, the never-returned level left
    // out: 14 of 15 points.
    expect(returned).toEqual({ level: 4, overall: 4, percent: 93.3, summary: '4.0 · A 93.3%' });
    expect(allAgain).toEqual(all);
    expect(returnedAgain).toEqual(returned);
    // Both sets are cached side by side.
    const keys = Object.keys(_tagProfCache);
    expect(keys.filter(k => k.startsWith(CID + '#all')).length).toBeGreaterThan(0);
    expect(keys.filter(k => k.startsWith(CID + '#returned')).length).toBeGreaterThan(0);
  });

  it('the same with a report in view', () => {
    setActiveTerm(CID, 1);
    const all = grade();
    const returned = withReturnedOnly(grade);
    expect(returned.level).toBe(4);
    expect(all.level).toBe(2);
    expect(grade()).toEqual(all);
    expect(withReturnedOnly(grade)).toEqual(returned);
  });
});
