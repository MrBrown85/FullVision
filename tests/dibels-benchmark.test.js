/**
 * DIBELS 8 benchmark levels (grader plan PR 19): accuracy, the adjusted Maze
 * score and the Grade 8 cut points, and a DIBELS assessment counting toward
 * no grade, whatever its status.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-dibels';
const SID = 'stu-1';
const DIBELS = { id: 'a-dibels', title: 'DIBELS', date: '2026-10-03', scoreMode: 'dibels', tagIds: [] };

describe('DIBELS figures', () => {
  it('works out accuracy and the adjusted Maze score', () => {
    expect(dibelsAccuracy(147, 2)).toBe(98.7);
    expect(dibelsAccuracy(null, 2)).toBeNull();
    expect(dibelsAccuracy(0, 0)).toBeNull();
    expect(dibelsMazeAdjusted(21, 3)).toBe(19.5);
    expect(dibelsMazeAdjusted(2, 9)).toBe(0);
    expect(dibelsMazeAdjusted(21, null)).toBe(21);
    expect(dibelsMazeAdjusted(null, 3)).toBeNull();
  });

  it('places a score against the Grade 8 cut points for its window', () => {
    expect(dibelsLevel('orf', 'boy', 142)).toBe('above');
    expect(dibelsLevel('orf', 'boy', 141)).toBe('core');
    expect(dibelsLevel('orf', 'moy', 120)).toBe('strategic');
    expect(dibelsLevel('orf', 'eoy', 120)).toBe('intensive');
    expect(dibelsLevel('maze', 'boy', 19.5)).toBe('strategic');
    expect(dibelsLevel('maze', 'eoy', 38)).toBe('above');
    expect(dibelsLevel('orf', 'boy', null)).toBeNull();
    expect(dibelsLevel('orf', 'summer', 100)).toBeNull();
  });

  it('picks the window from the date', () => {
    expect(dibelsPeriodFor('2026-09-15')).toBe('boy');
    expect(dibelsPeriodFor('2027-01-20')).toBe('moy');
    expect(dibelsPeriodFor('2027-05-10')).toBe('eoy');
  });
});

describe('a DIBELS assessment in the gradebook', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.assessments[CID] = [DIBELS];
    _cache.scores[CID] = {};
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.dibels[CID] = {};
    clearProfCache();
  });

  it('shows the latest window’s ORF level as a word', () => {
    saveDibelsScore(CID, SID, DIBELS.id, 'boy', { orfWrc: 147, orfErrors: 2 });
    expect(assessmentCellValue(CID, SID, DIBELS)).toMatchObject({ kind: 'dibels', text: 'Above' });
    saveDibelsScore(CID, SID, DIBELS.id, 'moy', { orfWrc: 120, orfErrors: 6 });
    clearProfCache();
    expect(assessmentCellValue(CID, SID, DIBELS)).toMatchObject({
      kind: 'dibels',
      text: 'Strategic',
      dibels: { period: 'moy', level: 'strategic' },
    });
  });

  it('counts toward no grade, even when Missing', () => {
    saveDibelsScore(CID, SID, DIBELS.id, 'boy', { orfWrc: 147 });
    expect(getAssessmentOverallScore(CID, SID, DIBELS.id)).toBeNull();
    _cache.statuses[CID] = { [SID + ':' + DIBELS.id]: 'NS' };
    clearProfCache();
    expect(getAssignmentStatus(CID, SID, DIBELS.id)).toBe('NS');
    expect(getAssessmentOverallScore(CID, SID, DIBELS.id)).toBeNull();
    expect(columnCountedValue(CID, SID, { assessment: DIBELS })).toBeNull();
  });
});
