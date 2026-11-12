/**
 * points: the tests that were tests/points-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

describe('points-comment-before-score', () => {
  /**
   * An Overall Comment on points or Complete/Incomplete work before any score:
   * the entry that carries it has no score, and no reader turns it into a 0.
   */

  const CID = 'c1111111-1111-4111-8111-111111111111';
  const SID = 'c3333333-3333-4333-8333-333333333333';
  const TAG = 'c8888888-8888-4888-8888-888888888881';
  const PTS = 'c2222222-2222-4222-8222-222222222221';
  const CMP = 'c2222222-2222-4222-8222-222222222222';

  function entry(aid, score, note) {
    return {
      id: aid + ':' + TAG,
      assessmentId: aid,
      tagId: TAG,
      score: score,
      note: note || '',
      date: '2026-10-03',
      type: 'summative',
    };
  }
  function fresh() {
    if (typeof clearProfCache === 'function') clearProfCache();
  }

  describe('a comment-only entry on points work', () => {
    beforeEach(() => {
      localStorage.clear();
      ['scores', 'assessments', 'students'].forEach(function (field) {
        if (_cache[field]) delete _cache[field][CID];
      });
      fresh();
      saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
      saveAssessments(CID, [
        {
          id: PTS,
          title: 'Quiz',
          date: '2026-10-03',
          type: 'summative',
          tagIds: [TAG],
          scoreMode: 'points',
          maxPoints: 10,
        },
        { id: CMP, title: 'Exit Slip', date: '2026-10-04', type: 'summative', tagIds: [TAG], scoreMode: 'complete' },
      ]);
    });

    it('is not a 0 in the competency roll-up; a typed 0 is', () => {
      saveScores(CID, { [SID]: [entry(PTS, null, 'Hello')] });
      fresh();
      expect(getTagScores(CID, SID, TAG)).toEqual([]);
      saveScores(CID, { [SID]: [entry(PTS, 0, 'Hello')] });
      fresh();
      expect(getTagScores(CID, SID, TAG)).toHaveLength(1);
    });

    it('is no points score and no Complete/Incomplete mark', () => {
      saveScores(CID, { [SID]: [entry(PTS, null, 'Hello'), entry(CMP, null, 'Hello')] });
      expect(getPointsScore(CID, SID, PTS)).toBeNull();
      expect(getCompletionMark(CID, SID, CMP)).toBeNull();
      expect(getScoreComment(CID, SID, PTS)).toBe('Hello');
      expect(getScoreComment(CID, SID, CMP)).toBe('Hello');
    });

    it('keeps the comment once a score is typed', () => {
      saveScoreComment(CID, SID, PTS, 'Hello');
      setPointsScore(CID, SID, PTS, 7);
      expect(getPointsScore(CID, SID, PTS)).toBe(7);
      expect(getScoreComment(CID, SID, PTS)).toBe('Hello');
    });
  });
});

