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
import { makeStudent } from '../helpers/fixtures.js';

/**
 * Reflections — production write path is the saveReflField handler in
 * page-student.js, which calls saveReflections(cid, obj) AND dispatches
 * via window.v2.saveReflection(enrollmentId, sectionId, body, confidence).
 * Reflections are true upserts by (enrollment_id, section_id), so an edit
 * replaces the body in place.
 *
 * Requires a section (FK), so setup creates curriculum via the wizard.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Reflections — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  async function setupCourseStudentSection(page, suffix) {
    const courseName = makeCourseName(`refl-${suffix}`);
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
    const sectionId = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('section').select('id').eq('course_id', cid).limit(1).maybeSingle();
      return r.data ? r.data.id : null;
    }, courseId);

    const student = makeStudent({ firstName: 'Refl', lastName: 'Probe' });
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
    return { courseId, enrollmentId, sectionId };
  }

  async function saveReflProd(page, courseId, enrollmentId, sectionId, body, confidence = null) {
    return page.evaluate(
      async ({ cid, eid, secId, b, conf }) => {
        const refls = window.getReflections(cid) || {};
        if (!refls[eid]) refls[eid] = {};
        refls[eid][secId] = b;
        window.saveReflections(cid, refls);
        if (window.v2 && window.v2.saveReflection) {
          await window.v2.saveReflection(eid, secId, b, conf);
        }
      },
      { cid: courseId, eid: enrollmentId, secId: sectionId, b: body, conf: confidence },
    );
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'create');
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'I understood the main ideas.', 3);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.reflections, 'reflection must persist').toBeGreaterThan(0);
  });

  test('edits — replacing the reflection body persists', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'edit');
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Original reflection.', 2);
    await page.waitForTimeout(500);
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Edited reflection.', 4);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb
          .from('reflection')
          .select('body, confidence')
          .eq('enrollment_id', eid)
          .eq('section_id', secId)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'reflection row exists').not.toBeNull();
    expect(row.body).toBe('Edited reflection.');
    expect(row.confidence).toBe(4);
  });

  test('deletes — clearing the reflection text removes the row', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'delete');
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Doomed reflection.', 3);
    await page.waitForTimeout(500);
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, '');
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.reflections, 'reflection removed after empty save + sign-out').toBe(0);
  });

  test('race-immediate-signOut — saveReflection RPC must drain', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'race');
    await page.evaluate(
      ({ cid, eid, secId }) => {
        const refls = window.getReflections(cid) || {};
        if (!refls[eid]) refls[eid] = {};
        refls[eid][secId] = 'Race reflection.';
        window.saveReflections(cid, refls);
        if (window.v2 && window.v2.saveReflection) window.v2.saveReflection(eid, secId, 'Race reflection.', null);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.reflections, 'reflection must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — body and confidence exact match', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'roundtrip');
    const body =
      'This topic helped me understand how evidence connects to arguments.\nI still need to work on conclusions.';
    await saveReflProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, body, 5);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb
          .from('reflection')
          .select('body, confidence')
          .eq('enrollment_id', eid)
          .eq('section_id', secId)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'reflection row exists').not.toBeNull();
    expect(row.body).toBe(body);
    expect(row.confidence).toBe(5);
  });
});
