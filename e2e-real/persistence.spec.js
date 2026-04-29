import { test, expect } from '@playwright/test';

/**
 * Real-Supabase persistence regression tests.
 *
 * These tests exercise the bugs that the mocked-auth / mocked-localStorage
 * test suite cannot see:
 *
 *   1. Curriculum competencies (tags) created via the wizard never reach
 *      Supabase — `_patchMapId` over-patches because section + tag share a
 *      baseId, so `upsert_tag` is called with a section UUID and 500s.
 *
 *   2. Students added via the class manager are queued for an async RPC, but
 *      sign-out clears localStorage before the queue drains
 *      (`_pendingSyncs` is permanently 0, `waitForPendingSyncs` returns
 *      immediately).
 *
 *   3. Categories survive sign-out but are invisible to the assignment
 *      dropdown because `get_gradebook` doesn't return them and the form
 *      reads from `_cache.categories`.
 *
 * Each test creates a uniquely-named course, exercises the failing path,
 * signs out and back in, and asserts state in Supabase. They are EXPECTED
 * TO FAIL on main today. They should pass once the underlying bugs are
 * fixed.
 *
 * Cleanup: archive_course is called for any leftover test courses at the
 * start of each test so re-runs don't pile up debris.
 */

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TEST_COURSE_PREFIX = 'FV-PERSIST-TEST';

const ENV_OK = !!(TEST_USER_EMAIL && TEST_USER_PASSWORD && SUPABASE_URL && SUPABASE_KEY);

test.describe('Persistence across sign-out — real Supabase', () => {
  test.skip(
    !ENV_OK,
    'Real-Supabase tests require TEST_USER_EMAIL, TEST_USER_PASSWORD, SUPABASE_URL, SUPABASE_KEY (see e2e-real/README.md)',
  );

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('curriculum competencies persist in Supabase after wizard finish + sign-out', async ({ page }) => {
    const courseName = `${TEST_COURSE_PREFIX}-curriculum-${Date.now()}`;

    await openClassManagerAndStartCreate(page);
    await pickGrade(page, 8);
    await pickSubject(page, 'Science');
    await toggleCourse(page, 'SCI8');
    await goToStep2(page);
    await page.fill('#cm-new-name', courseName);
    await goToStep3(page);
    await finishWizard(page);

    // Verify state immediately after wizard finish, before sign-out, so we
    // know whether the bug is "writes never happen" or "sign-out drops them".
    const beforeLogout = await readCourseRowCounts(page, courseName);
    expect(beforeLogout, 'in-flight writes should land before wizard returns').toMatchObject({
      subjects: expect.any(Number),
      sections: expect.any(Number),
      tags: expect.any(Number),
    });
    expect(
      beforeLogout.tags,
      'tags must be > 0 after wizard finish — currently 0 due to upsert_tag UPDATE-branch bug',
    ).toBeGreaterThan(0);

    await signOutFlow(page);
    await signIn(page);

    const afterRelogin = await readCourseRowCounts(page, courseName);
    expect(afterRelogin.tags, 'tags must persist across sign-out').toBeGreaterThan(0);
    expect(afterRelogin.sections, 'sections must persist across sign-out').toBeGreaterThan(0);
    expect(afterRelogin.subjects, 'subjects must persist across sign-out').toBeGreaterThan(0);
  });

  test('students added via saveStudents persist after sign-out', async ({ page }) => {
    const courseName = `${TEST_COURSE_PREFIX}-students-${Date.now()}`;

    // Create a course server-side so this test isn't coupled to the wizard.
    // The UI bug under test is the sign-out / async-RPC race in saveStudents,
    // not anything wizard-specific.
    const courseId = await createCourseDirect(page, courseName);

    // Trigger the same code path the UI hits: cmSaveStudent → saveStudents
    // → _persistStudentsToCanonical → queued create_student_and_enroll.
    await page.evaluate(
      ({ cid }) => {
        const student = {
          id: 'stu-' + Date.now().toString(36),
          firstName: 'Persistence',
          lastName: 'Probe',
          preferred: '',
          pronouns: '',
          studentNumber: '',
          email: '',
          dateOfBirth: '',
          designations: [],
          attendance: [],
          sortName: 'Probe Persistence',
          enrolledDate: new Date().toISOString().slice(0, 10),
        };
        // saveStudents is exported globally from shared/data.js.
        window.saveStudents(cid, [student]);
      },
      { cid: courseId },
    );

    // Sign out IMMEDIATELY without giving the queue extra time. This is the
    // window the bug exploits in production — a fast sign-out after add.
    await signOutFlow(page);
    await signIn(page);

    const afterRelogin = await readCourseRowCounts(page, courseName);
    expect(
      afterRelogin.enrollments,
      'student must persist across sign-out — currently lost because waitForPendingSyncs is broken',
    ).toBeGreaterThan(0);
  });

  test('categories created via class manager are visible to assignment dropdown', async ({ page }) => {
    const courseName = `${TEST_COURSE_PREFIX}-categories-${Date.now()}`;
    const courseId = await createCourseDirect(page, courseName);

    // Write the category through the same RPC the class manager uses.
    // The bug under test is on the READ side (get_gradebook doesn't return
    // categories), so what matters is that the category exists in Supabase
    // before we navigate to assignments.
    await page.evaluate(
      async ({ cid }) => {
        await window.v2.upsertCategory({
          id: null,
          courseId: cid,
          name: 'Labs',
          weight: 50,
          displayOrder: 0,
        });
      },
      { cid: courseId },
    );

    const counts = await readCourseRowCounts(page, courseName);
    expect(counts.categories, 'category was created').toBeGreaterThan(0);

    // Cycle sign-out before checking the dropdown. This exercises the
    // get_gradebook re-hydration path on a fresh sign-in, which is what
    // the production read path actually depends on.
    await signOutFlow(page);
    await signIn(page);

    // Navigate to the assignments page, switch to the test course, then
    // open New Assessment. The URL ?course= param is not honored by
    // page-assignments init (it reads from _activeCourse), so we drive the
    // switch explicitly through the exposed API.
    await page.goto(`/teacher/app.html#/assignments`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.PageAssignments !== undefined, null, { timeout: 15_000 });
    await page.evaluate(cid => window.PageAssignments.switchCourse(cid), courseId);
    await page.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (document.getElementById('af-category')) return;
        const btn = document.querySelector('[data-action="showNewForm"]');
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 200));
      }
    });
    await page.waitForSelector('#af-category', { timeout: 10_000 });

    const optionTexts = await page.$$eval('#af-category option', opts => opts.map(o => o.textContent.trim()));
    expect(
      optionTexts.length,
      'dropdown must include the user-created categories, not just "No Category"',
    ).toBeGreaterThan(1);
    expect(optionTexts).toContain('Labs');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────

