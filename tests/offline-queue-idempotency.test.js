/**
 * Idempotency contract for shared/offline-queue.js.
 *
 * Guards the client-side half of migration 20260423_write_path_idempotency:
 *   • Retrofitted endpoints (the IDEMPOTENT_ENDPOINTS allowlist) receive
 *     `p_idempotency_key` on every flush. The key is the queue entry id.
 *   • Non-retrofitted endpoints MUST NOT receive p_idempotency_key — the
 *     server RPC would 404 on the unknown param name.
 *   • On retry after a failure, the same entry sends the same key.
 *   • callOrEnqueue uses a single key across the direct call and any
 *     fallback enqueue, so a network-blip retry returns the cached row id
 *     instead of creating a duplicate.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const Q = window.v2Queue;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setOnline(v) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return v;
    },
  });
}

describe('offline-queue idempotency key', () => {
  var originalGetSupabase;
  var originalSetTimeout;
  var calls;
  var rpcImpl;

  beforeEach(() => {
    localStorage.clear();
    Q.clear();
    calls = [];
    rpcImpl = () => Promise.resolve({ data: 'ok', error: null });

    originalGetSupabase = globalThis.getSupabase;
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = function (fn) {
      fn();
      return 0;
    };
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload });
        return rpcImpl(name, payload);
      },
    });
    setOnline(false);
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    globalThis.setTimeout = originalSetTimeout;
    setOnline(false);
    Q.clear();
  });

  describe('flush — retrofitted endpoints', () => {
    it('injects p_idempotency_key = entry.id when flushing create_observation', async () => {
      const enq = Q.enqueue('create_observation', { p_course_id: 'c1', p_body: 'hello' });
      expect(enq.ok).toBe(true);
      setOnline(true);

      const res = await Q.flush();

      expect(res.succeeded).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('create_observation');
      expect(calls[0].payload.p_idempotency_key).toBe(enq.id);
      expect(calls[0].payload.p_idempotency_key).toMatch(UUID_RE);
      // Original payload fields are preserved unchanged.
      expect(calls[0].payload.p_course_id).toBe('c1');
      expect(calls[0].payload.p_body).toBe('hello');
    });

    it('injects key for every retrofitted endpoint in the allowlist', async () => {
      const endpoints = [
        'create_observation',
        'create_assessment',
        'duplicate_assessment',
        'create_custom_tag',
        'upsert_note',
        'create_student_and_enroll',
      ];
      const ids = endpoints.map((e, i) => Q.enqueue(e, { i }).id);
      setOnline(true);

      await Q.flush();

      expect(calls).toHaveLength(endpoints.length);
      for (let i = 0; i < endpoints.length; i++) {
        expect(calls[i].name).toBe(endpoints[i]);
        expect(calls[i].payload.p_idempotency_key).toBe(ids[i]);
      }
    });
  });

  describe('flush — non-retrofitted endpoints', () => {
    it('does NOT inject p_idempotency_key for upsert_score (natural-key upsert)', async () => {
      Q.enqueue('upsert_score', { p_value: 3 });
      setOnline(true);

      await Q.flush();

      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('upsert_score');
      expect(calls[0].payload.p_idempotency_key).toBeUndefined();
      expect(calls[0].payload.p_value).toBe(3);
    });

    it('does NOT inject for update_observation (update-by-id, not at risk)', async () => {
      Q.enqueue('update_observation', { p_id: 'x', p_patch: {} });
      setOnline(true);

      await Q.flush();

      expect(calls[0].payload.p_idempotency_key).toBeUndefined();
    });
  });

  describe('flush — retry-after-failure', () => {
    it('sends the same idempotency key on attempts 1 and 2 of the same entry', async () => {
      let n = 0;
      rpcImpl = () => {
        n++;
        if (n === 1) return Promise.resolve({ data: null, error: { message: 'transient network' } });
        return Promise.resolve({ data: 'ok', error: null });
      };

      const enq = Q.enqueue('create_observation', { p_body: 'retry-me' });
      setOnline(true);

      // First flush: fails, entry stays in queue with attempts=1.
      await Q.flush();
      // Second flush: succeeds.
      await Q.flush();

      expect(calls).toHaveLength(2);
      expect(calls[0].payload.p_idempotency_key).toBe(enq.id);
      expect(calls[1].payload.p_idempotency_key).toBe(enq.id);
      expect(calls[0].payload.p_idempotency_key).toBe(calls[1].payload.p_idempotency_key);
    });

    it('sends the same key on every retry until the entry is dead-lettered', async () => {
      rpcImpl = () => Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });

      const enq = Q.enqueue('create_observation', { p_body: 'permanently-broken' });
      setOnline(true);

      // A network error retries (setTimeout is immediate here) until
      // MAX_ATTEMPTS, then the entry is dead-lettered.
      await Q.flush();

      expect(calls.length).toBeGreaterThanOrEqual(3);
      const keys = calls.map(c => c.payload.p_idempotency_key);
      const uniq = Array.from(new Set(keys));
      expect(uniq).toEqual([enq.id]);
      expect(Q.stats().deadLettered).toBe(1);
    });
  });

  describe('callOrEnqueue', () => {
    it('generates an idempotency key and passes it on a direct online call', async () => {
      setOnline(true);

      await Q.callOrEnqueue('upsert_note', { p_enrollment_id: 'e', p_body: 'hi' });

      expect(calls).toHaveLength(1);
      expect(calls[0].payload.p_idempotency_key).toMatch(UUID_RE);
    });

    it('reuses the direct-call key for the enqueued retry on network error', async () => {
      // Every rpc call returns a network error so the direct call falls
      // through to enqueue, and the enqueue-triggered auto-flush retries.
      rpcImpl = () => Promise.resolve({ data: null, error: { message: 'fetch failed' } });
      setOnline(true);

      const result = await Q.callOrEnqueue('create_observation', { p_body: 'will-enqueue' });

      expect(result.enqueued).toBe(true);
      // At minimum: direct call + first auto-flush retry = 2 calls, same key.
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const directKey = calls[0].payload.p_idempotency_key;
      expect(directKey).toMatch(UUID_RE);
      for (const c of calls) {
        expect(c.payload.p_idempotency_key).toBe(directKey);
      }

      // A later successful drain must use the same key too.
      rpcImpl = () => Promise.resolve({ data: 'ok', error: null });
      await Q.flush();
      const last = calls[calls.length - 1];
      expect(last.payload.p_idempotency_key).toBe(directKey);
    });

    it('does not inject a key for non-retrofitted endpoints', async () => {
      setOnline(true);

      await Q.callOrEnqueue('upsert_score', { p_value: 2 });

      expect(calls).toHaveLength(1);
      expect(calls[0].payload.p_idempotency_key).toBeUndefined();
    });
  });
});
