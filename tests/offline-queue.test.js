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

  // push() is the write path shared/data.js uses for every RPC.
  describe('push', () => {
    it('sends at once and resolves with the server result', async () => {
      setOnline(true);
      var res = await Q.push('update_student', { p_id: 'st-1', p_patch: {} });
      expect(res).toEqual({ data: 'ok', error: null });
      expect(calls).toHaveLength(1);
      expect(Q.stats().queued).toBe(0);
    });

    it('waits while offline and resolves once the write gets through', async () => {
      setOnline(false);
      var settled = false;
      var p = Q.push('update_student', { p_id: 'st-1', p_patch: {} }).then(function (res) {
        settled = true;
        return res;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(Q.stats().queued).toBe(1);

      setOnline(true);
      await Q.flush();
      expect(await p).toEqual({ data: 'ok', error: null });
    });

    it('retries a network error and resolves with the eventual success', async () => {
      setOnline(true);
      var n = 0;
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          calls.push({ name: name, payload: payload });
          n++;
          if (n < 3) return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
          return Promise.resolve({ data: 'saved', error: null });
        },
      });
      var res = await Q.push('update_student', { p_id: 'st-1', p_patch: {} });
      expect(res.data).toBe('saved');
      expect(calls).toHaveLength(3);
      expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    });

    it('dead-letters a validation error at once instead of retrying it', async () => {
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          calls.push({ name: name, payload: payload });
          return Promise.resolve({ data: null, error: { code: '23514', message: 'violates check constraint' } });
        },
      });
      var res = await Q.push('upsert_tag_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 9 });
      expect(res.error.code).toBe('23514');
      expect(calls).toHaveLength(1);
      expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 1 });
    });

    it('sends writes to the same record in order, one at a time', async () => {
      setOnline(true);
      var release = [];
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          calls.push({ name: name, payload: payload });
          return new Promise(function (resolve) {
            release.push(function () {
              resolve({ data: 'ok', error: null });
            });
          });
        },
      });
      var cell = { p_enrollment_id: 'e1', p_assessment_id: 'a1' };
      var first = Q.push('upsert_tag_score', Object.assign({ p_value: 2 }, cell));
      var second = Q.push('upsert_tag_score', Object.assign({ p_value: 3 }, cell));
      var other = Q.push('upsert_tag_score', { p_enrollment_id: 'e2', p_assessment_id: 'a1', p_value: 4 });
      await Promise.resolve();

      // The second write to cell e1/a1 waits for the first; e2 doesn't.
      expect(
        calls.map(function (c) {
          return c.payload.p_value;
        }),
      ).toEqual([2, 4]);
      release.shift()();
      await first;
      await Promise.resolve();
      expect(calls[2].payload.p_value).toBe(3);
      release.splice(0).forEach(function (go) {
        go();
      });
      await Promise.all([second, other]);
    });

    it('treats deleting a row that is already gone as done', async () => {
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          calls.push({ name: name, payload: payload });
          return Promise.resolve({ data: null, error: { code: 'P0002', message: 'category not found' } });
        },
      });
      var res = await Q.push('delete_category', { p_id: 'cat-1' });
      expect(res.error).toBeNull();
      expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    });

    it('still reports a seed observation template that cannot be deleted', async () => {
      setOnline(true);
      globalThis.getSupabase = () => ({
        rpc() {
          return Promise.resolve({
            data: null,
            error: { code: 'P0002', message: 'observation_template not found or is seed (immutable)' },
          });
        },
      });
      var res = await Q.push('delete_observation_template', { p_id: 'tpl-1' });
      expect(res.error.code).toBe('P0002');
      expect(Q.stats().deadLettered).toBe(1);
    });

    it('holds writes while paused', async () => {
      setOnline(true);
      var paused = true;
      Q.configure({
        isPaused: function () {
          return paused;
        },
      });
      try {
        var p = Q.push('update_student', { p_id: 'st-1', p_patch: {} });
        await Promise.resolve();
        expect(calls).toHaveLength(0);
        paused = false;
        await Q.flush();
        await p;
        expect(calls).toHaveLength(1);
      } finally {
        Q.configure({
          isPaused: function () {
            return false;
          },
        });
      }
    });
  });

  // The queue lives in localStorage, so on a shared Chromebook it can outlast
  // a sign-out. One teacher's queued writes must never be sent under another
  // teacher's session.
  describe('owner', () => {
    var TEACHER_A = '11111111-1111-4111-8111-111111111111';
    var TEACHER_B = '22222222-2222-4222-8222-222222222222';

    function signInAs(id) {
      localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ access_token: 'x', user: { id: id } }));
    }
    function signOutLocally() {
      localStorage.removeItem('sb-testproject-auth-token');
    }

    it('stamps each entry with the signed-in user', () => {
      signInAs(TEACHER_A);
      Q.enqueue('rpc', { a: 1 });
      var stored = JSON.parse(localStorage.getItem('fv-sync-queue-v1'));
      expect(stored.entries[0].owner).toBe(TEACHER_A);
    });

    it("discards another teacher's queued and dead-lettered writes instead of sending them", async () => {
      signInAs(TEACHER_A);
      Q.enqueue('upsert_score', { mine: false });
      localStorage.setItem(
        'fv-sync-dead-letter-v1',
        JSON.stringify([{ id: 'd1', owner: TEACHER_A, endpoint: 'rpc', payload: {} }]),
      );
      signInAs(TEACHER_B);
      expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
      expect(Q.deadLetter()).toEqual([]);

      Q.enqueue('upsert_score', { mine: true });
      setOnline(true);
      await Q.flush();

      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toEqual({ mine: true });
      expect(JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem('fv-sync-dead-letter-v1'))).toEqual([]);
    });

    it("sends a teacher's own writes when they sign back in", async () => {
      signInAs(TEACHER_A);
      Q.enqueue('upsert_score', { v: 3 });
      signOutLocally();
      setOnline(true);
      await Q.flush();
      expect(calls).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries).toHaveLength(1);

      signInAs(TEACHER_A);
      await Q.flush();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toEqual({ v: 3 });
    });

    it('sends entries queued before owners existed under the current session', async () => {
      localStorage.setItem(
        'fv-sync-queue-v1',
        JSON.stringify({ entries: [{ id: 'legacy', endpoint: 'rpc', payload: { old: true }, attempts: 0 }] }),
      );
      signInAs(TEACHER_B);
      setOnline(true);
      await Q.flush();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toEqual({ old: true });
    });
  });
});
