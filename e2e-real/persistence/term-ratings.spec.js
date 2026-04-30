import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';
import { makeStudent } from '../helpers/fixtures.js';

/**
 * Term ratings — production write path is window.v2.saveTermRating(
 * enrollmentId, term, payload). Wrapped in _trackPendingSync via
 * _callRpcWithAuthGuard. The save_term_rating RPC upserts by
 * (enrollment_id, term), so an edit overwrites the previous row.
 *
 * Tests use a minimal payload (work_habits_rating only) to keep setup
 * lean. The value round-trip test uses a richer payload to prove all
 * fields reach the DB.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Term ratings — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  async function setupCourseWithStudent(page, suffix) {
    const courseId = await createTestCourse(page, makeCourseName(`term-${suffix}`));
    const student = makeStudent({ firstName: 'Term', lastName: 'Probe' });
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });
    await page.waitForFunction(
      cid => {
        const s = window.getStudents(cid);
        return s && s.length && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s[0].id || '');
      },
      courseId,
      { timeout: 12_000 },
    );
    const enrollmentId = await page.evaluate(cid => window.getStudents(cid)[0].id, courseId);
    return { courseId, enrollmentId };
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'create');
    await page.evaluate(({ eid }) => window.v2.saveTermRating(eid, 1, { workHabitsRating: 3 }), {
      eid: ctx.enrollmentId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.termRatings, 'term_rating must persist').toBeGreaterThan(0);
  });

  test('edits — updating the rating overwrites the row', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'edit');
    await page.evaluate(({ eid }) => window.v2.saveTermRating(eid, 1, { workHabitsRating: 2 }), {
      eid: ctx.enrollmentId,
    });
    await page.waitForTimeout(500);
    await page.evaluate(({ eid }) => window.v2.saveTermRating(eid, 1, { workHabitsRating: 4 }), {
      eid: ctx.enrollmentId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb
        .from('term_rating')
        .select('work_habits_rating')
        .eq('enrollment_id', eid)
        .eq('term', 1)
        .maybeSingle();
      return r.data;
    }, ctx.enrollmentId);
    expect(row, 'term_rating row exists').not.toBeNull();
    // save_term_rating upserts by (enrollment_id, term) — only the latest value survives.
    expect(row.work_habits_rating).toBe(4);
  });

  test('multiple terms persist independently', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'multi');
    await page.evaluate(
      ({ eid }) => {
        window.v2.saveTermRating(eid, 1, { workHabitsRating: 2 });
        window.v2.saveTermRating(eid, 2, { workHabitsRating: 4 });
      },
      { eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.termRatings, 'both term rating rows persist').toBe(2);
  });

  test('race-immediate-signOut — saveTermRating must drain', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'race');
    await page.evaluate(
      ({ eid }) => {
        window.v2.saveTermRating(eid, 1, { workHabitsRating: 3 });
      },
      { eid: ctx.enrollmentId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.termRatings, 'term_rating must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — participation and work_habits exact match', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'roundtrip');
    await page.evaluate(
      ({ eid }) => window.v2.saveTermRating(eid, 2, { workHabitsRating: 3, participationRating: 4 }),
      { eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb
        .from('term_rating')
        .select('work_habits_rating, participation_rating')
        .eq('enrollment_id', eid)
        .eq('term', 2)
        .maybeSingle();
      return r.data;
    }, ctx.enrollmentId);
    expect(row, 'term_rating row exists').not.toBeNull();
    expect(row.work_habits_rating).toBe(3);
    expect(row.participation_rating).toBe(4);
  });
});