async function signIn(page) {
  await page.goto('/login.html');
  await page.fill('#si-email', TEST_USER_EMAIL);
  await page.fill('#si-password', TEST_USER_PASSWORD);
  await page.click('#si-submit');
  await page.waitForURL('**/teacher/app.html**', { timeout: 15_000 });
  await page.waitForFunction(() => window.DashClassManager !== undefined, null, { timeout: 15_000 });
  // Wait for the initial bootstrap RPC chain to settle by waiting for the
  // supabase client and an authenticated session.
  await page.waitForFunction(
    async () => {
      if (!window._supabase || !window._supabase.auth) return false;
      const { data } = await window._supabase.auth.getSession();
      return !!(data && data.session);
    },
    null,
    { timeout: 15_000 },
  );
}

async function signOutFlow(page) {
  // Trigger the production code path: window.signOut wraps
  // waitForPendingSyncs → supabase.auth.signOut → localStorage clear.
  // This is exactly what users hit via the account menu's Sign Out button.
  await page.evaluate(() => window.signOut && window.signOut());
  await page.waitForURL('**/login.html', { timeout: 10_000 });
}

async function archiveTestCourses(page) {
  await page.evaluate(async prefix => {
    const sb = window._supabase;
    if (!sb) return;
    const res = await sb.rpc('list_teacher_courses');
    if (res.error || !Array.isArray(res.data)) return;
    for (const c of res.data) {
      if (c && c.name && c.name.startsWith(prefix)) {
        await sb.rpc('archive_course', { p_course_id: c.id, p_archived: true });
      }
    }
  }, TEST_COURSE_PREFIX);
}

