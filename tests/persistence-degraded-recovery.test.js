/**
 * Persistence degraded recovery (P6.1) — tests the retry-with-backoff,
 * enter/exit degraded mode, and send-on-recovery behavior in shared/data.js.
 * Writes made while degraded wait in the outbox (shared/offline-queue.js) and
 * go out when the recovery probe succeeds.
 *
 * Background: a single transient bootstrap_teacher / list_teacher_courses
 * failure on init used to silently flip _useSupabase = false for the rest of
 * the session, dropping every subsequent write on the floor. This file pins
 * the new recovery contract so that regression doesn't reappear.
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

const CID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeBootstrapClient(opts) {
  opts = opts || {};
  var state = {
    calls: [],
    bootstrapAttempts: 0,
    listAttempts: 0,
    bootstrapFailUntilAttempt: opts.bootstrapFailUntilAttempt || 0,
    courseRows: opts.courseRows || [],
  };
  return {
    state: state,
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: 'teach-1', email: 'a@b.com', user_metadata: { display_name: 'A' } } } },
        }),
    },
    rpc: function (name, _payload) {
      if (name === 'bootstrap_teacher') {
        state.bootstrapAttempts += 1;
        if (state.bootstrapAttempts <= state.bootstrapFailUntilAttempt) {
          return Promise.resolve({ error: { message: 'bootstrap failed', code: '500' } });
        }
        return Promise.resolve({
          data: { id: 'teach-1', email: 'a@b.com', preferences: { active_course_id: CID_A } },
          error: null,
        });
      }
      if (name === 'list_teacher_courses') {
        state.listAttempts += 1;
        return Promise.resolve({ data: state.courseRows, error: null });
      }
      state.calls.push(name);
      if (name === 'create_student_and_enroll') {
        return Promise.resolve({ data: { student_id: 'stu-1', enrollment_id: 'enr-1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('Persistence degraded recovery (P6.1)', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalShowSyncToast;
  var originalDismissSyncToast;
  var toastCalls;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    // Override the ui.js implementation (which manipulates the DOM and the
    // setup.js DOM stub doesn't implement .remove()). Capture calls so tests
    // can assert on them when needed.
    originalShowSyncToast = globalThis.showSyncToast;
    originalDismissSyncToast = globalThis.dismissSyncToast;
    toastCalls = [];
    globalThis.showSyncToast = function (msg, type) {
      toastCalls.push({ msg: msg, type: type });
    };
    globalThis.dismissSyncToast = function () {};
    _useSupabase = false;
    _supabaseDegraded = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    if (_recoveryProbeTimer) {
      clearTimeout(_recoveryProbeTimer);
      _recoveryProbeTimer = null;
    }
    _recoveryProbeInFlight = false;
    localStorage.clear();
    // Reset cache for both test courses
    Object.keys(_cache).forEach(function (k) {
      if (typeof _cache[k] === 'object' && _cache[k] !== null && !Array.isArray(_cache[k])) {
        if (_cache[k][CID_A] !== undefined) _cache[k][CID_A] = undefined;
        if (_cache[k][CID_B] !== undefined) _cache[k][CID_B] = undefined;
      }
    });
    globalThis.COURSES = {};
    globalThis.COURSES[CID_A] = {
      id: CID_A,
      name: 'A',
      gradingSystem: 'proficiency',
      calcMethod: 'mostRecent',
      decayWeight: 0.65,
    };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    globalThis.showSyncToast = originalShowSyncToast;
    globalThis.dismissSyncToast = originalDismissSyncToast;
    _useSupabase = originalUseSupabase;
    _supabaseDegraded = false;
    window.v2Queue.clear();
    if (_recoveryProbeTimer) {
      clearTimeout(_recoveryProbeTimer);
      _recoveryProbeTimer = null;
    }
    _recoveryProbeInFlight = false;
    vi.useRealTimers();
  });

  describe('_attemptInitialBootstrap', () => {
    it('resolves with teacher + courseRows on success', async () => {
      var client = makeBootstrapClient({ courseRows: [{ id: CID_A, name: 'A' }] });
      const data = await _attemptInitialBootstrap(client);
      expect(data.teacher.id).toBe('teach-1');
      expect(data.courseRows).toHaveLength(1);
      expect(client.state.bootstrapAttempts).toBe(1);
      expect(client.state.listAttempts).toBe(1);
    });

    it('rejects when bootstrap_teacher returns an error', async () => {
      var client = makeBootstrapClient({ bootstrapFailUntilAttempt: 1 });
      await expect(_attemptInitialBootstrap(client)).rejects.toBeDefined();
      expect(client.state.bootstrapAttempts).toBe(1);
    });
  });

  describe('_bootstrapWithRetry', () => {
    it('returns immediately when first attempt succeeds', async () => {
      var client = makeBootstrapClient();
      const data = await _bootstrapWithRetry(client);
      expect(data.teacher.id).toBe('teach-1');
      expect(client.state.bootstrapAttempts).toBe(1);
    });

    it('retries up to 4 attempts (1 initial + 3 retries)', async () => {
      vi.useFakeTimers();
      var client = makeBootstrapClient({ bootstrapFailUntilAttempt: 2 }); // fails twice, succeeds on attempt 3
      const promise = _bootstrapWithRetry(client);
      // The retry helper waits 1s/2s/4s between attempts; fast-forward.
      await vi.advanceTimersByTimeAsync(10000);
      const data = await promise;
      expect(data.teacher.id).toBe('teach-1');
      expect(client.state.bootstrapAttempts).toBe(3);
    });

    it('throws after all 4 attempts fail', async () => {
      vi.useFakeTimers();
      var client = makeBootstrapClient({ bootstrapFailUntilAttempt: 99 });
      const promise = _bootstrapWithRetry(client).catch(function (e) {
        return e;
      });
      await vi.advanceTimersByTimeAsync(10000);
      const err = await promise;
      expect(err).toBeDefined();
      expect(client.state.bootstrapAttempts).toBe(4);
    });
  });

  describe('_enterDegradedMode + state', () => {
    it('flips _useSupabase off, sets _supabaseDegraded, marks _syncStatus degraded', () => {
      _useSupabase = true;
      _enterDegradedMode(new Error('boom'));
      expect(_useSupabase).toBe(false);
      expect(_supabaseDegraded).toBe(true);
      expect(getSyncStatus().status).toBe('degraded');
      expect(isSupabaseDegraded()).toBe(true);
    });

    it('schedules a recovery probe timer', () => {
      _enterDegradedMode(new Error('boom'));
      expect(_recoveryProbeTimer).not.toBe(null);
    });
  });

  describe('writes while degraded', () => {
    it('are held in the outbox, not sent', async () => {
      _enterDegradedMode(new Error('boom'));
      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;

      saveStudents(CID_A, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
      // The student save dispatches on the next microtask.
      await new Promise(r => setImmediate(r));

      expect(client.state.calls).toEqual([]);
      expect(window.v2Queue.stats().queued).toBe(1);
    });

    it('stay local in demo mode', () => {
      _enterDegradedMode(new Error('boom'));
      localStorage.setItem('gb-demo-mode', '1');
      saveStudents(CID_A, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
      expect(window.v2Queue.stats().queued).toBe(0);
    });
  });

  describe('retrySupabaseRecovery + _exitDegradedMode', () => {
    it('no-ops when not degraded', async () => {
      _supabaseDegraded = false;
      const result = await retrySupabaseRecovery();
      expect(result).toBeUndefined();
    });

    it('flips _useSupabase back to true on successful probe', async () => {
      _enterDegradedMode(new Error('boom'));
      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;

      await retrySupabaseRecovery();

      expect(_supabaseDegraded).toBe(false);
      expect(_useSupabase).toBe(true);
      expect(getSyncStatus().status).toBe('idle');
      expect(client.state.bootstrapAttempts).toBe(1);
    });

    it('stays degraded if probe fails again', async () => {
      _enterDegradedMode(new Error('boom'));
      var client = makeBootstrapClient({ bootstrapFailUntilAttempt: 99 });
      globalThis.getSupabase = () => client;

      await retrySupabaseRecovery();

      expect(_supabaseDegraded).toBe(true);
      expect(_useSupabase).toBe(false);
    });

    it('sends the writes held while degraded once recovery succeeds', async () => {
      _enterDegradedMode(new Error('boom'));
      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;
      saveStudents(CID_A, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
      expect(client.state.calls).toEqual([]);

      await retrySupabaseRecovery();
      await window.v2Queue.flush();

      expect(client.state.calls).toContain('create_student_and_enroll');
      expect(window.v2Queue.stats().queued).toBe(0);
    });
  });

  describe('integration — silent dataloss regression guard', () => {
    it('writes during a degraded window are held, then sent on recovery (canonical store catches up)', async () => {
      // Step 1: enter degraded mode (simulating a failed init).
      _useSupabase = true;
      _enterDegradedMode(new Error('init failed'));
      expect(_useSupabase).toBe(false);

      // Step 2: teacher writes during the degraded window.
      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;
      saveStudents(CID_A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      // The save landed in LS; the enrollment waits in the outbox.
      expect(getStudents(CID_A)).toHaveLength(1);
      expect(client.state.calls).not.toContain('create_student_and_enroll');

      // Step 3: recovery probe succeeds and the outbox drains.
      await retrySupabaseRecovery();
      await window.v2Queue.flush();

      // Step 4: the enrollment reached the server and the local student got
      // its canonical id.
      expect(_useSupabase).toBe(true);
      expect(_supabaseDegraded).toBe(false);
      expect(client.state.calls).toContain('create_student_and_enroll');
      expect(getStudents(CID_A)[0].id).toBe('enr-1');
    });
  });
});
