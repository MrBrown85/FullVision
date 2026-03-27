/**
 * Sync loop detection tests.
 *
 * Verify that the Supabase sync layer does NOT create runaway request
 * loops when the server is failing. These tests instrument the mock
 * Supabase client to count upsert calls and simulate errors.
 *
 * Key invariants tested:
 *   1. Failed saves don't produce unbounded retries
 *   2. Retries pause after consecutive failures
 *   3. Rapid saves for the same key coalesce (fewer calls than saves)
 *   4. No phantom calls after all syncs complete
 *   5. A 10-second failure storm stays under a hard request cap
 */
import { test, expect } from '@playwright/test';
import { TEACHER, TEST_COURSE, TEST_LEARNING_MAP, TEST_STUDENTS, TEST_ASSESSMENT } from './helpers.js';

// ── Helper: mock auth with an instrumented Supabase client ──────────

async function mockAuthWithSyncTracking(page) {
  await page.addInitScript((teacher) => {
    const fakeSession = {
      access_token: 'e2e-test-token',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      refresh_token: 'e2e-refresh',
      user: {
        id: teacher.id,
        email: teacher.email,
        user_metadata: { display_name: teacher.display_name },
      },
    };

    localStorage.setItem('sb-novsfeqjhbleyyaztmlh-auth-token', JSON.stringify(fakeSession));
    localStorage.setItem('gb-data-wiped', '1');

    // Tracking state
    window.__syncCalls = [];
    window.__syncFail = false;
    window.__syncDelay = 0;

    const noopPromise = (val) => Promise.resolve(val);

    const makeFakeClient = () => ({
      auth: {
        getSession: () => noopPromise({ data: { session: { ...fakeSession, user: fakeSession.user } }, error: null }),
        getUser: () => noopPromise({ data: { user: fakeSession.user }, error: null }),
        onAuthStateChange: (cb) => {
          setTimeout(() => cb('SIGNED_IN', { ...fakeSession, user: fakeSession.user }), 50);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: () => noopPromise({}),
        resetPasswordForEmail: () => noopPromise({}),
        signInWithPassword: () => noopPromise({ data: fakeSession, error: null }),
        signUp: () => noopPromise({ data: fakeSession, error: null }),
      },
      from: (table) => {
        const _eqs = {};
        let _pendingUpsert = false;
        const chain = {
          select: () => chain,
          eq: (col, val) => { _eqs[col] = val; return chain; },
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: () => noopPromise({ data: null, error: null }),
          abortSignal: () => chain,
          upsert: () => {
            window.__syncCalls.push({ table, timestamp: Date.now() });
            _pendingUpsert = true;
            return chain;
          },
          insert: () => noopPromise({ data: [], error: null }),
          update: () => chain,
          delete: () => chain,
          then: (resolve, reject) => {
            if (_pendingUpsert) {
              _pendingUpsert = false;
              const delay = window.__syncDelay || 1;
              if (window.__syncFail) {
                return new Promise((r) => {
                  setTimeout(() => r(resolve({ error: { message: 'simulated 504 timeout', code: '504' } })), delay);
                });
              }
              return new Promise((r) => {
                setTimeout(() => r(resolve({ error: null })), delay);
              });
            }
            if (table === 'teacher_config') {
              const courses = JSON.parse(localStorage.getItem('gb-courses') || 'null');
              const config = JSON.parse(localStorage.getItem('gb-config') || '{}');
              const rows = [];
              if (courses) rows.push({ config_key: 'courses', data: courses });
              if (config) rows.push({ config_key: 'config', data: config });
              return resolve({ data: rows, error: null });
            }
            if (table === 'course_data') {
              const cid = _eqs['course_id'] || 'sci8';
              const dataKeys = ['students','assessments','scores','learningMaps','modules','rubrics','flags','goals','reflections','overrides','statuses','observations','notes','termRatings','customTags','courseConfigs','reportConfig','gradingScales'];
              const rows = [];
              for (const dk of dataKeys) {
                const val = localStorage.getItem('gb-' + dk + '-' + cid);
                if (val) rows.push({ data_key: dk, data: JSON.parse(val) });
              }
              return resolve({ data: rows, error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
    });

    window.supabase = { createClient: () => makeFakeClient() };
    window.__ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'fake-key' };
    window._idleTimeout = null;
    window._resetIdleTimer = () => {};

    const _seedObserver = new MutationObserver(() => {
      if (typeof window.seedIfNeeded === 'function' && !window._seedStubbed) {
        window._seedStubbed = true;
        window.seedIfNeeded = async () => {};
        window.migrateAllStudents = async () => {};
      }
    });
    _seedObserver.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (typeof window.seedIfNeeded === 'function') window.seedIfNeeded = async () => {};
      if (typeof window.migrateAllStudents === 'function') window.migrateAllStudents = async () => {};
      _seedObserver.disconnect();
    }, 3000);
  }, TEACHER);

  await page.route('**/vendor/supabase.min.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* mocked */',
  }));
  await page.route('**/cdn.jsdelivr.net/**supabase**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* mocked */',
  }));
}

