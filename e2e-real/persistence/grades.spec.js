import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts, queryRow } from '../helpers/db.js';
import { makeStudent, makeAssessment } from '../helpers/fixtures.js';

/**
 * Grades — production write path is window.upsertCellScore(cid,
 * enrollmentId, assessmentId, value) which fires upsert_score directly. The
 * helper is wrapped in _trackPendingSync so the queue is honoured by
 * waitForPendingSyncs.
 *
 * Each test must first land a canonical student and assessment because the
 * score FK references both. We do that via saveStudents + saveAssessments
 * (the same helpers the corresponding entity specs cover) and wait for
 * canonical IDs before proceeding to the score write.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Grades — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  /**
   * Fixture: build a course with one student + one assessment, both with
   * canonical UUIDs landed. Returns { courseId, enrollmentId, assessmentId }.
   */
  async function setupCourseStudentAssessment(page, suffix) {
    const courseId = await createTestCourse(page, makeCourseName(`grades-${suffix}`));
    const student = makeStudent({ firstName: 'Grade', lastName: 'Probe' });
    const assessment = makeAssessment({ title: 'Probe Assignment' });
    await page.evaluate(
      ({ cid, s, a }) => {
        window.saveStudents(cid, [s]);
        window.saveAssessments(cid, [a]);
      },
      { cid: courseId, s: student, a: assessment },
    );
    // Wait for both canonical IDs to land (queues fire fairly quickly but
    // we need both before scoring).
    await page.waitForFunction(
      cid => {
        const s = window.getStudents(cid);
        const a = window.getAssessments(cid);
        if (!s || !a || !s.length || !a.length) return false;
        const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v || '');
        return isUuid(s[0].id) && isUuid(a[0].id);
      },
      courseId,
      { timeout: 12_000 },
    );
    const ids = await page.evaluate(cid => {
      const s = window.getStudents(cid)[0];
      const a = window.getAssessments(cid)[0];
      return { enrollmentId: s.id, assessmentId: a.id };
    }, courseId);
    return { courseId, ...ids };
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentAssessment(page, 'create');
    await page.evaluate(({ cid, eid, aid }) => window.upsertCellScore(cid, eid, aid, 3), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.scores, 'score must persist').toBeGreaterThan(0);
  });

  test('edits — change a score value across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentAssessment(page, 'edit');
    await page.evaluate(({ cid, eid, aid }) => window.upsertCellScore(cid, eid, aid, 2), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
    });
    await page.waitForTimeout(600);
    await page.evaluate(({ cid, eid, aid }) => window.upsertCellScore(cid, eid, aid, 4), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await queryRow(page, 'score', 'value', {
      enrollment_id: ctx.enrollmentId,
      assessment_id: ctx.assessmentId,
    });
    expect(row, 'score row exists').not.toBeNull();
    expect(Number(row.value), 'edited value persists, not the original').toBe(4);
  });

  test('clears — clear_column_scores nukes all scores for the assessment', async ({ page }) => {
    const ctx = await setupCourseStudentAssessment(page, 'clear');
    await page.evaluate(({ cid, eid, aid }) => window.upsertCellScore(cid, eid, aid, 3), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
    });
    await page.waitForTimeout(800);
    const before = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(before.scores).toBeGreaterThan(0);

    await page.evaluate(async aid => {
      const sb = window._supabase;
      await sb.rpc('clear_column_scores', { p_assessment_id: aid });
    }, ctx.assessmentId);
    await page.waitForTimeout(600);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(after.scores, 'all scores for the column are cleared after sign-out').toBe(0);
  });

  test('race-immediate-signOut — upsertCellScore must drain before localStorage clears', async ({ page }) => {
    const ctx = await setupCourseStudentAssessment(page, 'race');
    await page.evaluate(
      ({ cid, eid, aid }) => {
        window.upsertCellScore(cid, eid, aid, 3);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId, aid: ctx.assessmentId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.scores, 'score must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — proficiency value comes back exact', async ({ page }) => {
    const ctx = await setupCourseStudentAssessment(page, 'roundtrip');
    await page.evaluate(({ cid, eid, aid }) => window.upsertCellScore(cid, eid, aid, 4), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await queryRow(page, 'score', 'value', {
      enrollment_id: ctx.enrollmentId,
      assessment_id: ctx.assessmentId,
    });
    expect(row, 'score row exists after round-trip').not.toBeNull();
    expect(Number(row.value), 'numeric value round-trips exactly').toBe(4);
  });
});