describe('points-decimals', () => {
  /**
   * Points scores take decimals: 33.5 / 40 (requested 2026-10-14).
   */

  // Production loads the outbox next to shared/data.js; so do these tests.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
    filename: 'shared/offline-queue.js',
  });

  describe('parsePointsInput', () => {
    it('keeps decimals', () => {
      expect(parsePointsInput('33.5', 40)).toBe(33.5);
      expect(parsePointsInput('12.25', 40)).toBe(12.25);
    });

    it('accepts a comma as the decimal point', () => {
      expect(parsePointsInput('33,5', 40)).toBe(33.5);
    });

    it('rounds to two places and holds the value between 0 and twice the maximum', () => {
      expect(parsePointsInput('7.126', 10)).toBe(7.13);
      expect(parsePointsInput('45', 40)).toBe(45);
      expect(parsePointsInput('95', 40)).toBe(80);
      expect(parsePointsInput('-2', 40)).toBe(0);
    });

    it('reads blank input as no score, and a typed 0 as 0', () => {
      expect(parsePointsInput('', 40)).toBeNull();
      expect(parsePointsInput('  ', 40)).toBeNull();
      expect(parsePointsInput('abc', 40)).toBeNull();
      expect(parsePointsInput('0', 40)).toBe(0);
    });

    it('gives back the saved score for a typo; only a blank box clears', () => {
      expect(parsePointsInput('abc', 40, 33.5)).toBe(33.5);
      expect(parsePointsInput('-', 40, 12)).toBe(12);
      expect(parsePointsInput('abc', 40, null)).toBeNull();
      expect(parsePointsInput('', 40, 33.5)).toBeNull();
      expect(parsePointsInput('  ', 40, 33.5)).toBeNull();
      expect(parsePointsInput('20', 40, 33.5)).toBe(20);
    });
  });

  describe('formatPoints', () => {
    it('writes scores without trailing zeros', () => {
      expect(formatPoints(33.5)).toBe('33.5');
      expect(formatPoints(8)).toBe('8');
      expect(formatPoints(33.333333)).toBe('33.33');
    });
  });

  describe('saving a decimal points score', () => {
    const CID = '11111111-1111-4111-8111-111111111111';
    const ENR = '22222222-2222-4222-8222-222222222222';
    const AID = '44444444-4444-4444-8444-444444444444';
    const TAG = '77777777-7777-4777-8777-777777777777';
    let fake, originalGetSupabase, originalUseSupabase;

    beforeEach(() => {
      localStorage.clear();
      const assessments = [
        { id: AID, title: 'Essay', type: 'summative', tagIds: [TAG], scoreMode: 'points', maxPoints: 40 },
      ];
      _cache.assessments[CID] = assessments;
      localStorage.setItem('gb-' + _DATA_KEYS.assessments + '-' + CID, JSON.stringify(assessments));
      _cache.scores[CID] = {};
      localStorage.setItem('gb-' + _DATA_KEYS.scores + '-' + CID, '{}');
      _serverState = {};
      fake = makeFakeSupabase();
      originalGetSupabase = globalThis.getSupabase;
      originalUseSupabase = _useSupabase;
      globalThis.getSupabase = () => fake;
      _useSupabase = true;
      _supabaseDegraded = false;
      _teacherId = 'teacher-uuid';
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.v2Queue.clear();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      window.v2Queue.clear();
    });

    it('stores and sends 33.5 as 33.5', async () => {
      setPointsScore(CID, ENR, AID, parsePointsInput('33.5', 40));
      expect(getPointsScore(CID, ENR, AID)).toBe(33.5);
      await settle();
      expect(fake.committedCount('upsert_score', p => p.p_value === 33.5)).toBe(1);
    });
  });
});

describe('points-level-by-table', () => {
  /**
   * A points assessment's level follows the class's Points to Proficiency
   * table everywhere (Colin, 2026-11-01). A 72% test showed 2.9 (Proficient's
   * colour) as a student page grade, while its competency and its gradebook
   * cell said Developing from the table. The % is unchanged.
   */

  const CID = 'points-level';
  const SID = 'stu-1';
  const test72 = { id: 'p', title: 'Unit Test', scoreMode: 'points', maxPoints: 100, tagIds: ['t1'] };

  function seed(system, config) {
    COURSES[CID] = { id: CID, gradingSystem: system, gradeLevel: '8' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'S', tags: [{ id: 't1' }] }],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [test72];
    _cache.scores[CID] = { [SID]: [{ assessmentId: 'p', tagId: 't1', score: 72, date: '2026-10-01' }] };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.courseConfigs[CID] = Object.assign({ calcMethod: 'average' }, config);
    clearProfCache();
  }

  describe('points work level', () => {
    afterEach(() => delete COURSES[CID]);

    it('reads the same level as its competency and its cell', () => {
      seed('proficiency');
      const g = assessmentGroupGrade(CID, SID, [test72]);
      expect(g).toMatchObject({ text: '2.0', level: 2 });
      expect(assessmentCellValue(CID, SID, test72).level).toBe(2);
      expect(getTagProficiency(CID, SID, 't1')).toBe(2);
      expect(levelWord(CID, g.prof)).toBe('Developing');
      expect(columnCountedValue(CID, SID, { assessment: test72, measure: 'level' })).toEqual({ value: 2 });
    });

    it("follows the class's own table, however it was saved", () => {
      const boundaries = [
        { min: 0, proficiency: 1 },
        { min: 50, proficiency: 2 },
        { min: 70, proficiency: 3 },
        { min: 90, proficiency: 4 },
      ];
      seed('proficiency', { gradingScale: { boundaries } });
      expect(getAssessmentOverallScore(CID, SID, 'p')).toBe(3);
      expect(getTagProficiency(CID, SID, 't1')).toBe(3);
    });

    it('leaves the % alone', () => {
      seed('both');
      expect(assessmentGroupGrade(CID, SID, [test72]).text).toBe('2.0 · C+ 72%');
      expect(getCourseLetterData(CID, SID).R).toBe(72);
    });
  });
});
