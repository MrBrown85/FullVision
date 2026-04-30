import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts, queryRow } from '../helpers/db.js';
import { makeAssessment } from '../helpers/fixtures.js';

/**
 * Assignments — production write path is window.saveAssessments(cid, arr)
 * which queues canonical create_assessment / update_assessment /
 * delete_assessment RPCs through _persistAssessmentsToCanonical.
 *
 * Every test drives saveAssessments — never the create_assessment RPC
 * directly, because the queue layer is exactly where the sign-out race
 * lived.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Assignments — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('asmt-create'));
    const a = makeAssessment({ title: 'Probe Quiz' });
    await page.evaluate(({ cid, asmt }) => window.saveAssessments(cid, [asmt]), { cid: courseId, asmt: a });
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.assessments, 'assessment must persist').toBeGreaterThan(0);

    const row = await queryRow(page, 'assessment', 'title', { course_id: courseId });
    expect(row.title).toBe('Probe Quiz');
  });

  test('edits and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('asmt-edit'));
    const a = makeAssessment({ title: 'Original Title' });
    await page.evaluate(({ cid, asmt }) => window.saveAssessments(cid, [asmt]), { cid: courseId, asmt: a });
    await page.waitForTimeout(1000);

    // Edit — saveAssessments diffs prev vs arr by id. Shallow-copy each
    // row so prev (which is _cache.assessments[cid].slice()) and arr no
    // longer share the same object references; otherwise the diff sees
    // the already-mutated value on both sides and no update RPC fires.
    await page.evaluate(cid => {
      const list = window.getAssessments(cid).map(a => ({ ...a }));
      const target = list.find(x => x.title === 'Original Title');
      if (!target) throw new Error('original assessment missing');
      target.title = 'Edited Title';
      window.saveAssessments(cid, list);
    }, courseId);
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const row = await queryRow(page, 'assessment', 'title', { course_id: courseId });
    expect(row.title).toBe('Edited Title');
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('asmt-delete'));
    const keep = makeAssessment({ title: 'Keep' });
    const drop = makeAssessment({ title: 'Drop' });
    await page.evaluate(({ cid, list }) => window.saveAssessments(cid, list), { cid: courseId, list: [keep, drop] });
    await page.waitForTimeout(1200);

    // Wait for canonical IDs (otherwise saveAssessments can't issue
    // delete_assessment for a row whose id is still local)
    await page.waitForFunction(
      cid => {
        const list = window.getAssessments(cid);
        if (!list || list.length < 2) return false;
        return list.every(a => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(a.id || ''));
      },
      courseId,
      { timeout: 10_000 },
    );

    await page.evaluate(cid => {
      const list = window.getAssessments(cid).filter(a => a.title !== 'Drop');
      window.saveAssessments(cid, list);
    }, courseId);
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.assessments, 'one assessment remains after delete + sign-out').toBe(1);
  });

  test('race-immediate-signOut — saveAssessments queue must drain before localStorage clears', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('asmt-race'));
    const a = makeAssessment({ title: 'Race Probe' });

    // Fire saveAssessments and IMMEDIATELY recycle. This is the production
    // failure: user clicks Save Assessment then clicks Sign Out, queue is
    // mid-flight when localStorage clears. window.signOut now awaits
    // waitForPendingSyncs(5000); the test confirms the gate is honoured.
    await page.evaluate(({ cid, asmt }) => window.saveAssessments(cid, [asmt]), { cid: courseId, asmt: a });
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.assessments, 'assessment must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — title, due_date, score_mode, max_points, weight', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('asmt-roundtrip'));
    const a = makeAssessment({
      title: 'Round Trip Probe',
      date: '2026-04-15',
      dueDate: '2026-04-22',
      scoreMode: 'points',
      maxPoints: 25,
      weight: 1.5,
    });
    await page.evaluate(({ cid, asmt }) => window.saveAssessments(cid, [asmt]), { cid: courseId, asmt: a });
    await page.waitForTimeout(1200);

    await recycleSession(page);
    const row = await queryRow(page, 'assessment', 'title, score_mode, max_points, weight, date_assigned, due_date', {
      course_id: courseId,
      title: 'Round Trip Probe',
    });
    expect(row, 'assessment row exists after round-trip').not.toBeNull();
    expect(row.score_mode).toBe('points');
    expect(Number(row.max_points)).toBe(25);
    expect(Number(row.weight)).toBe(1.5);
    expect(String(row.date_assigned)).toBe('2026-04-15');
    expect(String(row.due_date)).toBe('2026-04-22');
  });
});
