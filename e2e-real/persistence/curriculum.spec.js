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

/**
 * Curriculum — the only path that exercises the full wizard. The other four
 * specs in this suite use createTestCourse to skip the wizard. Curriculum
 * tests start from the wizard because that's where the original tag-write
 * bug lived (cwFinishCreate's _dispatchMapToV2 short-circuiting on a
 * non-canonical course id; _patchMapId over-writing the tag's id with the
 * section's UUID).
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Curriculum (wizard) — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  async function buildClassWithCurriculum(page, name, curriculumTag = 'SCI8') {
    await openWizardFromClassManager(page);
    await pickGrade(page, 8);
    await pickSubject(page, 'Science');
    await toggleCurriculumTag(page, curriculumTag);
    await wizardGoToStep(page, 2);
    await setWizardClassName(page, name);
    await wizardGoToStep(page, 3);
    await finishWizard(page);
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const courseName = makeCourseName('curr-create');
    await buildClassWithCurriculum(page, courseName);

    const before = await readCourseRowCounts(page, courseName);
    expect(before.subjects, 'subjects landed via wizard').toBeGreaterThan(0);
    expect(before.sections, 'sections landed via wizard').toBeGreaterThan(0);
    expect(before.tags, 'tags landed via wizard').toBeGreaterThan(0);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, courseName);
    expect(after.subjects).toBe(before.subjects);
    expect(after.sections).toBe(before.sections);
    expect(after.tags).toBe(before.tags);
  });

  test('edits — adding a custom subject after the wizard persists', async ({ page }) => {
    const courseName = makeCourseName('curr-edit');
    await buildClassWithCurriculum(page, courseName);
    const before = await readCourseRowCounts(page, courseName);

    // Click "+ Add Subject" via the action handler — the same path the user
    // hits inside the curriculum panel.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-action="cmAddSubject"]');
      window.DashClassManager.handleAction('cmAddSubject', btn, null);
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, courseName);
    expect(after.subjects, 'one new subject persisted').toBe(before.subjects + 1);
  });

  test('deletes — removing a subject persists across sign-out', async ({ page }) => {
    const courseName = makeCourseName('curr-delete');
    await buildClassWithCurriculum(page, courseName);
    const before = await readCourseRowCounts(page, courseName);
    expect(before.subjects).toBeGreaterThan(0);

    // Delete the first subject via the production action handler.
    // cmDeleteSubject pops a "this subject has N sections, delete them
    // too?" confirm dialog when sections exist (SCI8 has 6). Override
    // window.showConfirm to auto-accept so the test exercises the
    // confirmed-delete branch the user reaches by clicking "Delete All".
    await page.evaluate(async cid => {
      const map = window.getLearningMap(cid);
      const subId = map.subjects && map.subjects[0] && map.subjects[0].id;
      if (!subId) throw new Error('no subject to delete');
      window.showConfirm = function (_t, _m, _b, _k, onConfirm) {
        if (typeof onConfirm === 'function') onConfirm();
      };
      const fakeBtn = { dataset: { subid: subId }, tagName: 'BUTTON' };
      window.DashClassManager.handleAction('cmDeleteSubject', fakeBtn, null);
    }, before.courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, courseName);
    expect(after.subjects, 'subject was removed').toBe(before.subjects - 1);
  });

  test('race-immediate-signOut — wizard finish + immediate sign-out', async ({ page }) => {
    const courseName = makeCourseName('curr-race');
    await openWizardFromClassManager(page);
    await pickGrade(page, 8);
    await pickSubject(page, 'Science');
    await toggleCurriculumTag(page, 'SCI8');
    await wizardGoToStep(page, 2);
    await setWizardClassName(page, courseName);
    await wizardGoToStep(page, 3);
    await finishWizard(page);
    // finishWizard already awaits the dispatch, but immediately recycle
    // afterwards anyway — confirms the entire wizard-finish sequence is
    // tracked under _pendingSyncs.
    await recycleSession(page);
    const after = await readCourseRowCounts(page, courseName);
    expect(after.tags, 'curriculum tags survive immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — tag.code and section.name come back unchanged', async ({ page }) => {
    const courseName = makeCourseName('curr-roundtrip');
    await buildClassWithCurriculum(page, courseName);
    const before = await readCourseRowCounts(page, courseName);

    // Capture all tag.code values before sign-out
    const beforeCodes = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('tag').select('code, label, section!inner(course_id, name)').eq('section.course_id', cid);
      return (r.data || []).map(t => ({ code: t.code, label: t.label, section: t.section.name }));
    }, before.courseId);
    expect(beforeCodes.length).toBeGreaterThan(0);
    // Each tag has a curriculum-derived code — none should be a UUID.
    for (const t of beforeCodes) {
      expect(t.code, 'tag.code must be the curriculum short code, never a UUID').not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}/i,
      );
    }

    await recycleSession(page);
    const afterCodes = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('tag').select('code, label, section!inner(course_id, name)').eq('section.course_id', cid);
      return (r.data || []).map(t => ({ code: t.code, label: t.label, section: t.section.name }));
    }, before.courseId);

    // Sort both for stable equality
    const sortKey = a => `${a.section}|${a.code}|${a.label}`;
    expect(afterCodes.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
      beforeCodes.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    );
  });
});
