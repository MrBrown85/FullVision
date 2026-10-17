/**
 * Per-entry backoff — shared/offline-queue.js
 *
 * Each failing write waits 1s, 5s, 30s, then 60s between tries, counted from
 * its own last failure. The retry timer sends only the entries that are due,
 * so one write coming due does not send every other failing write early, and
 * a write that fails while a later wake is set still gets its 1s retry.
 * An explicit flush() still sends everything at once.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const Q = window.v2Queue;
const ASSESSMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CELL_A = '11111111-1111-4111-8111-111111111111';
const CELL_B = '22222222-2222-4222-8222-222222222222';
const CELL_C = '33333333-3333-4333-8333-333333333333';

function setOnline(v) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return v;
    },
  });
}

describe('v2Queue per-entry backoff', () => {
  var originalGetSupabase;
  var calls;
  var start;

  beforeEach(async () => {
    // This tab sends once it holds the lock, which it asks for at load.
    await vi.waitFor(() => expect(Q.stats().owner).toBe(true));
    vi.useFakeTimers();
    localStorage.clear();
    Q.clear();
    calls = [];
    start = Date.now();
    originalGetSupabase = globalThis.getSupabase;
    // Every write fails like a 504.
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ cell: payload.p_enrollment_id, at: Date.now() - start });
        return Promise.resolve({ data: null, error: { message: 'timeout', code: '504' }, status: 504 });
      },
    });
    setOnline(true);
  });

  afterEach(() => {
    setOnline(false);
    Q.clear();
    vi.useRealTimers();
    globalThis.getSupabase = originalGetSupabase;
  });

  function save(cell) {
    Q.push('upsert_score', { p_enrollment_id: cell, p_assessment_id: ASSESSMENT, p_value: 3 });
  }

  function triesOf(cell) {
    return calls.filter(c => c.cell === cell).map(c => c.at);
  }

  it('retries each failing cell on its own schedule', async () => {
    save(CELL_A);
    await vi.advanceTimersByTimeAsync(2000);
    save(CELL_B);
    await vi.advanceTimersByTimeAsync(1500);
    save(CELL_C);
    await vi.advanceTimersByTimeAsync(40000 - 3500);

    // First try, then 1s, 5s and 30s after each failure.
    expect(triesOf(CELL_A)).toEqual([0, 1000, 6000, 36000]);
    expect(triesOf(CELL_B)).toEqual([2000, 3000, 8000, 38000]);
    expect(triesOf(CELL_C)).toEqual([3500, 4500, 9500, 39500]);
    expect(Q.stats().queued).toBe(3);
  });

  it('flush() still sends every queued write at once, whatever its backoff', async () => {
    save(CELL_A);
    await vi.advanceTimersByTimeAsync(2000); // A: tries at 0 and 1000, next at 6000
    save(CELL_B);
    await vi.advanceTimersByTimeAsync(100); // B: try at 2000, next at 3000
    calls = [];

    await Q.flush();

    expect(calls.map(c => c.cell).sort()).toEqual([CELL_A, CELL_B]);
  });
});
