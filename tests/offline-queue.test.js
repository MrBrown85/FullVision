/**
 * v2 offline write queue tests — shared/offline-queue.js (Phase 4.10)
 *
 * Covers window.v2Queue surface:
 *   enqueue           — basic add, invalid-endpoint reject, queue-cap enforcement
 *   flush             — success path, failure→backoff, dead-letter after MAX_ATTEMPTS
 *   stats             — queued/deadLettered/online snapshot
 *   deadLetter        — returns current dead list
 *   dismissDeadLetter — removes one entry
 *   clear             — wipes both stores
 *   callOrEnqueue     — online-direct, network-error-fallback-to-enqueue, offline-enqueue
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

// Load the offline queue module once — it self-installs window.v2Queue
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const Q = window.v2Queue;

function setOnline(v) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return v;
    },
  });
}

describe('v2Queue (offline write queue)', () => {
  var originalGetSupabase;
  var originalSetTimeout;
  var calls;

  beforeEach(() => {
    localStorage.clear();
    Q.clear();
    calls = [];
    originalGetSupabase = globalThis.getSupabase;
    // Speed up flush backoff: the module awaits setTimeout for backoff delays.
    // Replace with an immediate-firing stub so tests don't wait real seconds.
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = function (fn) {
      fn();
      return 0;
    };
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name: name, payload: payload });
        return Promise.resolve({ data: 'ok', error: null });
      },
    });
    setOnline(false); // offline by default so enqueue doesn't auto-flush
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    globalThis.setTimeout = originalSetTimeout;
    setOnline(false);
    Q.clear();
  });

  describe('enqueue', () => {
    it('adds a well-formed entry to the queue', () => {
      var res = Q.enqueue('upsert_score', { p_value: 3 });
      expect(res.ok).toBe(true);
      expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Q.stats().queued).toBe(1);
    });

    it('rejects invalid endpoint', () => {
      var res = Q.enqueue('', { p: 1 });
      expect(res).toEqual({ ok: false, reason: 'invalid_endpoint' });
      expect(Q.stats().queued).toBe(0);
    });

    it('rejects when the queue is at MAX_ENTRIES', () => {
      for (var i = 0; i < Q.MAX_ENTRIES; i++) Q.enqueue('rpc', { i: i });
      var res = Q.enqueue('rpc', { overflow: true });
      expect(res).toEqual({ ok: false, reason: 'queue_full' });
    });
  });

  describe('subscribe', () => {
    it('notifies queue listeners as the queue changes', async () => {
      var events = [];
      var unsubscribe = Q.subscribe(function (event) {
        events.push({
          kind: event.kind,
          queued: event.stats.queued,
          deadLettered: event.stats.deadLettered,
          flushing: event.stats.flushing,
        });
      });

      Q.enqueue('rpc', { a: 1 });
      expect(events[0]).toMatchObject({ kind: 'enqueue', queued: 1, deadLettered: 0, flushing: false });

      setOnline(true);
      await Q.flush();
      expect(
        events.some(function (event) {
          return event.kind === 'flush:start' && event.flushing === true;
        }),
      ).toBe(true);
      expect(
        events.some(function (event) {
          return event.kind === 'flush:success' && event.queued === 0;
        }),
      ).toBe(true);
      expect(events[events.length - 1]).toMatchObject({
        kind: 'flush:end',
        queued: 0,
        deadLettered: 0,
        flushing: false,
      });

      var countBeforeUnsubscribe = events.length;
      unsubscribe();
      Q.clear();
      expect(events).toHaveLength(countBeforeUnsubscribe);
    });
  });

  describe('flush', () => {
    it('no-ops while offline', async () => {
      Q.enqueue('rpc', {});
      setOnline(false);
      var res = await Q.flush();
      expect(res.note).toBe('offline');
      expect(calls).toHaveLength(0);
      expect(Q.stats().queued).toBe(1);
    });

    it('drains every queued entry on success', async () => {
      Q.enqueue('rpc1', { a: 1 });
      Q.enqueue('rpc2', { a: 2 });
      setOnline(true);
      var res = await Q.flush();
      expect(res.succeeded).toBe(2);
      expect(res.deadLettered).toBe(0);
      expect(Q.stats().queued).toBe(0);
      expect(Q.stats().lastFlushAt).not.toBeNull();
      expect(
        calls.map(function (c) {
          return c.name;
        }),
      ).toEqual(['rpc1', 'rpc2']);
    });

    it('dead-letters an entry after MAX_ATTEMPTS failures', async () => {
      Q.enqueue('bad_rpc', {});
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc() {
          return Promise.resolve({ data: null, error: { message: 'boom' } });
        },
      });
      // Each flush() attempt increments; when attempts === MAX_ATTEMPTS (3)
      // the entry is moved to dead-letter. We drive the attempts manually so
      // we don't wait for the real backoff delays.
      for (var i = 0; i < Q.MAX_ATTEMPTS; i++) {
        await Q.flush();
      }
      expect(Q.stats().queued).toBe(0);
      expect(Q.stats().deadLettered).toBe(1);
      expect(Q.deadLetter()[0].last_error).toBe('boom');
    });

    it('a single failing entry does not block later entries', async () => {
      Q.enqueue('fails', {});
      Q.enqueue('works', {});
      setOnline(true);
      // Fail the first, succeed the rest after we've exhausted attempts
      var callCount = 0;
      globalThis.getSupabase = () => ({
        rpc(name) {
          callCount++;
          if (name === 'fails') return Promise.resolve({ data: null, error: { message: 'nope' } });
          return Promise.resolve({ data: 'ok', error: null });
        },
      });
      // Force the failing entry through its 3 attempts
      for (var i = 0; i < Q.MAX_ATTEMPTS; i++) await Q.flush();
      // Now the 'works' entry should be processed on the next flush
      await Q.flush();
      expect(Q.stats().queued).toBe(0);
      expect(Q.stats().deadLettered).toBe(1);
    });
  });

  describe('deadLetter / dismissDeadLetter', () => {
    it('dismissDeadLetter removes one entry by id', async () => {
      Q.enqueue('bad', {});
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc() {
          return Promise.resolve({ data: null, error: { message: 'x' } });
        },
      });
      for (var i = 0; i < Q.MAX_ATTEMPTS; i++) await Q.flush();
      var dead = Q.deadLetter();
      expect(dead).toHaveLength(1);
      var remaining = Q.dismissDeadLetter(dead[0].id);
      expect(remaining).toBe(0);
      expect(Q.deadLetter()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('wipes both the queue and the dead letter', async () => {
      Q.enqueue('a', {});
      Q.clear();
      expect(Q.stats().queued).toBe(0);
      expect(Q.stats().deadLettered).toBe(0);
    });
  });

  describe('callOrEnqueue', () => {
    it('calls the RPC directly when online and succeeds', async () => {
      setOnline(true);
      var res = await Q.callOrEnqueue('rpc', { x: 1 });
      expect(res.ok).toBe(true);
      expect(res.enqueued).toBe(false);
      expect(calls).toEqual([{ name: 'rpc', payload: { x: 1 } }]);
      expect(Q.stats().queued).toBe(0);
    });

    it('enqueues when offline', async () => {
      setOnline(false);
      var res = await Q.callOrEnqueue('rpc', { x: 1 });
      expect(res.ok).toBe(false);
      expect(res.enqueued).toBe(true);
      expect(res.reason).toBe('offline');
      expect(Q.stats().queued).toBe(1);
    });

    it('enqueues on network-shaped error from the RPC', async () => {
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc() {
          return Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });
        },
      });
      var res = await Q.callOrEnqueue('rpc', {});
      expect(res.ok).toBe(false);
      expect(res.enqueued).toBe(true);
      expect(res.reason).toBe('network');
    });

    it('returns ok:false without enqueueing on non-network errors (validation/auth)', async () => {
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc() {
          return Promise.resolve({ data: null, error: { message: 'row-level security violation' } });
        },
      });
      var res = await Q.callOrEnqueue('rpc', {});
      expect(res.ok).toBe(false);
      expect(res.enqueued).toBe(false);
    });

    it('enqueues when Supabase is unavailable even if navigator.onLine is true', async () => {
      setOnline(true);
      globalThis.getSupabase = () => null;
      var res = await Q.callOrEnqueue('rpc', {});
      expect(res.enqueued).toBe(true);
      expect(res.reason).toBe('offline');
    });
  });
});
