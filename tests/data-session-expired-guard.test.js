import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('session-expired long-form guard', () => {
  var originalGetSupabase;
  var originalRefreshSupabaseSession;
  var originalShowSessionExpiredToast;
  var originalQueueSessionExpiredRetry;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalRefreshSupabaseSession = globalThis.refreshSupabaseSession;
    originalShowSessionExpiredToast = globalThis.showSessionExpiredToast;
    originalQueueSessionExpiredRetry = window.UI.queueSessionExpiredRetry;
    globalThis.showSessionExpiredToast = vi.fn();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    globalThis.refreshSupabaseSession = originalRefreshSupabaseSession;
    globalThis.showSessionExpiredToast = originalShowSessionExpiredToast;
    window.UI.queueSessionExpiredRetry = originalQueueSessionExpiredRetry;
    if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext();
    vi.restoreAllMocks();
  });

  it('silently refreshes and retries long-form saves before prompting again', async () => {
    var calls = 0;
    globalThis.getSupabase = function () {
      return {
        rpc() {
          calls++;
          if (calls === 1) return Promise.resolve({ data: null, error: { status: 401, message: 'JWT expired' } });
          return Promise.resolve({ data: { ok: true }, error: null });
        },
      };
    };
    globalThis.refreshSupabaseSession = vi.fn(async function () {
      return { session: { access_token: 'fresh-token' } };
    });
    window.UI.queueSessionExpiredRetry = vi.fn();
    setLongFormAuthContext({
      kind: 'term-rating',
      getDraftText() {
        return 'Draft';
      },
    });

    var res = await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, {
      narrativeHtml: '<p>Draft</p>',
    });

    expect(globalThis.refreshSupabaseSession).toHaveBeenCalledTimes(1);
    expect(window.UI.queueSessionExpiredRetry).not.toHaveBeenCalled();
    expect(calls).toBe(2);
    expect(res.error).toBeNull();
  });

  it('queues the retry behind the long-form modal when refresh fails', async () => {
    globalThis.getSupabase = function () {
      return {
        rpc() {
          return Promise.resolve({ data: null, error: { status: 401, message: 'refresh token expired' } });
        },
      };
    };
    globalThis.refreshSupabaseSession = vi.fn(async function () {
      throw new Error('refresh failed');
    });
    window.UI.queueSessionExpiredRetry = vi.fn();
    setLongFormAuthContext({
      kind: 'term-rating',
      getDraftText() {
        return 'Half written narrative';
      },
    });

    var res = await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, {
      narrativeHtml: '<p>Draft</p>',
    });

    expect(window.UI.queueSessionExpiredRetry).toHaveBeenCalledTimes(1);
    expect(window.UI.queueSessionExpiredRetry.mock.calls[0][0].key).toContain('save_term_rating');
    expect(res.error && res.error.handledSessionExpired).toBe(true);
  });

  it('uses the same long-form retry path when idle timeout already marked the draft session expired', async () => {
    var calls = 0;
    globalThis.getSupabase = function () {
      return {
        rpc() {
          calls++;
          return Promise.resolve({ data: { ok: true }, error: null });
        },
      };
    };
    globalThis.refreshSupabaseSession = vi.fn();
    window.UI.queueSessionExpiredRetry = vi.fn();
    setLongFormAuthContext({
      kind: 'observation-capture',
      getDraftText() {
        return 'Observation draft';
      },
    });
    markLongFormSessionExpired();

    var res = await window.createObservationRich({
      courseId: '11111111-1111-1111-1111-111111111111',
      body: 'Observation draft',
      enrollmentIds: ['22222222-2222-2222-2222-222222222222'],
    });

    expect(calls).toBe(0);
    expect(window.UI.queueSessionExpiredRetry).toHaveBeenCalledTimes(1);
    expect(res.error && res.error.handledSessionExpired).toBe(true);
  });
});