async function openClassManagerAndStartCreate(page) {
  await page.evaluate(() => window.DashClassManager.openClassManager());
  // Initial empty-state render and the data-loaded sidebar render both expose
  // a [data-action="cmStartCreate"] button, but they swap the DOM node out
  // between renders. Poll inside a single evaluate so we don't race the swap.
  await page.evaluate(async () => {
    const dcm = window.DashClassManager;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const btn = document.querySelector('[data-action="cmStartCreate"]');
      if (btn) {
        dcm.handleAction('cmStartCreate', btn, null);
        return;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('cmStartCreate button never appeared');
  });
  // Wait for CURRICULUM_INDEX to load, otherwise the grade picker won't render the courses.
  await page.waitForFunction(
    () =>
      typeof CURRICULUM_INDEX !== 'undefined' && CURRICULUM_INDEX !== null && Object.keys(CURRICULUM_INDEX).length > 0,
    null,
    { timeout: 10_000 },
  );
  // Re-render so the grade buttons show up.
  await page.evaluate(() => window.DashClassManager.renderClassManager());
  await page.waitForSelector('[data-action="cwSelectGrade"]', { timeout: 5000 });
}

async function pickGrade(page, grade) {
  await page.evaluate(g => {
    const btn = document.querySelector(`[data-action="cwSelectGrade"][data-grade="${g}"]`);
    window.DashClassManager.handleAction('cwSelectGrade', btn, null);
  }, grade);
  await page.waitForSelector('[data-action="cwSelectSubject"]', { timeout: 5000 });
}

async function pickSubject(page, subjectName) {
  await page.evaluate(name => {
    const btn = Array.from(document.querySelectorAll('[data-action="cwSelectSubject"]')).find(
      b => b.textContent.trim() === name,
    );
    if (!btn) throw new Error(`Subject not found: ${name}`);
    window.DashClassManager.handleAction('cwSelectSubject', btn, null);
  }, subjectName);
  await page.waitForSelector('[data-action="cwToggleCourse"]', { timeout: 5000 });
}

async function toggleCourse(page, tag) {
  await page.evaluate(t => {
    const btn = document.querySelector(`[data-action="cwToggleCourse"][data-tag="${t}"]`);
    if (!btn) throw new Error(`Course not found: ${t}`);
    window.DashClassManager.handleAction('cwToggleCourse', btn, null);
  }, tag);
}

async function goToStep2(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="cwGoToStep2"]');
    window.DashClassManager.handleAction('cwGoToStep2', btn, null);
  });
  await page.waitForSelector('#cm-new-name', { timeout: 5000 });
}

async function goToStep3(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="cwGoToStep3"]');
    window.DashClassManager.handleAction('cwGoToStep3', btn, null);
  });
  await page.waitForSelector('[data-action="cwFinishCreate"]', { timeout: 5000 });
}

async function finishWizard(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="cwFinishCreate"]');
    window.DashClassManager.handleAction('cwFinishCreate', btn, null);
  });
  // PR #99 made cwFinishCreate await dispatch before the editor renders, so
  // once the editor's categories field shows up the V2 dispatch has settled.
  await page.waitForSelector('[data-action="cmCatAdd"]', { timeout: 15_000 });
}

async function readCourseRowCounts(page, courseName) {
  // Poll the `course` table directly until the row appears or we time out.
  // createCourse fires its create_course RPC without awaiting, so there's a
  // brief window after the wizard finishes where the row hasn't landed in
  // Supabase yet.
  return page.evaluate(
    async ({ name, timeoutMs }) => {
      const sb = window._supabase;
      if (!sb) return null;
      const deadline = Date.now() + timeoutMs;
      let cid = null;
      while (Date.now() < deadline) {
        const res = await sb.from('course').select('id').eq('name', name).maybeSingle();
        if (res.data && res.data.id) {
          cid = res.data.id;
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      if (!cid) return { found: false, courseName: name };
      const [enr, cat, sub, sec, tags] = await Promise.all([
        sb.from('enrollment').select('id', { count: 'exact', head: true }).eq('course_id', cid),
        sb.from('category').select('id', { count: 'exact', head: true }).eq('course_id', cid),
        sb.from('subject').select('id', { count: 'exact', head: true }).eq('course_id', cid),
        sb.from('section').select('id', { count: 'exact', head: true }).eq('course_id', cid),
        sb
          .from('tag')
          .select('id, section!inner(course_id)', { count: 'exact', head: true })
          .eq('section.course_id', cid),
      ]);
      return {
        found: true,
        courseId: cid,
        enrollments: enr.count || 0,
        categories: cat.count || 0,
        subjects: sub.count || 0,
        sections: sec.count || 0,
        tags: tags.count || 0,
      };
    },
    { name: courseName, timeoutMs: 15_000 },
  );
}

/**
 * Create a course directly via Supabase RPC, bypassing the wizard. Used by
 * tests that aren't about the wizard itself — they only need a valid course
 * row to attach students/categories to.
 */
async function createCourseDirect(page, courseName) {
  return page.evaluate(async name => {
    const sb = window._supabase;
    const res = await sb.rpc('create_course', {
      p_name: name,
      p_grade_level: '8',
      p_description: null,
      p_grading_system: 'proficiency',
      p_calc_method: 'mostRecent',
      p_decay_weight: 0.65,
      p_timezone: 'America/Vancouver',
    });
    if (res.error) throw new Error('create_course failed: ' + res.error.message);
    return res.data;
  }, courseName);
}

async function getCourseIdByName(page, courseName) {
  return page.evaluate(async name => {
    const sb = window._supabase;
    const res = await sb.from('course').select('id').eq('name', name).maybeSingle();
    return res.data ? res.data.id : null;
  }, courseName);
}
