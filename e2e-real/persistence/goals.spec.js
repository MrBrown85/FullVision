import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
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
 * Goals — production write path is the saveGoalField handler in
 * page-student.js: it saves to localStorage via saveGoals(cid, obj) AND
 * dispatches via window.v2.saveGoal(enrollmentId, sectionId, body) when
 * the studentId is canonical. These tests drive that combo and verify
 * the row lands in `goal` table.
 *
 * Goals require a section (FK), so the setup creates a class with
 * curriculum (which mints sections) plus a student.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Goals — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  /**
   * Setup: a class with curriculum (so sections exist) and one student.
   * Returns courseId, enrollmentId, and the first sectionId.
   */
  async function setupCourseStudentSection(page, suffix) {
    const courseName = makeCourseName(`goals-${suffix}`);
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

    const student = makeStudent({ firstName: 'Goal', lastName: 'Probe' });
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

  /**
   * Drives the production goal-save flow: saveGoals (cache + localStorage)
   * + window.v2.saveGoal (RPC).
   */
  async function saveGoalProd(page, courseId, enrollmentId, sectionId, body) {
    return page.evaluate(
      async ({ cid, eid, secId, b }) => {
        const goals = window.getGoals(cid) || {};
        if (!goals[eid]) goals[eid] = {};
        goals[eid][secId] = b;
        window.saveGoals(cid, goals);
        if (window.v2 && window.v2.saveGoal) {
          await window.v2.saveGoal(eid, secId, b);
        }
      },
      { cid: courseId, eid: enrollmentId, secId: sectionId, b: body },
    );
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'create');
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Master argument structure by midterm.');
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.goals, 'goal must persist').toBeGreaterThan(0);
  });

  test('edits — replacing the goal body persists', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'edit');
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Original goal text.');
    await page.waitForTimeout(500);
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Edited goal text.');
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb.from('goal').select('body').eq('enrollment_id', eid).eq('section_id', secId).maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'goal row exists').not.toBeNull();
    expect(row.body).toBe('Edited goal text.');
  });

  test('deletes — clearing the goal text removes the row', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'delete');
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, 'Doomed goal.');
    await page.waitForTimeout(500);
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, '');
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.goals, 'goal row removed after empty save + sign-out').toBe(0);
  });

  test('race-immediate-signOut — saveGoal RPC must drain', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'race');
    await page.evaluate(
      ({ cid, eid, secId }) => {
        const goals = window.getGoals(cid) || {};
        if (!goals[eid]) goals[eid] = {};
        goals[eid][secId] = 'Race goal.';
        window.saveGoals(cid, goals);
        // Fire-and-forget the RPC, then sign out immediately
        if (window.v2 && window.v2.saveGoal) window.v2.saveGoal(eid, secId, 'Race goal.');
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.goals, 'goal must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — long-form goal text exact match', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'roundtrip');
    const body =
      'By the end of term, I want to:\n' +
      '  • Use evidence from at least 2 sources in my arguments.\n' +
      '  • Identify a counterargument and respond to it.\n' +
      '  • Re-read my work for clarity before submitting.';
    await saveGoalProd(page, ctx.courseId, ctx.enrollmentId, ctx.sectionId, body);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb.from('goal').select('body').eq('enrollment_id', eid).eq('section_id', secId).maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'goal row exists').not.toBeNull();
    expect(row.body).toBe(body);
  });
});
