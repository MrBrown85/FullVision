/**
 * Gradebook fixes from the 2026-10-16 Demo Mode test:
 *   - Not Submitted and Excused cells showed "·" or "—", with nothing to say
 *     NS counts as 0. They now show an NS or EXC mark.
 *   - Extra credit (up to 2× max) got the orange out-of-range warning.
 *   - The Competencies view's Class Average was blank for points and
 *     Complete/Incomplete columns.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'course-gb';
const STUDENTS = ['s1', 's2', 's3', 's4'].map(id => ({ id, firstName: id, lastName: 'Test' }));

const points = (id, max) => ({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [], type: 'summative' });
const complete = id => ({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: [], type: 'summative' });
const score = (assessmentId, value) => ({ assessmentId, tagId: 'overall', score: value, date: '2026-10-10' });

function seed(assessments, scoresBySid, statuses = {}) {
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = scoresBySid;
  _cache.statuses[CID] = statuses;
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('scoreStatusMarker', () => {
  it('marks Not submitted and Excused', () => {
    expect(scoreStatusMarker('NS')).toContain('>NS<');
    expect(scoreStatusMarker('NS')).toContain('counts as 0');
    expect(scoreStatusMarker('EXC')).toContain('>EXC<');
  });

  it('leaves Late and no status to the score', () => {
    expect(scoreStatusMarker('LATE')).toBe('');
    expect(scoreStatusMarker(null)).toBe('');
  });
});

describe('isScoreOutOfRange', () => {
  it('allows extra credit up to twice the maximum on points work', () => {
    expect(isScoreOutOfRange(points('a', 10), 10)).toBe(false);
    expect(isScoreOutOfRange(points('a', 10), 15)).toBe(false);
    expect(isScoreOutOfRange(points('a', 10), 20)).toBe(false);
    expect(isScoreOutOfRange(points('a', 10), 21)).toBe(true);
  });

  it('flags a level above 4 and Complete above 1', () => {
    expect(isScoreOutOfRange({ id: 'p', scoreMode: 'proficiency' }, 4)).toBe(false);
    expect(isScoreOutOfRange({ id: 'p', scoreMode: 'proficiency' }, 4.5)).toBe(true);
    expect(isScoreOutOfRange(complete('c'), 1)).toBe(false);
    expect(isScoreOutOfRange(complete('c'), 2)).toBe(true);
  });
});

describe('getClassPointsAverage', () => {
  beforeEach(() => localStorage.clear());

  it('counts not submitted as 0 and leaves out excused and ungraded work', () => {
    const a = points('quiz', 20);
    seed(
      [a],
      { s1: [score('quiz', 18)], s2: [], s3: [score('quiz', 20)], s4: [] },
      { 's2:quiz': 'NS', 's3:quiz': 'EXC' },
    );
    expect(getClassPointsAverage(CID, STUDENTS, a)).toEqual({ avg: 9, pct: 45, count: 2 });
  });

  it('counts extra credit', () => {
    const a = points('quiz', 20);
    seed([a], { s1: [score('quiz', 30)], s2: [score('quiz', 10)], s3: [], s4: [] });
    expect(getClassPointsAverage(CID, STUDENTS, a)).toEqual({ avg: 20, pct: 100, count: 2 });
  });

  it('gives the % complete on Complete/Incomplete work', () => {
    const a = complete('hw');
    seed([a], { s1: [score('hw', 1)], s2: [score('hw', 0)], s3: [score('hw', 1)], s4: [] });
    expect(getClassPointsAverage(CID, STUDENTS, a).pct).toBeCloseTo(66.67, 1);
  });

  it('is null when nobody has a grade', () => {
    const a = points('quiz', 20);
    seed([a], { s1: [], s2: [], s3: [], s4: [] });
    expect(getClassPointsAverage(CID, STUDENTS, a)).toBeNull();
  });
});

describe('gradebook views use them', () => {
  const src = readFileSync(resolve(root, 'teacher/page-gradebook.js'), 'utf-8');

  it('marks NS and EXC cells in both views', () => {
    expect(src.match(/scoreStatusMarker\(/g).length).toBeGreaterThanOrEqual(2);
  });

  it('warns only above the extra-credit cap', () => {
    // The Scores view reads the flag from assessmentCellValue (calc.js).
    const calc = readFileSync(resolve(root, 'shared/calc.js'), 'utf-8');
    expect(calc).toContain('isScoreOutOfRange(a, val)');
    expect(src).toContain('cell.outOfRange');
    expect(src).not.toContain('if (val > maxVal)');
  });

  it('fills the Class Average for points columns', () => {
    expect(src).toContain('getClassPointsAverage(cid, students, assess)');
  });
});
