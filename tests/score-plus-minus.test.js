/**
 * + / − on proficiency levels. A modifier is worth a third of a level
 * (3+ = 3.33, 3− = 2.67); 1− and 4+ don't exist.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  const CID = '11111111-1111-1111-1111-111111111111';
  const ENR = '22222222-2222-2222-2222-222222222222';
  const AID = '33333333-3333-3333-3333-333333333333';
  const TAG = '55555555-5555-5555-5555-555555555555';
  let originalGetSupabase, originalUseSupabase, calls;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    localStorage.clear();
    calls = [];
    _cache.v2Gradebook = _cache.v2Gradebook || {};
    _cache.v2Gradebook[CID] = { assessments: [{ id: AID, has_rubric: false }] };
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    delete _cache.v2Gradebook[CID];
  });

  it('sends p_modifier with the level', () => {
    _persistScoreToCanonical(CID, ENR, AID, TAG, 3, '', 1);
    const call = calls.find(c => c.name === 'upsert_tag_score');
    expect(call.payload.p_value).toBe(3);
    expect(call.payload.p_modifier).toBe(1);
  });

  it('sends 0 when there is no modifier', () => {
    _persistScoreToCanonical(CID, ENR, AID, TAG, 2, '');
    const call = calls.find(c => c.name === 'upsert_tag_score');
    expect(call.payload.p_modifier).toBe(0);
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
