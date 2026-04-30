import { test, expect } from '@playwright/test';
import { signIn, signOut, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts, queryRow } from '../helpers/db.js';
import { makeStudent } from '../helpers/fixtures.js';

/**
 * Students — production write path is window.saveStudents(cid, arr) which
 * queues canonical create_student_and_enroll / update_enrollment /
 * update_student / withdraw_enrollment RPCs through _persistStudentsToCanonical.
 *
 * Every test drives that helper directly (the same way cmSaveStudent does
 * inside the class manager) — never the underlying RPC.
 */

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ENV_OK = !!(TEST_USER_EMAIL && TEST_USER_PASSWORD && SUPABASE_URL && SUPABASE_KEY);

test.describe('Students — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('students-create'));
    const student = makeStudent({ firstName: 'Create', lastName: 'Probe' });
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });

    // Wait for the in-flight write before sign-out (this is NOT the race
    // test — that's a separate case below). We want to confirm a clean
    // create-then-cycle persists.
    await page.evaluate(() => window.GB && window.GB.getSyncStatus && window.GB.getSyncStatus());
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.enrollments, 'student must persist across sign-out').toBeGreaterThan(0);
  });

  test('edits and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('students-edit'));
    const student = makeStudent({ firstName: 'Original', lastName: 'Probe' });
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });
    await page.waitForTimeout(800);

    // Edit — saveStudents diffs prev vs arr by id. Shallow-copy each row
    // so prev (which is _cache.students[cid].slice()) and arr no longer
    // share the same object references; otherwise the diff sees the
    // already-mutated value on both sides and no update RPC fires.
    // Look up by firstName not by id, because the canonical-rekey has
    // already replaced the local id with the server UUID by now.
    await page.evaluate(cid => {
      const students = window.getStudents(cid).map(s => ({ ...s }));
      const s = students.find(x => x.firstName === 'Original');
      if (!s) throw new Error('student missing before edit');
      s.firstName = 'Edited';
      s.preferred = 'Ed';
      window.saveStudents(cid, students);
    }, courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    // Scope by enrollment.course_id — student rows aren't course-scoped
    // and prior runs leave behind orphaned "Edited" students.
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('enrollment')
        .select('student!inner(first_name, preferred_name)')
        .eq('course_id', cid)
        .maybeSingle();
      return r.data ? r.data.student : null;
    }, courseId);
    expect(row, 'edit must persist').not.toBeNull();
    expect(row.first_name).toBe('Edited');
    expect(row.preferred_name).toBe('Ed');
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('students-delete'));
    const keep = makeStudent({ firstName: 'Keep', lastName: 'Probe' });
    const drop = makeStudent({ firstName: 'Drop', lastName: 'Probe' });
    await page.evaluate(({ cid, ss }) => window.saveStudents(cid, ss), { cid: courseId, ss: [keep, drop] });
    await page.waitForTimeout(1000);

    // Wait for canonical IDs to land on both students before removing one;
    // otherwise saveStudents can't fire withdraw_enrollment for a student
    // whose id is still the local placeholder.
    await page.waitForFunction(
      cid => {
        const students = window.getStudents(cid);
        if (!students || students.length < 2) return false;
        return students.every(s => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s.id || ''));
      },
      courseId,
      { timeout: 8000 },
    );
    const beforeDelete = await readCourseRowCounts(page, { courseId });
    expect(beforeDelete.enrollments).toBeGreaterThanOrEqual(2);

    // Drop one — saveStudents detects the removal and queues
    // withdraw_enrollment for the missing UUID.
    await page.evaluate(cid => {
      const students = window.getStudents(cid).filter(s => s.firstName !== 'Drop');
      window.saveStudents(cid, students);
    }, courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    // withdraw_enrollment is a soft delete — sets withdrawn_at, doesn't
    // remove the row. So readCourseRowCounts (which filters
    // withdrawn_at IS NULL via enrollment FK) will still see it. We assert
    // against the active enrollment count returned by list_teacher_courses
    // semantics.
    const remaining = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('enrollment')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', cid)
        .is('withdrawn_at', null);
      return r.count || 0;
    }, courseId);
    expect(remaining, 'one student remains active after delete + sign-out').toBe(1);
  });

  test('race-immediate-signOut — saveStudents queue must drain before localStorage is cleared', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('students-race'));
    const student = makeStudent({ firstName: 'Race', lastName: 'Probe' });

    // Fire the helper, then sign out IMMEDIATELY without any wait. This is
    // the production failure mode: user clicks Save and clicks Sign Out
    // before the queue drains. window.signOut now awaits
    // waitForPendingSyncs(); the test confirms that gate is doing its
    // job.
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });
    await signOut(page);
    await signIn(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(
      counts.enrollments,
      'student must reach Supabase even with no manual wait between saveStudents and signOut',
    ).toBeGreaterThan(0);
  });

  test('value round-trip — designations, pronouns, student number, dob', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('students-roundtrip'));
    const student = makeStudent({
      firstName: 'Round',
      lastName: 'Trip',
      preferred: 'RT',
      pronouns: 'they/them',
      studentNumber: 'SN-12345',
      email: 'rt@example.test',
      dateOfBirth: '2008-04-29',
      designations: ['IEP', 'ELL'],
    });
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });
    await page.waitForTimeout(1000);

    await recycleSession(page);

    // Scope the lookup via enrollment.course_id so prior runs' orphaned
    // "Round Trip" student rows (the student table isn't course-scoped;
    // withdraw_enrollment is a soft-delete that leaves student rows behind)
    // don't make this query ambiguous.
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('enrollment')
        .select(
          'designations, student!inner(first_name, last_name, preferred_name, pronouns, student_number, email, date_of_birth)',
        )
        .eq('course_id', cid)
        .eq('student.first_name', 'Round')
        .maybeSingle();
      return r.data ? r.data : null;
    }, courseId);
    expect(row, 'enrollment row exists after round-trip').not.toBeNull();
    expect(row.student.preferred_name).toBe('RT');
    expect(row.student.pronouns).toBe('they/them');
    expect(row.student.student_number).toBe('SN-12345');
    expect(row.student.email).toBe('rt@example.test');
    expect(String(row.student.date_of_birth)).toBe('2008-04-29');

    expect(Array.isArray(row.designations)).toBe(true);
    expect(row.designations.sort()).toEqual(['ELL', 'IEP']);
  });
});
