/**
 * Complete/Incomplete scoring. Scored like a 1-point assessment:
 * Complete = 1 (100%), Incomplete = 0 (0%), unmarked = no score.
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

describe('helpers', () => {
  it('recognizes the mode', () => {
    expect(isCompletionScored({ scoreMode: 'complete' })).toBe(true);
    expect(isCompletionScored({ scoreMode: 'points' })).toBe(false);
    expect(isPointsScored({ scoreMode: 'complete' })).toBe(true);
    expect(isPointsScored({ scoreMode: 'points' })).toBe(true);
    expect(isPointsScored({ scoreMode: 'proficiency' })).toBe(false);
  });

  it('counts a 0 as graded on points and Complete/Incomplete work only', () => {
    expect(isScoreEntered({ scoreMode: 'complete' }, { score: 0 })).toBe(true);
    expect(isScoreEntered({ scoreMode: 'points' }, { score: 0 })).toBe(true);
    expect(isScoreEntered({ scoreMode: 'points' }, { score: null })).toBe(false);
    expect(isScoreEntered({ scoreMode: 'proficiency' }, { score: 0 })).toBe(false);
    expect(isScoreEntered({ scoreMode: 'complete' }, null)).toBe(false);
  });
});

describe('marks', () => {
  const CID = '11111111-1111-4111-8111-111111111111';
  const ENR = '22222222-2222-4222-8222-222222222222';
  const AID = '44444444-4444-4444-8444-444444444444';
  const TAG = '77777777-7777-4777-8777-777777777777';
  let fake, originalGetSupabase, originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    const assessments = [
      { id: AID, title: 'Homework', type: 'summative', tagIds: [TAG], scoreMode: 'complete', maxPoints: 1 },
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

  it('stores Complete as 1 and Incomplete as 0', async () => {
    setCompletionMark(CID, ENR, AID, 'complete');
    expect(getCompletionMark(CID, ENR, AID)).toBe('complete');
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_value === 1)).toBe(1);

    setCompletionMark(CID, ENR, AID, 'incomplete');
    expect(getCompletionMark(CID, ENR, AID)).toBe('incomplete');
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_value === 0)).toBe(1);
  });

  it('clears a mark with no value, not 0', async () => {
    setCompletionMark(CID, ENR, AID, 'complete');
    await settle();
    setCompletionMark(CID, ENR, AID, null);
    expect(getCompletionMark(CID, ENR, AID)).toBeNull();
    await settle();
    expect(fake.committedCount('upsert_score', p => p.p_value === null)).toBe(1);
    expect(fake.committedCount('upsert_score', p => p.p_value === 0)).toBe(0);
  });
});
