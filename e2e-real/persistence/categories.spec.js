import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts, queryRow } from '../helpers/db.js';
import { openAssignmentForCourse, openNewAssessmentForm } from '../helpers/ui.js';

/**
 * Categories — production write path is window.v2.upsertCategory + the
 * class-manager mirror _cmMirrorCategoriesToCache. These tests drive the
 * RPC that the cmCatPersist action handler invokes, then assert against
 * Supabase + the cache + the assignment-form dropdown (which is the
 * read-side surface where the original bug manifested).
 *
 * We do not call upsert_category SQL directly through page.evaluate-on-supabase
 * here without going through window.v2.upsertCategory — the v2 wrapper is
 * what production uses; testing it preserves the layering.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Categories — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cats-create'));
    await page.evaluate(async cid => {
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Probe Cat', weight: 50, displayOrder: 0 });
    }, courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.categories, 'category must persist').toBeGreaterThan(0);
  });

  test('edits and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cats-edit'));
    const catId = await page.evaluate(async cid => {
      const res = await window.v2.upsertCategory({
        id: null,
        courseId: cid,
        name: 'Original',
        weight: 25,
        displayOrder: 0,
      });
      return res && res.data ? res.data : null;
    }, courseId);
    expect(catId, 'category id returned').not.toBeNull();
    await page.waitForTimeout(500);

    // Update name + weight via the same RPC
    await page.evaluate(
      async ({ cid, id }) => {
        await window.v2.upsertCategory({ id, courseId: cid, name: 'Edited', weight: 75, displayOrder: 0 });
      },
      { cid: courseId, id: catId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await queryRow(page, 'category', 'name, weight', { id: catId });
    expect(row, 'category row exists after edit + sign-out').not.toBeNull();
    expect(row.name).toBe('Edited');
    expect(Number(row.weight)).toBe(75);
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cats-delete'));
    const catId = await page.evaluate(async cid => {
      const res = await window.v2.upsertCategory({
        id: null,
        courseId: cid,
        name: 'Doomed',
        weight: 30,
        displayOrder: 0,
      });
      return res.data;
    }, courseId);
    await page.waitForTimeout(500);

    await page.evaluate(async id => {
      if (window.v2 && window.v2.deleteCategory) await window.v2.deleteCategory(id);
    }, catId);
    await page.waitForTimeout(500);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.categories, 'category must be gone after delete + sign-out').toBe(0);
  });

  test('race-immediate-signOut — upsertCategory queue must drain before localStorage clears', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cats-race'));
    // Fire the upsert and IMMEDIATELY recycle (no manual wait). window.signOut
    // calls waitForPendingSyncs(5000) before clearing local data; this
    // confirms the upsert RPC promise was tracked.
    await page.evaluate(cid => {
      // Intentionally no `await` — fire and immediately fall through to
      // the recycleSession call, mirroring the real "click Save then click
      // Sign Out" race.
      window.v2.upsertCategory({ id: null, courseId: cid, name: 'Race Cat', weight: 100, displayOrder: 0 });
    }, courseId);
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.categories, 'category must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — categories surface in the assignment-form dropdown after sign-in', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('cats-roundtrip'));
    await page.evaluate(async cid => {
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Labs', weight: 40, displayOrder: 0 });
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Quizzes', weight: 30, displayOrder: 1 });
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Projects', weight: 30, displayOrder: 2 });
    }, courseId);
    await page.waitForTimeout(800);

    // The bug's read-side surface: get_gradebook payload must include
    // categories, _cache.categories must hydrate, and #af-category must
    // contain options 1..N+placeholder.
    await recycleSession(page);
    await openAssignmentForCourse(page, courseId);
    await openNewAssessmentForm(page);

    const optionTexts = await page.$$eval('#af-category option', opts => opts.map(o => o.textContent.trim()));
    expect(optionTexts, 'all three category names round-trip into the dropdown').toEqual(
      expect.arrayContaining(['Labs', 'Quizzes', 'Projects']),
    );
    expect(optionTexts.length).toBeGreaterThan(3); // 3 + the "No Category" placeholder
  });
});
