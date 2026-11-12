/**
 * dibels: the tests that were tests/dibels-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('dibels-benchmark', () => {
  /**
   * DIBELS 8 benchmark levels (grader plan PR 19): accuracy, the adjusted Maze
   * score and the Grade 8 cut points, and a DIBELS assessment counting toward
   * no grade, whatever its status.
   */

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
});

describe('dibels-scores', () => {
  /**
   * DIBELS 8 benchmark scores in the data layer (grader plan PR 18,
   * migrations/20261027_dibels_scores.sql): one window's four raw numbers per
   * student and assessment, saved locally and sent as upsert_dibels_score,
   * loaded from list_course_dibels.
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const AID = '22222222-2222-4222-8222-222222222222';
  const SID = '33333333-3333-4333-8333-333333333333';

  describe('DIBELS scores', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      localStorage.clear();
      delete _cache.dibels[CID];
      saveAssessments(CID, [{ id: AID, title: 'DIBELS Fall', date: '2026-10-03', scoreMode: 'dibels', tagIds: [] }]);
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      client = {
        calls: [],
        rows: [],
        rpc(name, payload) {
          client.calls.push({ name: name, payload: payload || {} });
          if (name === 'list_course_dibels') return Promise.resolve({ data: client.rows, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    const upserts = () => client.calls.filter(c => c.name === 'upsert_dibels_score');

    it('knows a DIBELS assessment', () => {
      expect(isDibelsScored({ scoreMode: 'dibels' })).toBe(true);
      expect(isDibelsScored({ score_mode: 'dibels' })).toBe(true);
      expect(isDibelsScored({ scoreMode: 'points' })).toBe(false);
    });

    it('saves one window and sends all four numbers, blanks as null', () => {
      saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: '128', orfErrors: 3, mazeCorrect: '', mazeIncorrect: null });
      expect(getDibelsScore(CID, SID, AID, 'boy')).toEqual({
        orfWrc: 128,
        orfErrors: 3,
        mazeCorrect: null,
        mazeIncorrect: null,
      });
      expect(getDibelsScore(CID, SID, AID, 'moy')).toBeNull();
      expect(upserts()).toHaveLength(1);
      expect(upserts()[0].payload).toEqual({
        p_enrollment_id: SID,
        p_assessment_id: AID,
        p_period: 'boy',
        p_orf_wrc: 128,
        p_orf_errors: 3,
        p_maze_correct: null,
        p_maze_incorrect: null,
      });
    });

    it('sends nothing when nothing changed, and clears a window saved all blank', () => {
      saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: 128 });
      saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: '128' });
      expect(upserts()).toHaveLength(1);
      saveDibelsScore(CID, SID, AID, 'boy', {});
      expect(getDibelsScore(CID, SID, AID, 'boy')).toBeNull();
      expect(upserts()).toHaveLength(2);
      expect(upserts()[1].payload.p_orf_wrc).toBeNull();
    });

    it('ignores a negative or unknown number and an unknown window', () => {
      saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: -4, orfErrors: 'abc', mazeCorrect: 12.7 });
      expect(getDibelsScore(CID, SID, AID, 'boy')).toEqual({
        orfWrc: null,
        orfErrors: null,
        mazeCorrect: 12,
        mazeIncorrect: null,
      });
      expect(saveDibelsScore(CID, SID, AID, 'summer', { orfWrc: 10 })).toBe(false);
    });

    it('loads the class’s rows from list_course_dibels', async () => {
      client.rows = [
        {
          enrollment_id: SID,
          assessment_id: AID,
          period: 'moy',
          orf_wrc: 141,
          orf_errors: 2,
          maze_correct: 21,
          maze_incorrect: 1,
        },
      ];
      expect(await loadDibelsScores(CID)).toBe(true);
      expect(getDibelsScore(CID, SID, AID, 'moy')).toEqual({
        orfWrc: 141,
        orfErrors: 2,
        mazeCorrect: 21,
        mazeIncorrect: 1,
      });
      expect(await loadDibelsScores(CID)).toBe(false);
    });
  });
});
