/**
 * Three branches of shared/calc.js that the independent review of S0-F1d
 * found no test held: each could be changed and the whole suite still
 * passed. Tests only; no source changes with this file.
 *
 * All three are about a points or Complete/Incomplete piece that holds more
 * than one score entry (calc.js, _pieceScoreEntry: the one entry that holds
 * the piece's score).
 *
 * 1. Class Results counts a Complete/Incomplete piece as its cell shows it.
 *    completionCounts must read the mark through the piece, as the cell
 *    does. Read by the piece's id alone it takes the first entry stored,
 *    and a rubric level left behind would be counted as Complete while the
 *    cell shows Incomplete.
 * 2. The Overall score has two spellings in stored scores: 'overall', and ''
 *    in scores loaded before the key had a name. They are one key. Of two
 *    entries under it, the first stored is taken, whichever spelling it has.
 * 3. On a piece that lists a competency, a score kept under the Overall key
 *    comes before a score kept under a competency the piece does not list,
 *    whichever is stored first.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'course-pins';
const ASK = 'T-ask';
const PLAN = 'T-plan';
const LATER = 'zz-later'; // a competency whose id sorts after 'overall'
const STUDENTS = ['sam', 'kai'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const DAY = '2026-10-01';

const quiz = extra =>
  Object.assign(
    { id: 'quiz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [], date: DAY, categoryId: 'cat' },
    extra,
  );
const check = extra =>
  Object.assign(
    { id: 'check', title: 'Check', scoreMode: 'complete', maxPoints: 1, tagIds: [], date: DAY, categoryId: 'cat' },
    extra,
  );
const on = (assessmentId, tagId, score) => ({ assessmentId, tagId, score, date: DAY });

function seed(piece, scores) {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'both', levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = [piece];
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  // The rubric the Check had before it was switched to Complete/Incomplete.
  _cache.rubrics[CID] = [
    { id: 'R', name: 'Lab', tagIds: [], criteria: [{ id: 'r-method', name: 'Method', tagIds: [ASK] }] },
  ];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [ASK, PLAN, LATER].map(id => ({ id: 'S-' + id, subject: 'SUB', name: id, tags: [{ id, label: id }] })),
  };
  _cache.courseConfigs[CID] = {};
  setActiveTerm(CID, null);
  clearProfCache();
  return piece;
}
afterEach(() => {
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
});

// What every reading of a points piece gives for Sam.
function points(piece) {
  clearProfCache();
  const pct = getAssessmentGroupPercentage(CID, 'sam', [piece]);
  return {
    cell: assessmentCellValue(CID, 'sam', piece).text,
    percent: pct ? pct.pct : null,
    reader: _scoreRead.pointsScore(CID, 'sam', piece),
    course: getCourseLetterData(CID, 'sam').R,
  };
}

describe('1. Class Results counts a Complete/Incomplete piece as its cell shows it', () => {
  // The Check was a rubric piece: a level 3 on Method is left behind.
  const leftOver = () => on('check', 'r-method', 3);

  it.each([
    ['the level left behind stored first', sam => [leftOver(), sam]],
    ['the mark stored first', sam => [sam, leftOver()]],
  ])('marked Incomplete, %s: the cell and the counts both say Incomplete', (_name, order) => {
    const piece = seed(check(), {
      sam: order(on('check', 'overall', 0)),
      kai: [on('check', 'overall', 1)],
    });
    expect(assessmentCellValue(CID, 'sam', piece)).toMatchObject({ kind: 'complete', mark: 'incomplete' });
    const counts = completionCounts(CID, STUDENTS, piece);
    expect(counts.incomplete).toEqual(['sam']);
    expect(counts.complete).toEqual(['kai']);
    expect(counts.unmarked).toEqual([]);
    // One of two complete: the Class Average the panel prints.
    expect(counts.pct).toBe(50);
  });

  it('not marked yet, only the level left behind: the cell is empty and the counts say unmarked', () => {
    const piece = seed(check(), { sam: [leftOver()], kai: [] });
    expect(assessmentCellValue(CID, 'sam', piece).kind).toBe('none');
    const counts = completionCounts(CID, STUDENTS, piece);
    expect(counts.unmarked).toEqual(['sam', 'kai']);
    expect(counts.complete).toEqual([]);
    expect(counts.incomplete).toEqual([]);
    expect(counts.pct).toBeNull();
  });

  it('marked Complete beside the level left behind: Complete in both', () => {
    const piece = seed(check(), { sam: [leftOver(), on('check', 'overall', 1)], kai: [] });
    expect(assessmentCellValue(CID, 'sam', piece)).toMatchObject({ kind: 'complete', mark: 'complete' });
    expect(completionCounts(CID, STUDENTS, piece).complete).toEqual(['sam']);
  });
});

describe('2. the two spellings of the Overall key are one key', () => {
  it('a score under the older blank key is the piece’s score', () => {
    const piece = seed(quiz(), { sam: [on('quiz', '', 8)], kai: [] });
    expect(points(piece)).toEqual({ cell: '8', percent: 80, reader: 8, course: 80 });
  });

  it('two entries, one under each spelling: the first stored is taken, whichever spelling it has', () => {
    const blankFirst = seed(quiz(), { sam: [on('quiz', '', 8), on('quiz', 'overall', 5)], kai: [] });
    expect(points(blankFirst)).toEqual({ cell: '8', percent: 80, reader: 8, course: 80 });
    const namedFirst = seed(quiz(), { sam: [on('quiz', 'overall', 5), on('quiz', '', 8)], kai: [] });
    expect(points(namedFirst)).toEqual({ cell: '5', percent: 50, reader: 5, course: 50 });
  });

  it('the same for a Complete/Incomplete mark', () => {
    const piece = seed(check(), { sam: [on('check', '', 0), on('check', 'overall', 1)], kai: [] });
    expect(_scoreRead.completionMark(CID, 'sam', piece)).toBe('incomplete');
    expect(completionCounts(CID, STUDENTS, piece).incomplete).toEqual(['sam']);
    const other = seed(check(), { sam: [on('check', 'overall', 1), on('check', '', 0)], kai: [] });
    expect(_scoreRead.completionMark(CID, 'sam', other)).toBe('complete');
  });

  it('on a piece that lists a competency, the blank key ranks as the Overall key does', () => {
    // Under the competency the piece lists: 9. Under the blank key: 4.
    [
      [on('quiz', '', 4), on('quiz', ASK, 9)],
      [on('quiz', ASK, 9), on('quiz', '', 4)],
    ].forEach(order => {
      const piece = seed(quiz({ tagIds: [ASK] }), { sam: order, kai: [] });
      expect(points(piece).cell).toBe('9');
    });
    // Both spellings together, no score under the competency: one key, the first stored.
    const blankFirst = seed(quiz({ tagIds: [ASK] }), { sam: [on('quiz', '', 4), on('quiz', 'overall', 6)], kai: [] });
    expect(points(blankFirst).cell).toBe('4');
    const namedFirst = seed(quiz({ tagIds: [ASK] }), { sam: [on('quiz', 'overall', 6), on('quiz', '', 4)], kai: [] });
    expect(points(namedFirst).cell).toBe('6');
    // Beside a competency the piece does not list, the blank key comes first.
    [
      [on('quiz', '', 4), on('quiz', PLAN, 7)],
      [on('quiz', PLAN, 7), on('quiz', '', 4)],
    ].forEach(order => {
      const piece = seed(quiz({ tagIds: [ASK] }), { sam: order, kai: [] });
      expect(points(piece).cell).toBe('4');
    });
  });
});

describe('3. the Overall key comes before a competency the piece does not list', () => {
  // The Quiz lists Ask. It holds 8 under the Overall key (scored before it
  // had a competency) and 5 under a competency it does not list.
  it.each([
    ['a competency whose id sorts before "overall"', PLAN],
    ['a competency whose id sorts after "overall"', LATER],
  ])('%s: the Overall score is read, whichever is stored first', (_name, other) => {
    [
      [on('quiz', 'overall', 8), on('quiz', other, 5)],
      [on('quiz', other, 5), on('quiz', 'overall', 8)],
    ].forEach(order => {
      const piece = seed(quiz({ tagIds: [ASK] }), { sam: order, kai: [] });
      expect(points(piece)).toEqual({ cell: '8', percent: 80, reader: 8, course: 80 });
      // The piece's level, too: 80% is Proficient.
      expect(getAssessmentOverallScore(CID, 'sam', 'quiz')).toBe(3);
    });
  });

  it('a score under the competency the piece lists still comes before both', () => {
    const entries = [on('quiz', PLAN, 5), on('quiz', 'overall', 8), on('quiz', ASK, 10)];
    [entries, entries.slice().reverse()].forEach(order => {
      const piece = seed(quiz({ tagIds: [ASK] }), { sam: order, kai: [] });
      expect(points(piece).cell).toBe('10');
    });
  });

  it('with no Overall score, the competency not listed is read; two of them, the first by id', () => {
    [
      [on('quiz', LATER, 6), on('quiz', PLAN, 5)],
      [on('quiz', PLAN, 5), on('quiz', LATER, 6)],
    ].forEach(order => {
      const piece = seed(quiz({ tagIds: [ASK] }), { sam: order, kai: [] });
      expect(points(piece).cell).toBe('5');
    });
  });
});
