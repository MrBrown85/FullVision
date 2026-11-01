/**
 * Desktop and phone save a score the same way: the type a new score gets
 * comes from one rule (scoreTypeFor), the one calc.js buckets by, and the
 * phone's status toggle runs the desktop's applyAssignmentStatus.
 */
import { readFileSync } from 'node:fs';

const CID = 'test';

beforeEach(() => {
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  localStorage.clear();
});

describe('scoreTypeFor', () => {
  it('is summative for work in a category, whatever its own type', () => {
    expect(scoreTypeFor({ id: 'a1', categoryId: 'cat1' })).toBe('summative');
    expect(scoreTypeFor({ id: 'a1', category_id: 'cat1', type: 'formative' })).toBe('summative');
  });

  it("is the assessment's own type when it has no category", () => {
    expect(scoreTypeFor({ id: 'a1', type: 'summative' })).toBe('summative');
    expect(scoreTypeFor({ id: 'a1', type: 'formative' })).toBe('formative');
  });

  it('is formative with no category and no type, as a reload reads it', () => {
    expect(scoreTypeFor({ id: 'a1' })).toBe('formative');
  });

  it('is summative with no assessment', () => {
    expect(scoreTypeFor(null)).toBe('summative');
  });

  it('agrees with how a course grade buckets the score', () => {
    // getTagProficiency counts categorized work separately from formative
    // work with no category; the saved type has to say the same.
    [
      { id: 'a1', categoryId: 'cat1' },
      { id: 'a2', type: 'formative' },
      { id: 'a3', type: 'summative' },
      { id: 'a4' },
    ].forEach(a => {
      var bucket = a.categoryId ? 'categorized' : a.type === 'formative' || !a.type ? 'uncategorized' : 'categorized';
      expect(scoreTypeFor(a) === 'formative' ? 'uncategorized' : 'categorized').toBe(bucket);
    });
  });
});

describe('Missing zeroes scores through the shared rule', () => {
  it('saves the zeroed scores with the shared type and the class date', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Lab', tagIds: ['t1'] }]);
    saveScores(CID, { stu1: [] });
    applyAssignmentStatus(CID, 'stu1', 'a1', 'NS');
    var entry = getScores(CID).stu1.find(e => e.assessmentId === 'a1');
    expect(entry.type).toBe('formative');
    expect(entry.date).toBe(courseToday(CID));
  });

  it('setPointsScore saves new points with the shared type', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] }]);
    saveScores(CID, {});
    setPointsScore(CID, 'stu1', 'a1', 7);
    expect(getScores(CID).stu1[0].type).toBe('formative');
  });
});

describe('No score writer works out the type on its own', () => {
  const files = [
    'teacher/page-assignments.js',
    'teacher/page-gradebook.js',
    'teacher-mobile/tab-grade.js',
    'shared/data.js',
  ];
  it.each(files)('%s passes scoreTypeFor to upsertScore', file => {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf-8');
    // The old inline rules, each of which disagreed with the others.
    expect(src).not.toMatch(/assess(ment)? \? assess(ment)?\.type : 'summative'/);
    expect(src).not.toMatch(/assess(ment)?\.type \|\| 'summative'/);
    expect(src).not.toMatch(/: assessment\.type \|\| 'formative'/);
    expect(src).not.toMatch(/\(assessment && assessment\.type\) \|\| 'summative'/);
  });

  it('the phone status toggle calls applyAssignmentStatus', () => {
    const src = readFileSync(new URL('../teacher-mobile/tab-grade.js', import.meta.url), 'utf-8');
    const fn = src.slice(src.indexOf('function setStatus('), src.indexOf('function undoLastScore('));
    expect(fn).toContain('applyAssignmentStatus(cid, sid, aid, newStatus)');
    expect(fn).not.toContain('upsertScore(');
  });

  it('desktop points entry saves the score once, through setPointsScore', () => {
    const src = readFileSync(new URL('../teacher/page-assignments.js', import.meta.url), 'utf-8');
    const fn = src.slice(src.indexOf('function commitPointsScore('), src.indexOf('function focusPointsBox('));
    expect(fn).toContain('setPointsScore(cid, sid, aid, raw)');
    expect(fn).not.toContain('setScore(cid, sid, aid, aid');
  });
});
