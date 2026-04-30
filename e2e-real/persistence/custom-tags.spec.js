import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';

/**
 * Custom tags — production write path is window.addCustomTag(cid, label)
 * which calls saveCustomTags (localStorage + Supabase dispatch via
 * create_custom_tag). Custom tags are create-only in the DB (no
 * delete_custom_tag RPC); once created, a label persists until the course
 * is deleted.
 *
 * Test #2 replaces the "edit" matrix entry with an idempotency check:
 * adding the same label twice must produce exactly one row, not two.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Custom tags — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('ctag-create'));
    await page.evaluate(({ cid }) => window.addCustomTag(cid, 'Probe Tag Alpha'), { cid: courseId });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.customTags, 'custom_tag must persist').toBeGreaterThan(0);
  });

  test('idempotency — adding the same label twice creates one row', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('ctag-idem'));
    await page.evaluate(
      ({ cid }) => {
        window.addCustomTag(cid, 'Idempotent Label');
        window.addCustomTag(cid, 'Idempotent Label'); // duplicate — should be filtered by saveCustomTags diff
      },
      { cid: courseId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const count = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('custom_tag')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', cid)
        .eq('label', 'Idempotent Label');
      return r.count || 0;
    }, courseId);
    expect(count, 'duplicate add produces exactly one row').toBe(1);
  });

  test('multiple tags persist independently', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('ctag-multi'));
    await page.evaluate(
      ({ cid }) => {
        window.addCustomTag(cid, 'Tag Beta');
        window.addCustomTag(cid, 'Tag Gamma');
        window.addCustomTag(cid, 'Tag Delta');
      },
      { cid: courseId },
    );
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.customTags, 'all three custom_tag rows persist').toBe(3);
  });

  test('race-immediate-signOut — saveCustomTags must drain', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('ctag-race'));
    await page.evaluate(({ cid }) => window.addCustomTag(cid, 'Race Tag'), { cid: courseId });
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.customTags, 'custom_tag must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — label text exact match', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('ctag-roundtrip'));
    const label = 'Exact Label Round-Trip ✓';
    await page.evaluate(({ cid, l }) => window.addCustomTag(cid, l), { cid: courseId, l: label });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ cid, l }) => {
        const sb = window._supabase;
        const r = await sb.from('custom_tag').select('label').eq('course_id', cid).eq('label', l).maybeSingle();
        return r.data;
      },
      { cid: courseId, l: label },
    );
    expect(row, 'custom_tag row exists').not.toBeNull();
    expect(row.label, 'label text round-trips exactly').toBe(label);
  });
});
