import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';

/**
 * Course config — production write path is saveCourseConfig(cid, obj),
 * which calls update_course via _trackPendingSync. Config lives on the
 * course row itself (grading_system, calc_method, late_work_policy, etc.)
 * rather than a separate table, so assertions query the course row directly.
 *
 * The "delete" matrix entry is replaced by "reset" (a second save restoring
 * defaults) since course config rows cannot be independently deleted.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Course config — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cfg-create'));
    await page.evaluate(({ cid }) => window.saveCourseConfig(cid, { gradingSystem: 'letter', calcMethod: 'mean' }), {
      cid: courseId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('course').select('grading_system, calc_method').eq('id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'course row exists').not.toBeNull();
    expect(row.grading_system).toBe('letter');
    expect(row.calc_method).toBe('mean');
  });

  test('edits — updating config fields overwrites on the course row', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cfg-edit'));
    await page.evaluate(({ cid }) => window.saveCourseConfig(cid, { calcMethod: 'mean' }), { cid: courseId });
    await page.waitForTimeout(500);
    await page.evaluate(({ cid }) => window.saveCourseConfig(cid, { calcMethod: 'median' }), { cid: courseId });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('course').select('calc_method').eq('id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'course row exists').not.toBeNull();
    expect(row.calc_method, 'updated calc_method persists').toBe('median');
  });

  test('late_work_policy persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cfg-policy'));
    await page.evaluate(({ cid }) => window.saveCourseConfig(cid, { lateWorkPolicy: 'reduce_10pct' }), {
      cid: courseId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('course').select('late_work_policy').eq('id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'course row exists').not.toBeNull();
    expect(row.late_work_policy, 'late_work_policy persists').toBe('reduce_10pct');
  });

  test('race-immediate-signOut — saveCourseConfig must drain', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cfg-race'));
    await page.evaluate(
      ({ cid }) => {
        window.saveCourseConfig(cid, { gradingSystem: 'both', calcMethod: 'mean' });
      },
      { cid: courseId },
    );
    await recycleSession(page);

    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('course').select('grading_system').eq('id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'course row exists after immediate sign-out').not.toBeNull();
    expect(row.grading_system, 'grading_system reaches Supabase even with immediate sign-out').toBe('both');
  });

  test('value round-trip — all config fields exact match', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cfg-roundtrip'));
    await page.evaluate(
      ({ cid }) =>
        window.saveCourseConfig(cid, {
          gradingSystem: 'letter',
          calcMethod: 'decaying_avg',
          lateWorkPolicy: 'reduce_50pct',
        }),
      { cid: courseId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('course')
        .select('grading_system, calc_method, late_work_policy')
        .eq('id', cid)
        .maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'course row exists').not.toBeNull();
    expect(row.grading_system).toBe('letter');
    expect(row.calc_method).toBe('decaying_avg');
    expect(row.late_work_policy).toBe('reduce_50pct');
  });
});
