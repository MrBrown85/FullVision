/**
 * A score retyped after a rejected clear survives the next page load (Nov 3
 * bug sweep, Step 4, group 1). The phone cleared Mateo's 17; the server
 * rejected the clear, so it went to the dead letter and the baseline went
 * back to 17. The teacher typed 17 again: the cell now matched the server,
 * so nothing was sent and the rejected clear stayed. The next page load sent
 * it once more, and the 17 was gone.
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
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });

const CID = '11111111-1111-4111-8111-111111111111';
const ENR = '22222222-2222-4222-8222-222222222222';
const AID = '44444444-4444-4444-8444-444444444444';
const TAG1 = '77777777-7777-4777-8777-777777777771';
const TAG2 = '77777777-7777-4777-8777-777777777772';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
  _rememberServerState(field, CID, value);
}

const points = (tagId, score) => ({
  id: 'e' + tagId,
  assessmentId: AID,
  tagId,
  score,
  date: '2026-11-03',
  type: 'formative',
  note: '',
});

describe('a points score cleared, the clear rejected, then typed again', () => {
  let fake, server, originalGetSupabase, originalUseSupabase;

  // The server's value for the cell. The first upsert_score (the clear) is
  // rejected; every later one lands.
  function serverRejectsFirstWrite() {
    let n = 0;
    fake.on('upsert_score', p => {
      n += 1;
      if (n === 1) return { data: null, error: { code: 'P0001', message: 'rejected' } };
      server = p.p_value;
      return { data: 'score-id', error: null };
    });
  }

  async function sendAll() {
    await window.v2Queue.flush();
    await settle();
  }

  // A page load: a fresh outbox over the same localStorage sends each
  // rejected write once more.
  async function reload() {
    window.v2Queue.release();
    runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
    await sendAll();
  }

  const upsertValues = () => fake.calls.filter(c => c.name === 'upsert_score').map(c => c.params.p_value);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: 'teacher-uuid' } }));
    _serverState = {};
    seed('students', [{ id: ENR, firstName: 'Mateo', lastName: 'Alvarez' }]);
    seed('assessments', [
      { id: AID, title: 'Unit 1 Quiz', date: '2026-11-03', scoreMode: 'points', maxPoints: 20, tagIds: [TAG1, TAG2] },
    ]);
    seed('scores', { [ENR]: [points(TAG1, 17), points(TAG2, 17)] });
    server = 17;
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    serverRejectsFirstWrite();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('keeps the retyped score after a reload', async () => {
    setPointsScore(CID, ENR, AID, null);
    await sendAll();
    expect(window.v2Queue.deadLetter()).toHaveLength(1);

    setPointsScore(CID, ENR, AID, 17);
    await sendAll();
    expect(getPointsScore(CID, ENR, AID)).toBe(17);
    // The server still has 17; the rejected clear is out of date.
    expect(window.v2Queue.deadLetter()).toHaveLength(0);

    await reload();
    expect(upsertValues()).toEqual([null]);
    expect(server).toBe(17);
  });

  it('sends a different retyped score, which replaces the rejected clear', async () => {
    setPointsScore(CID, ENR, AID, null);
    await sendAll();
    setPointsScore(CID, ENR, AID, 18);
    await sendAll();
    await reload();
    expect(upsertValues()).toEqual([null, 18]);
    expect(server).toBe(18);
  });

  it('still sends the clear again while the cell stays cleared', async () => {
    setPointsScore(CID, ENR, AID, null);
    await sendAll();
    // Some other edit saves the class's scores; the cell still differs from
    // the server, so the clear stays to be sent again.
    setPointsScore(CID, '33333333-3333-4333-8333-333333333333', AID, 5);
    await sendAll();
    expect(getPointsScore(CID, ENR, AID)).toBe(null);
    expect(upsertValues().filter(v => v === null).length).toBeGreaterThanOrEqual(1);
    expect(server).toBe(null);
  });
});
