/**
 * Persistence degraded recovery (P6.1) — tests the retry-with-backoff,
 * enter/exit degraded mode, touched-course tracking, and replay-on-recovery
 * behavior added in shared/data.js.
 *
 * Background: a single transient bootstrap_teacher / list_teacher_courses
 * failure on init used to silently flip _useSupabase = false for the rest of
 * the session, dropping every subsequent write on the floor. This file pins
 * the new recovery contract so that regression doesn't reappear.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const CID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeBootstrapClient(opts) {
  opts = opts || {};
  var state = {
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
    _degradedTouchedCourses.clear();
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
    _degradedTouchedCourses.clear();
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

  describe('_saveCourseField touched-course tracking', () => {
    it('records the cid in _degradedTouchedCourses when degraded', () => {
      _enterDegradedMode(new Error('boom'));
      _saveCourseField('students', CID_A, []);
      expect(_degradedTouchedCourses.has(CID_A)).toBe(true);
    });

    it('does NOT record the cid when not degraded', () => {
      _supabaseDegraded = false;
      _saveCourseField('students', CID_A, []);
      expect(_degradedTouchedCourses.has(CID_A)).toBe(false);
    });

    it('records multiple distinct courses', () => {
      _enterDegradedMode(new Error('boom'));
      _saveCourseField('students', CID_A, []);
      _saveCourseField('scores', CID_B, {});
      expect(_degradedTouchedCourses.has(CID_A)).toBe(true);
      expect(_degradedTouchedCourses.has(CID_B)).toBe(true);
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

    it('clears _degradedTouchedCourses after recovery (replay consumes them)', async () => {
      _enterDegradedMode(new Error('boom'));
      _saveCourseField('students', CID_A, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [] }]);
      expect(_degradedTouchedCourses.has(CID_A)).toBe(true);

      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;
      await retrySupabaseRecovery();

      expect(_degradedTouchedCourses.size).toBe(0);
    });
  });

  describe('integration — silent dataloss regression guard', () => {
    it('writes during a degraded window are tracked, then replayed on recovery (canonical store catches up)', async () => {
      // Step 1: enter degraded mode (simulating a failed init).
      _useSupabase = true;
      _enterDegradedMode(new Error('init failed'));
      expect(_useSupabase).toBe(false);

      // Step 2: teacher writes during the degraded window.
      saveStudents(CID_A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      expect(_degradedTouchedCourses.has(CID_A)).toBe(true);
      // The save landed in LS but no canonical write fired (_useSupabase is false).
      expect(getStudents(CID_A)).toHaveLength(1);

      // Step 3: recovery probe succeeds.
      var client = makeBootstrapClient();
      globalThis.getSupabase = () => client;
      await retrySupabaseRecovery();

      // Step 4: post-recovery, the touched course was replayed and the LS data
      // is still present (replay re-invokes the diff-based save, which writes
      // LS again idempotently and dispatches the canonical delta).
      expect(_useSupabase).toBe(true);
      expect(_supabaseDegraded).toBe(false);
      expect(getStudents(CID_A)).toHaveLength(1);
    });
  });
});
