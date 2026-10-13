/**
 * + / − on proficiency levels. A modifier is worth a third of a level
 * (3+ = 3.33, 3− = 2.67); 1− and 4+ don't exist.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

describe('modifier helpers', () => {
  it('allows + and − on every level except 1− and 4+', () => {
    expect(normalizeScoreMod(3, 1)).toBe(1);
    expect(normalizeScoreMod(3, -1)).toBe(-1);
    expect(normalizeScoreMod(1, -1)).toBe(0);
    expect(normalizeScoreMod(1, 1)).toBe(1);
    expect(normalizeScoreMod(4, 1)).toBe(0);
    expect(normalizeScoreMod(4, -1)).toBe(-1);
    expect(normalizeScoreMod(0, 1)).toBe(0);
    expect(normalizeScoreMod(2, undefined)).toBe(0);
  });

  it('counts a modifier as a third of a level', () => {
    expect(scoreModValue({ score: 3, mod: 1 })).toBeCloseTo(3.333, 3);
    expect(scoreModValue({ score: 3, mod: -1 })).toBeCloseTo(2.667, 3);
    expect(scoreModValue({ score: 2 })).toBe(2);
    expect(scoreModValue({ score: 4, mod: 1 })).toBe(4);
  });

  it('does not add the modifier twice to an entry from getTagScores', () => {
    expect(scoreModValue({ level: 3, score: 3 + 1 / 3, mod: 1 })).toBeCloseTo(3.333, 3);
  });

  it('formats the level with its sign', () => {
    expect(formatScoreLevel(3, 1)).toBe('3+');
    expect(formatScoreLevel(2, -1)).toBe('2−');
    expect(formatScoreLevel(4, 1)).toBe('4');
    expect(formatScoreLevel(0, 1)).toBe('');
  });
});

describe('upsertScore with a modifier', () => {
  const CID = 'test';
  beforeEach(() => {
    _cache.scores[CID] = undefined;
    localStorage.clear();
  });

  it('stores the modifier and clears it when the level is re-entered without one', () => {
    saveScores(CID, {});
    upsertScore(CID, 'stu1', 'a1', 't1', 3, '2026-10-13', 'summative', '', 1);
    expect(getScores(CID).stu1[0].mod).toBe(1);

    upsertScore(CID, 'stu1', 'a1', 't1', 3, '2026-10-13', 'summative', '');
    expect(getScores(CID).stu1[0].mod).toBeUndefined();
  });

  it('drops a modifier the level does not allow', () => {
    saveScores(CID, {});
    upsertScore(CID, 'stu1', 'a1', 't1', 4, '2026-10-13', 'summative', '', 1);
    expect(getScores(CID).stu1[0].mod).toBeUndefined();
  });
});

describe('modifier in the score RPC', () => {
  const CID = '11111111-1111-4111-8111-111111111111';
  const ENR = '22222222-2222-4222-8222-222222222222';
  const AID = '44444444-4444-4444-8444-444444444444';
  const TAG = '77777777-7777-4777-8777-777777777777';
  let fake, originalGetSupabase, originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    _cache.scores[CID] = undefined;
    const assessments = [{ id: AID, title: 'Lab', type: 'summative', tagIds: [TAG] }];
    _cache.assessments[CID] = assessments;
    localStorage.setItem('gb-' + _DATA_KEYS.assessments + '-' + CID, JSON.stringify(assessments));
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

  it('sends p_modifier with the level', async () => {
    upsertScore(CID, ENR, AID, TAG, 3, '2026-10-13', 'summative', '', 1);
    await settle();
    expect(fake.committedCount('upsert_tag_score', p => p.p_value === 3 && p.p_modifier === 1)).toBe(1);
  });

  it('sends 0 when there is no modifier', async () => {
    upsertScore(CID, ENR, AID, TAG, 2, '2026-10-13', 'summative', '');
    await settle();
    expect(fake.committedCount('upsert_tag_score', p => p.p_value === 2 && p.p_modifier === 0)).toBe(1);
  });
});

describe('calculations use the modified value', () => {
  const saved = {};
  function mock(fns) {
    Object.keys(fns).forEach(k => {
      saved[k] = globalThis[k];
      globalThis[k] = fns[k];
    });
  }
  afterEach(() => {
    Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
    clearProfCache();
  });

  it('getTagScores returns 3+ as 3.33 and keeps the level', () => {
    clearProfCache();
    mock({
      getScores: () => ({
        stu1: [{ score: 3, mod: 1, tagId: 't1', assessmentId: 'a1', date: '2026-01-01', type: 'summative' }],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative' }],
      getAssignmentStatuses: () => ({}),
      getGradingScale: () => DEFAULT_GRADING_SCALE,
    });
    const [s] = getTagScores('test', 'stu1', 't1');
    expect(s.score).toBeCloseTo(3.333, 3);
    expect(s.level).toBe(3);
  });
});