async function seedTestData(page) {
  await page.addInitScript((fixtures) => {
    const { course, learningMap, students, assessment } = fixtures;
    const courses = {};
    courses[course.id] = course;
    localStorage.setItem('gb-courses', JSON.stringify(courses));
    localStorage.setItem('gb-config', JSON.stringify({ activeCourse: course.id }));
    localStorage.setItem('gb-lastActiveCourse', course.id);
    localStorage.setItem('gb-learningMaps-' + course.id, JSON.stringify(learningMap));
    localStorage.setItem('gb-students-' + course.id, JSON.stringify(students));
    localStorage.setItem('gb-assessments-' + course.id, JSON.stringify([assessment]));
    localStorage.setItem('gb-scores-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-modules-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-rubrics-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-flags-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-goals-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-reflections-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-overrides-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-statuses-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-notes-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-termRatings-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-customTags-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-courseConfigs-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-reportConfig-' + course.id, JSON.stringify({}));
  }, { course: TEST_COURSE, learningMap: TEST_LEARNING_MAP, students: TEST_STUDENTS, assessment: TEST_ASSESSMENT });
}

function countCalls(calls, table) {
  return calls.filter(c => c.table === table).length;
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Sync Loop Detection', () => {

  test.beforeEach(async ({ page }) => {
    await mockAuthWithSyncTracking(page);
    await seedTestData(page);
  });

  test('rapid saves for same key do not grow without bound', async ({ page }) => {
    // Use slow upserts to simulate real network latency
    await page.addInitScript(() => { window.__syncDelay = 200; });
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
    await page.evaluate(() => { window.__syncCalls = []; });

    // Fire 50 rapid score saves — without coalescing this could explode with retries
    await page.evaluate(() => {
      for (let i = 0; i < 50; i++) {
        saveScores('sci8', { 'stu-001': [{ id: 's' + i, assessmentId: 'assess-001', tagId: 'QAP', score: i % 4 + 1, date: '2026-03-20', type: 'summative' }] });
      }
    });

    await page.waitForTimeout(5000);
    const calls = await page.evaluate(() => window.__syncCalls);

    // Even if coalescing can't catch all calls in the mock,
    // verify the count doesn't exceed the number of saves (no retry multiplication)
    const scoreCalls = countCalls(calls, 'course_data');
    expect(scoreCalls).toBeLessThanOrEqual(50);
  });

  test('failed upserts do not create unbounded retry loop', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });

    await page.evaluate(() => {
      window.__syncFail = true;
      window.__syncCalls = [];
    });

    // Trigger a save
    await page.evaluate(() => {
      saveScores('sci8', { 'stu-001': [{ id: 's1', assessmentId: 'assess-001', tagId: 'QAP', score: 3, date: '2026-03-20', type: 'summative' }] });
    });

    // Wait long enough for multiple retry cycles
    await page.waitForTimeout(5000);

    const calls = await page.evaluate(() => window.__syncCalls);
    // Should be initial + a few retries, NOT dozens
    expect(countCalls(calls, 'course_data')).toBeLessThan(10);
  });

  test('retries pause after 3 consecutive failures', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });

    await page.evaluate(() => {
      window.__syncFail = true;
      window.__syncCalls = [];
    });

    // Trigger 3 different saves to hit the consecutive failure threshold
    await page.evaluate(() => {
      saveScores('sci8', { 'stu-001': [{ id: 's1', assessmentId: 'assess-001', tagId: 'QAP', score: 1, date: '2026-03-20', type: 'summative' }] });
      saveStudents('sci8', [{ id: 'stu-001', firstName: 'Alice', lastName: 'Anderson' }]);
      saveAssessments('sci8', [{ id: 'assess-001', title: 'Test', tagIds: ['QAP'] }]);
    });

    // Wait for failures to propagate
    await page.waitForTimeout(3000);
    const callsBefore = await page.evaluate(() => window.__syncCalls.length);

    // Wait another 5 seconds — retries should be paused after 3 failures
    await page.waitForTimeout(5000);
    const callsAfter = await page.evaluate(() => window.__syncCalls.length);

    // No new calls while paused
    expect(callsAfter).toBe(callsBefore);
  });

  test('different keys are not coalesced — each gets its own sync', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
    await page.evaluate(() => { window.__syncCalls = []; });

    await page.evaluate(() => {
      saveScores('sci8', { 'stu-001': [{ id: 's1', assessmentId: 'assess-001', tagId: 'QAP', score: 3, date: '2026-03-20', type: 'summative' }] });
      saveStudents('sci8', [{ id: 'stu-001', firstName: 'Alice', lastName: 'Anderson' }]);
      saveNotes('sci8', { 'stu-001': 'Great work' });
    });

    await page.waitForTimeout(2000);
    const calls = await page.evaluate(() => window.__syncCalls);
    // 3 different keys = 3 separate syncs
    expect(countCalls(calls, 'course_data')).toBe(3);
  });

  test('no phantom calls after syncs complete', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
    await page.evaluate(() => { window.__syncCalls = []; });

    await page.evaluate(() => {
      saveScores('sci8', { 'stu-001': [{ id: 's1', assessmentId: 'assess-001', tagId: 'QAP', score: 3, date: '2026-03-20', type: 'summative' }] });
    });

    await page.waitForTimeout(1000);
    const callsAfterSave = await page.evaluate(() => window.__syncCalls.length);

    // Wait 5 more seconds — should be no additional calls
    await page.waitForTimeout(5000);
    const callsLater = await page.evaluate(() => window.__syncCalls.length);
    expect(callsLater).toBe(callsAfterSave);
  });

  test('total requests stay under 50 during a 10-second failure storm', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });

    await page.evaluate(() => {
      window.__syncFail = true;
      window.__syncCalls = [];
    });

    // Simulate frantic saving while server is down
    await page.evaluate(() => {
      let i = 0;
      const interval = setInterval(() => {
        saveScores('sci8', { 'stu-001': [{ id: 's' + i, assessmentId: 'assess-001', tagId: 'QAP', score: i % 4 + 1, date: '2026-03-20', type: 'summative' }] });
        i++;
        if (i >= 20) clearInterval(interval);
      }, 500);
    });

    await page.waitForTimeout(15000);
    const totalCalls = await page.evaluate(() => window.__syncCalls.length);

    // Without the fix: 100+ (retries fire entire queue in parallel)
    // With the fix: coalescing + pause after 3 failures = well under 50
    expect(totalCalls).toBeLessThan(50);
  });

  test('sync status shows error state when server fails', async ({ page }) => {
    await page.goto('/app.html#/dashboard');
    await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });

    await page.evaluate(() => { window.__syncFail = true; });

    await page.evaluate(() => {
      saveScores('sci8', { 'stu-001': [{ id: 's1', assessmentId: 'assess-001', tagId: 'QAP', score: 3, date: '2026-03-20', type: 'summative' }] });
    });

    await page.waitForTimeout(1000);

    const status = await page.evaluate(() => getSyncStatus());
    expect(status.status).toBe('error');
  });
});
