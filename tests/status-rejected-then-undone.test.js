/**
 * A Missing mark the server rejected, then taken off, stays off after the
 * next page load (Nov 3 bug sweep, Step 4, group 1). The rejected
 * set_score_status went to the dead letter and the baseline went back to no
 * mark. Taking Missing off left the cell as the server had it, so nothing
 * was sent and the rejected mark stayed. The next page load sent it once
 * more, and the student was Missing again (a 0 in the grade).
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
const ENR2 = '33333333-3333-4333-8333-333333333333';
const AID = '44444444-4444-4444-8444-444444444444';
const TAG = '77777777-7777-4777-8777-777777777771';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
  _rememberServerState(field, CID, value);
}

describe('a status the server rejected, then changed back', () => {
  let fake, server, originalGetSupabase, originalUseSupabase;

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

  const sentFor = enr =>
    fake.calls
      .filter(c => c.name === 'set_score_status' && c.params.p_enrollment_id === enr)
      .map(c => c.params.p_status);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: 'teacher-uuid' } }));
    _serverState = {};
    seed('students', [
      { id: ENR, firstName: 'Mateo', lastName: 'Alvarez' },
      { id: ENR2, firstName: 'Liam', lastName: 'Nakamura' },
    ]);
    seed('assessments', [
      { id: AID, title: 'Unit 1 Quiz', date: '2026-11-03', scoreMode: 'points', maxPoints: 20, tagIds: [TAG] },
    ]);
    seed('scores', {});
    seed('statuses', {});
    server = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    // The first set_score_status is rejected; every later one lands.
    let n = 0;
    fake.on('set_score_status', p => {
      n += 1;
      if (n === 1) return { data: null, error: { code: 'P0001', message: 'rejected' } };
      server[p.p_enrollment_id] = p.p_status;
      return { data: null, error: null };
    });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('keeps Missing off after a reload', async () => {
    setAssignmentStatus(CID, ENR, AID, 'NS');
    await sendAll();
    expect(window.v2Queue.deadLetter()).toHaveLength(1);

    setAssignmentStatus(CID, ENR, AID, null);
    await sendAll();
    expect(getAssignmentStatus(CID, ENR, AID)).toBe(null);
    // The server never had Missing; the rejected mark is out of date.
    expect(window.v2Queue.deadLetter()).toHaveLength(0);

    await reload();
    expect(sentFor(ENR)).toEqual(['NS']);
    expect(server[ENR]).toBeUndefined();
  });

  it('still sends the rejected mark again while the cell keeps it', async () => {
    setAssignmentStatus(CID, ENR, AID, 'NS');
    await sendAll();
    // Another student's mark saves the class's statuses; Mateo's still
    // differs from the server, so his goes again and lands.
    setAssignmentStatus(CID, ENR2, AID, 'LATE');
    await sendAll();
    expect(sentFor(ENR)).toEqual(['NS', 'NS']);
    expect(server[ENR]).toBe('NS');
    expect(server[ENR2]).toBe('LATE');
  });
});
