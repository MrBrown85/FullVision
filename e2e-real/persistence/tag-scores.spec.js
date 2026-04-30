import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';
import {
  openWizardFromClassManager,
  pickGrade,
  pickSubject,
  toggleCurriculumTag,
  wizardGoToStep,
  setWizardClassName,
  finishWizard,
} from '../helpers/ui.js';
import { makeStudent, makeAssessment } from '../helpers/fixtures.js';

/**
 * Tag scores — production write path is window.upsertScore(cid, eid, aid,
 * tagId, value) which dispatches to upsert_tag_score when tagId is a
 * canonical UUID. Wrapped in _trackPendingSync via _persistScoreToCanonical.
 *
 * Requires a tag (FK: section → course) and an assessment linked to it,
 * so setup uses the curriculum wizard to mint sections + tags.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Tag scores — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  /**
   * Setup: course with curriculum, student, and one assessment linked to a
   * curriculum tag. Returns { courseId, enrollmentId, assessmentId, tagId }.
   */
  async function setupCourseStudentTagAssessment(page, suffix) {
    const courseName = makeCourseName(`tagscore-${suffix}`);
    await openWizardFromClassManager(page);
    await pickGrade(page, 8);
    await pickSubject(page, 'Science');
    await toggleCurriculumTag(page, 'SCI8');
    await wizardGoToStep(page, 2);
    await setWizardClassName(page, courseName);
    await wizardGoToStep(page, 3);
    await finishWizard(page);

    const courseId = await page.evaluate(async name => {
      const sb = window._supabase;
      const r = await sb.from('course').select('id').eq('name', name).maybeSingle();
      return r.data ? r.data.id : null;
    }, courseName);

    // Get the first curriculum tag UUID for this course.
    const tagId = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('tag')
        .select('id, section!inner(course_id)')
        .eq('section.course_id', cid)
        .limit(1)
        .maybeSingle();
      return r.data ? r.data.id : null;
    }, courseId);

    // Create a student.
    const student = makeStudent({ firstName: 'TagScore', lastName: 'Probe' });
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

    // Create an assessment with the curriculum tag.
    const assessment = makeAssessment({ title: 'TagScore Probe', tagIds: [tagId] });
    await page.evaluate(({ cid, a }) => window.saveAssessments(cid, [a]), { cid: courseId, a: assessment });
    await page.waitForFunction(
      cid => {
        const a = window.getAssessments(cid);
        return a && a.length && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(a[0].id || '');
      },
      courseId,
      { timeout: 12_000 },
    );
    const assessmentId = await page.evaluate(cid => window.getAssessments(cid)[0].id, courseId);

    return { courseId, enrollmentId, assessmentId, tagId };
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentTagAssessment(page, 'create');
    await page.evaluate(({ cid, eid, aid, tid }) => window.upsertScore(cid, eid, aid, tid, 3), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
      tid: ctx.tagId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.tagScores, 'tag_score must persist').toBeGreaterThan(0);
  });

  test('edits — updating the tag score value persists', async ({ page }) => {
    const ctx = await setupCourseStudentTagAssessment(page, 'edit');
    await page.evaluate(({ cid, eid, aid, tid }) => window.upsertScore(cid, eid, aid, tid, 2), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
      tid: ctx.tagId,
    });
    await page.waitForTimeout(500);
    await page.evaluate(({ cid, eid, aid, tid }) => window.upsertScore(cid, eid, aid, tid, 4), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
      tid: ctx.tagId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, aid, tid }) => {
        const sb = window._supabase;
        const r = await sb
          .from('tag_score')
          .select('value')
          .eq('enrollment_id', eid)
          .eq('assessment_id', aid)
          .eq('tag_id', tid)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, aid: ctx.assessmentId, tid: ctx.tagId },
    );
    expect(row, 'tag_score row exists').not.toBeNull();
    expect(Number(row.value), 'edited value persists, not the original').toBe(4);
  });

  test('clears — null value removes the row', async ({ page }) => {
    const ctx = await setupCourseStudentTagAssessment(page, 'clear');
    await page.evaluate(({ cid, eid, aid, tid }) => window.upsertScore(cid, eid, aid, tid, 3), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
      tid: ctx.tagId,
    });
    await page.waitForTimeout(800);
    const before = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(before.tagScores).toBeGreaterThan(0);

    await page.evaluate(
      async ({ eid, aid, tid }) => {
        const sb = window._supabase;
        await sb.rpc('upsert_tag_score', { p_enrollment_id: eid, p_assessment_id: aid, p_tag_id: tid, p_value: null });
      },
      { eid: ctx.enrollmentId, aid: ctx.assessmentId, tid: ctx.tagId },
    );
    await page.waitForTimeout(600);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(after.tagScores, 'tag_score row removed after null value + sign-out').toBe(0);
  });

  test('race-immediate-signOut — upsertScore tag path must drain', async ({ page }) => {
    const ctx = await setupCourseStudentTagAssessment(page, 'race');
    await page.evaluate(
      ({ cid, eid, aid, tid }) => {
        window.upsertScore(cid, eid, aid, tid, 3);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId, aid: ctx.assessmentId, tid: ctx.tagId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.tagScores, 'tag_score must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — proficiency level exact match', async ({ page }) => {
    const ctx = await setupCourseStudentTagAssessment(page, 'roundtrip');
    await page.evaluate(({ cid, eid, aid, tid }) => window.upsertScore(cid, eid, aid, tid, 4), {
      cid: ctx.courseId,
      eid: ctx.enrollmentId,
      aid: ctx.assessmentId,
      tid: ctx.tagId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, aid, tid }) => {
        const sb = window._supabase;
        const r = await sb
          .from('tag_score')
          .select('value')
          .eq('enrollment_id', eid)
          .eq('assessment_id', aid)
          .eq('tag_id', tid)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, aid: ctx.assessmentId, tid: ctx.tagId },
    );
    expect(row, 'tag_score row exists after round-trip').not.toBeNull();
    expect(Number(row.value), 'numeric proficiency level round-trips exactly').toBe(4);
  });
});
