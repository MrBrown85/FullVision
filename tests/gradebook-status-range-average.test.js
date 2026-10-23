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

// Every Class Average (Competencies view, printed sheet, CSV export) comes
// from calc.js's one column rule, classColumnAverage. A status counts as it
// does in the student's own grade for that work: on points and
// Complete/Incomplete work Excused is left out and Not Submitted is 0; on
// proficiency work both are left out (no evidence).
describe('classColumnAverage', () => {
  const level = { id: 'lv', title: 'lv', scoreMode: 'proficiency', tagIds: ['T1'], type: 'summative' };
  const entry = (value, mod, tagId = 'T1') => ({ assessmentId: 'lv', tagId, score: value, mod, date: '2026-10-10' });
  const comp = tagIds => ({ assessment: level, tagIds });

  it('averages the scored students on a competency, + and − included', () => {
    seed([level], { s1: [entry(3, 1)], s2: [entry(3, -1)], s3: [entry(2)], s4: [] });
    const stats = classColumnAverage(CID, STUDENTS, comp(['T1']));
    expect(stats.count).toBe(3);
    expect(stats.avg).toBeCloseTo((scoreModValue(entry(3, 1)) + scoreModValue(entry(3, -1)) + 2) / 3, 10);
  });

  it('returns null when nobody counts', () => {
    seed([level], { s1: [entry(0)], s2: [] });
    expect(classColumnAverage(CID, STUDENTS, comp(['T1']))).toBeNull();
  });

  it('leaves Excused and Not Submitted out of proficiency work, even with a score left', () => {
    seed([level], { s1: [entry(4)], s2: [entry(2)], s3: [entry(1)] }, { 's2:lv': 'EXC', 's3:lv': 'NS' });
    expect(classColumnAverage(CID, STUDENTS, comp(['T1']))).toEqual({ avg: 4, count: 1 });
    // The whole assessment, as the printed sheet reads it, follows the same rule.
    expect(classColumnAverage(CID, STUDENTS, { assessment: level })).toEqual({ avg: 4, count: 1 });
  });

  it('averages every competency a rubric criterion feeds, each student once', () => {
    const twoKeys = { ...level, tagIds: ['T1', 'T2'] };
    seed([twoKeys], { s1: [entry(4, 0, 'T1'), entry(2, 0, 'T2')], s2: [entry(3, 0, 'T1')] });
    expect(classColumnAverage(CID, STUDENTS, { assessment: twoKeys, tagIds: ['T1', 'T2'] })).toEqual({
      avg: 3,
      count: 2,
    });
  });

  it('counts Not Submitted as 0 and leaves Excused out on points work', () => {
    const pts = points('pt', 10);
    seed(
      [pts],
      { s1: [score('pt', 8)], s2: [score('pt', 6)], s3: [score('pt', 9)], s4: [] },
      {
        's2:pt': 'NS',
        's3:pt': 'EXC',
      },
    );
    expect(classColumnAverage(CID, STUDENTS, { assessment: pts })).toEqual({ avg: 4, pct: 40, count: 2 });
    // Read as a proficiency (the printed sheet's Proficiency choice), the same students count.
    expect(classColumnAverage(CID, STUDENTS, { assessment: pts, measure: 'level' }).count).toBe(2);
    // getClassPointsAverage is the same rule.
    expect(getClassPointsAverage(CID, STUDENTS, pts)).toEqual(classColumnAverage(CID, STUDENTS, { assessment: pts }));
  });

  it('writes each status rule once, matching how the course % counts points work', () => {
    expect(COLUMN_STATUS_RULES.points).toEqual({ EXC: 'out', NS: 'zero' });
    expect(COLUMN_STATUS_RULES.proficiency).toEqual({ EXC: 'out', NS: 'out' });
    const pts = points('pt', 10);
    seed([pts], { s1: [score('pt', 8)], s2: [score('pt', 8)] }, { 's1:pt': 'NS', 's2:pt': 'EXC' });
    expect(getAssessmentOverallScore(CID, 's1', 'pt')).toBe(0);
    expect(getAssessmentOverallScore(CID, 's2', 'pt')).toBeNull();
  });
});

describe('scoreStatusMarker tooltip', () => {
  const pts = points('pt', 10);
  const prof = { id: 'lv', title: 'lv', scoreMode: 'proficiency', tagIds: ['T1'], type: 'summative' };
  it('says how Not Submitted counts for the work', () => {
    COURSES[CID] = { id: CID, gradingSystem: 'proficiency' };
    expect(scoreStatusMarker('NS', CID, pts)).toContain('counts as 0');
    expect(scoreStatusMarker('NS', CID, prof)).toContain('not counted, no evidence yet');
    COURSES[CID].gradingSystem = 'letter';
    expect(scoreStatusMarker('NS', CID, prof)).toContain('0 in the course %, not counted in proficiency');
    delete COURSES[CID];
  });
});
