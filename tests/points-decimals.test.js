/**
 * Points scores take decimals: 33.5 / 40 (requested 2026-10-14).
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

describe('parsePointsInput', () => {
  it('keeps decimals', () => {
    expect(parsePointsInput('33.5', 40)).toBe(33.5);
    expect(parsePointsInput('12.25', 40)).toBe(12.25);
  });

  it('accepts a comma as the decimal point', () => {
    expect(parsePointsInput('33,5', 40)).toBe(33.5);
  });

  it('rounds to two places and holds the value between 0 and the maximum', () => {
    expect(parsePointsInput('7.126', 10)).toBe(7.13);
    expect(parsePointsInput('45', 40)).toBe(40);
    expect(parsePointsInput('-2', 40)).toBe(0);
  });

  it('reads blank or unreadable input as no score, and a typed 0 as 0', () => {
    expect(parsePointsInput('', 40)).toBeNull();
    expect(parsePointsInput('  ', 40)).toBeNull();
    expect(parsePointsInput('abc', 40)).toBeNull();
    expect(parsePointsInput('0', 40)).toBe(0);
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
