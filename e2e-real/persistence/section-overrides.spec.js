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
 * Section overrides — teacher-judgment proficiency override per
 * (enrollment, section). Production write path is
 * window.v2.saveSectionOverride(enrollmentId, sectionId, level, reason)
 * → upsert_section_override RPC (wrapped in _trackPendingSync via
 * _rpcOrNoop). Upserts by (enrollment_id, section_id).
 *
 * clear_section_override is the delete path. Requires a section (FK),
 * so setup uses the curriculum wizard.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Section overrides — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  async function setupCourseStudentSection(page, suffix) {
    const courseName = makeCourseName(`so-${suffix}`);
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

    const student = makeStudent({ firstName: 'Override', lastName: 'Probe' });
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

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'create');
    await page.evaluate(
      ({ eid, secId }) => window.v2.saveSectionOverride(eid, secId, 3, 'Excellent reasoning demonstrated.'),
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.sectionOverrides, 'section_override must persist').toBeGreaterThan(0);
  });

  test('edits — updating the override level persists', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'edit');
    await page.evaluate(({ eid, secId }) => window.v2.saveSectionOverride(eid, secId, 2, 'Initial override.'), {
      eid: ctx.enrollmentId,
      secId: ctx.sectionId,
    });
    await page.waitForTimeout(500);
    await page.evaluate(({ eid, secId }) => window.v2.saveSectionOverride(eid, secId, 4, 'Revised override.'), {
      eid: ctx.enrollmentId,
      secId: ctx.sectionId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb
          .from('section_override')
          .select('level, reason')
          .eq('enrollment_id', eid)
          .eq('section_id', secId)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'section_override row exists').not.toBeNull();
    expect(Number(row.level), 'updated level persists').toBe(4);
    expect(row.reason).toBe('Revised override.');
  });

  test('deletes — clearSectionOverride removes the row', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'delete');
    await page.evaluate(({ eid, secId }) => window.v2.saveSectionOverride(eid, secId, 3, 'Doomed override.'), {
      eid: ctx.enrollmentId,
      secId: ctx.sectionId,
    });
    await page.waitForTimeout(500);
    await page.evaluate(({ eid, secId }) => window.v2.clearSectionOverride(eid, secId), {
      eid: ctx.enrollmentId,
      secId: ctx.sectionId,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.sectionOverrides, 'section_override removed after clear + sign-out').toBe(0);
  });

  test('race-immediate-signOut — saveSectionOverride must drain', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'race');
    await page.evaluate(
      ({ eid, secId }) => {
        window.v2.saveSectionOverride(eid, secId, 3, null);
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(
      counts.sectionOverrides,
      'section_override must reach Supabase even with immediate sign-out',
    ).toBeGreaterThan(0);
  });

  test('value round-trip — level and reason exact match', async ({ page }) => {
    const ctx = await setupCourseStudentSection(page, 'roundtrip');
    const reason = 'Consistent application of criteria — override to 4.';
    await page.evaluate(({ eid, secId, r }) => window.v2.saveSectionOverride(eid, secId, 4, r), {
      eid: ctx.enrollmentId,
      secId: ctx.sectionId,
      r: reason,
    });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb
          .from('section_override')
          .select('level, reason')
          .eq('enrollment_id', eid)
          .eq('section_id', secId)
          .maybeSingle();
        return r.data;
      },
      { eid: ctx.enrollmentId, secId: ctx.sectionId },
    );
    expect(row, 'section_override row exists').not.toBeNull();
    expect(Number(row.level), 'level round-trips exactly').toBe(4);
    expect(row.reason, 'reason text round-trips exactly').toBe(reason);
  });
});
