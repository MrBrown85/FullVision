import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';
import { makeStudent } from '../helpers/fixtures.js';

/**
 * Notes — production write path is window.saveNotes(cid, obj) where obj is
 * keyed by enrollment id and the value is a free-text string. saveNotes
 * currently writes only to localStorage; there's no Supabase dispatcher
 * wired up. These tests will fail until saveNotes (or its production
 * call sites) dispatches via a `note` table RPC.
 *
 * The schema has `public.note` (id uuid, enrollment_id uuid, body text,
 * created_at). The deployed app has no upsert_note / delete_note RPCs
 * either — adding them is the fix this spec exposes.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Notes — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  async function setupCourseWithStudent(page, suffix) {
    const courseId = await createTestCourse(page, makeCourseName(`notes-${suffix}`));
    const student = makeStudent({ firstName: 'Notes', lastName: 'Probe' });
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
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = 'Showed great curiosity in the lesson today.';
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.notes, 'note row must persist').toBeGreaterThan(0);
  });

  test('edits — replacing the note text persists', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'edit');
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = 'Original note body.';
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(500);
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = 'Edited note body.';
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb.from('note').select('body').eq('enrollment_id', eid).maybeSingle();
      return r.data;
    }, ctx.enrollmentId);
    expect(row, 'note row exists').not.toBeNull();
    expect(row.body).toBe('Edited note body.');
  });

  test('deletes — clearing the note removes the row', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'delete');
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = 'Doomed note.';
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(800);
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        delete all[eid];
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.notes, 'note row removed after clear + sign-out').toBe(0);
  });

  test('race-immediate-signOut — saveNotes must drain', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'race');
    await page.evaluate(
      ({ cid, eid }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = 'Race note.';
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.notes, 'note must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — multi-paragraph note text exact match', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'roundtrip');
    const body = 'Line one — careful work.\nLine two — strong reasoning.\nLine three — ready to extend.';
    await page.evaluate(
      ({ cid, eid, b }) => {
        const all = window.getNotes(cid) || {};
        all[eid] = b;
        window.saveNotes(cid, all);
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId, b: body },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb.from('note').select('body').eq('enrollment_id', eid).maybeSingle();
      return r.data;
    }, ctx.enrollmentId);
    expect(row, 'note row exists').not.toBeNull();
    expect(row.body, 'multi-line text round-trips exact').toBe(body);
  });
});
