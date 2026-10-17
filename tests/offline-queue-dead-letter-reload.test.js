/**
 * Failed writes after a page load — shared/offline-queue.js.
 *
 * A write the server rejected isn't listed for the teacher and doesn't hold
 * up refreshes, so it must not sit in the dead letter for good. On the next
 * page load the outbox sends each one once more; one rejected again, or one
 * that can't be retried, is dropped and reported to Sentry.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
const TEACHER_A = '11111111-1111-4111-8111-111111111111';
const TEACHER_B = '22222222-2222-4222-8222-222222222222';

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return value;
    },
  });
}

// A page load: a fresh copy of the module over the same localStorage. The
// page before is gone, so its copy lets go of the queue first. Offline while
// it loads, so its start-up flush stays quiet.
var page = null;
function loadPage() {
  if (page) page.release();
  setOnline(false);
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  page = window.v2Queue;
  return page;
}

function dead(id, endpoint, payload, extra) {
  return Object.assign(
    { id: id, owner: TEACHER_A, key: null, endpoint: endpoint, payload: payload, attempts: 1, last_error: 'rejected' },
    extra || {},
  );
}

function seedDead(entries) {
  localStorage.setItem('fv-sync-dead-letter-v1', JSON.stringify(entries));
}

describe('failed writes on the next page load', () => {
  var originalQueue;
  var originalSentry;
  var originalSetTimeout;

  beforeEach(() => {
    localStorage.clear();
    originalQueue = window.v2Queue;
    originalSentry = window.Sentry;
    originalSetTimeout = globalThis.setTimeout;
    // Backoff timers never fire; the tests drive every attempt with flush().
    globalThis.setTimeout = function () {
      return 0;
    };
    window.Sentry = { captureMessage: vi.fn() };
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: TEACHER_A } }));
  });

  afterEach(() => {
    window.v2Queue.clear();
    window.v2Queue = originalQueue;
    window.Sentry = originalSentry;
    globalThis.setTimeout = originalSetTimeout;
    setOnline(false);
  });

  it('sends a rejected write once more and keeps nothing when it lands', async () => {
    seedDead([dead('d1', 'update_assessment', { p_id: 'a1', p_patch: { title: 'Lab' } })]);
    var Q = loadPage();
    expect(Q.stats()).toMatchObject({ queued: 1, deadLettered: 0 });

    var sent = [];
    Q.configure({
      send: function (name, payload) {
        sent.push(name);
        return { data: null, error: null };
      },
    });
    setOnline(true);
    await Q.flush();

    expect(sent).toEqual(['update_assessment']);
    expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    expect(window.Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('drops a write rejected again and reports it', async () => {
    seedDead([dead('d1', 'update_assessment', { p_id: 'a1', p_patch: { title: 'Lab' } })]);
    var Q = loadPage();
    Q.configure({
      send: function () {
        return { data: null, error: { code: 'P0002', message: 'assessment not found' } };
      },
    });
    setOnline(true);
    await Q.flush();

    expect(Q.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    expect(window.Sentry.captureMessage).toHaveBeenCalledWith(
      'Outbox dropped update_assessment: assessment not found',
      'warning',
    );
  });

  it("drops what can't be retried, and leaves another teacher's failed writes alone", () => {
    localStorage.setItem(
      'fv-sync-queue-v1',
      JSON.stringify({
        entries: [
          {
            id: 'q1',
            owner: TEACHER_A,
            key: 'id:a2',
            endpoint: 'update_assessment',
            payload: { p_id: 'a2', p_patch: { title: 'Newer' } },
            attempts: 0,
          },
        ],
      }),
    );
    seedDead([
      dead('create', 'create_observation', { p_course_id: 'c', p_body: 'x' }),
      dead('blocked', 'upsert_tag_score', { p_enrollment_id: 'e', p_assessment_id: 'sA' }, { blocked_on: ['sA'] }),
      dead('stale', 'update_assessment', { p_id: 'a2', p_patch: { title: 'Older' } }),
      dead('other', 'update_assessment', { p_id: 'a3', p_patch: {} }, { owner: TEACHER_B }),
    ]);

    loadPage();

    expect(window.Sentry.captureMessage).toHaveBeenCalledTimes(3);
    var stored = JSON.parse(localStorage.getItem('fv-sync-dead-letter-v1'));
    expect(stored.map(e => e.id)).toEqual(['other']);
    var queued = JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries;
    expect(queued.map(e => e.id)).toEqual(['q1']);
  });
});
