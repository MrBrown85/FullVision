/**
 * Sync loop detection tests.
 *
 * Every write goes through the outbox (shared/offline-queue.js) to
 * supabase.rpc. These tests count the write RPCs the fake server in
 * helpers.js `mockAuth` receives, make them fail like a 504, and check that a
 * failing server never sets off a runaway request loop.
 *
 * The outbox's rules the thresholds come from:
 *   - A 5xx is retried after 1s, 5s, 30s, then every 60s, for as long as it
 *     takes. One failing write is sent at about 0s, 1s and 6s, then not again
 *     until 36s.
 *   - A score write replaces a queued, unsent write to the same cell, so a
 *     cell edited many times while one write is out sends one more, not many.
 *   - A write sent once and accepted is never sent again.
 *
 * Key invariants tested:
 *   1. Failed writes don't retry without bound
 *   2. Retries back off after repeated failures
 *   3. Rapid saves for the same cell coalesce (fewer calls than saves)
 *   4. No calls after all syncs complete
 *   5. A 10-second failure storm stays under a hard request cap
 */
import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  TEST_COURSE,
  TEST_STUDENTS,
  TEST_ASSESSMENT,
} from './helpers.js';

// The write path only sends rows with server (UUID) ids.
const ENROLLMENT_A = '11111111-1111-4111-8111-111111111111';
const ENROLLMENT_B = '22222222-2222-4222-8222-222222222222';
const ENROLLMENT_C = '33333333-3333-4333-8333-333333333333';
const ASSESSMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const STUDENTS = TEST_STUDENTS.map((s, i) => ({ ...s, id: [ENROLLMENT_A, ENROLLMENT_B, ENROLLMENT_C][i] }));
const ASSESSMENT = { ...TEST_ASSESSMENT, id: ASSESSMENT_ID };

// ── Helpers ──────────────────────────────────────────────────────────

/* Load the app and wait until the outbox has done its start-up flush, which
   ignores backoff and would otherwise add an attempt to a test's write. */
async function bootApp(page) {
  await page.goto('/teacher/app.html#/dashboard');
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const q = window.v2Queue;
      return !!q && q.stats().owner && q.stats().queued === 0 && performance.now() > 3000;
    },
    null,
    { timeout: 10_000 },
  );
  await page.evaluate(() => {
    window.__e2eRpcLog = [];
  });
}

/* Score one cell. Not awaited: a failing write stays pending while it retries. */
async function saveCell(page, enrollmentId, value) {
  await page.evaluate(
    args => {
      window.upsertCellScore(args.cid, args.enrollmentId, args.assessmentId, args.value);
    },
    { cid: TEST_COURSE.id, enrollmentId, assessmentId: ASSESSMENT_ID, value },
  );
}

async function scoreCalls(page) {
  return page.evaluate(() => window.__e2eRpcLog.filter(c => c.name === 'upsert_score'));
}

async function writeCallCount(page) {
  return page.evaluate(() => {
    const isWrite = c => !/^(get|list)_/.test(c.name) && c.name !== 'bootstrap_teacher';
    return window.__e2eRpcLog.filter(isWrite).length;
  });
}

async function queued(page) {
  return page.evaluate(() => window.v2Queue.stats().queued);
}

async function failWrites(page, on) {
  await page.evaluate(v => {
    window.__e2eFailWrites = v;
  }, on);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Sync Loop Detection', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page, STUDENTS);
    await seedAssessments(page, [ASSESSMENT]);
    await bootApp(page);
  });

  test('a failed write does not retry without bound', async ({ page }) => {
    await failWrites(page, true);
    await saveCell(page, ENROLLMENT_A, 3);

    await page.waitForTimeout(8000);

    // Sent at about 0s, 1s and 6s; the next try is 30s after that.
    const calls = await scoreCalls(page);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(3);
    // Still waiting to be sent, not dropped.
    expect(await queued(page)).toBe(1);
  });

  test('retries back off after repeated failures', async ({ page }) => {
    await failWrites(page, true);
    await saveCell(page, ENROLLMENT_A, 3);

    await expect.poll(async () => (await scoreCalls(page)).length, { timeout: 10_000 }).toBe(3);
    const [first, second, third] = (await scoreCalls(page)).map(c => c.at);

    // 1s before the first retry, 5s before the second.
    expect(second - first).toBeGreaterThanOrEqual(900);
    expect(third - second).toBeGreaterThanOrEqual(4500);

    // The third failure puts the next try 30s out.
    const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries[0]);
    expect(entry.attempts).toBe(3);
    expect(Date.parse(entry.next_at) - Date.now()).toBeGreaterThan(25_000);

    await page.waitForTimeout(3000);
    expect((await scoreCalls(page)).length).toBe(3);
  });

  test('rapid saves to one cell coalesce', async ({ page }) => {
    await page.evaluate(() => {
      window.__e2eWriteDelayMs = 300;
    });

    // The first save goes out at once; the other 49 replace each other in
    // the one unsent entry behind it.
    await page.evaluate(
      args => {
        for (let i = 0; i < 50; i++) {
          window.upsertCellScore(args.cid, args.enrollmentId, args.assessmentId, (i % 4) + 1);
        }
      },
      { cid: TEST_COURSE.id, enrollmentId: ENROLLMENT_A, assessmentId: ASSESSMENT_ID },
    );

    await expect.poll(() => queued(page), { timeout: 10_000 }).toBe(0);
    const calls = await scoreCalls(page);
    expect(calls.length).toBeLessThanOrEqual(2);
    // The last value saved is the one the server has.
    expect(calls[calls.length - 1].params.p_value).toBe((49 % 4) + 1);
  });

  test('no calls after syncs complete', async ({ page }) => {
    await saveCell(page, ENROLLMENT_A, 3);
    await saveCell(page, ENROLLMENT_B, 2);
    await saveCell(page, ENROLLMENT_C, 4);

    await expect.poll(() => queued(page), { timeout: 10_000 }).toBe(0);
    const callsAfterSave = await writeCallCount(page);
    expect(callsAfterSave).toBeGreaterThanOrEqual(3);

    await page.waitForTimeout(5000);
    expect(await writeCallCount(page)).toBe(callsAfterSave);
  });

  test('a 10-second failure storm stays under a hard request cap', async ({ page }) => {
    test.setTimeout(45_000);
    await failWrites(page, true);

    // 20 saves to one cell, one every 500ms, while the server is down.
    const SAVES = 20;
    const WINDOW_S = 15;
    await page.evaluate(
      args => {
        let i = 0;
        const interval = setInterval(() => {
          window.upsertCellScore(args.cid, args.enrollmentId, args.assessmentId, (i % 4) + 1);
          i++;
          if (i >= args.saves) clearInterval(interval);
        }, 500);
      },
      { cid: TEST_COURSE.id, enrollmentId: ENROLLMENT_A, assessmentId: ASSESSMENT_ID, saves: SAVES },
    );

    await page.waitForTimeout(WINDOW_S * 1000);

    // Each save sends at most once at once (it replaces the failed entry,
    // which starts its backoff over), and the retry timer fires at most once
    // a second (the shortest backoff) for the cell's one entry. A retry loop
    // would send hundreds.
    const cap = SAVES + WINDOW_S;
    expect(await writeCallCount(page)).toBeLessThanOrEqual(cap);
  });
});
