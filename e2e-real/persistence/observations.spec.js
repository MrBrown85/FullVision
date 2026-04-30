import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';
import { makeStudent, makeObservation } from '../helpers/fixtures.js';

/**
 * Observations — production write path is window.createObservationRich /
 * window.updateObservationRich. Both are wrapped in _trackPendingSync.
 * Rich observations are joined to enrollments, tags, and custom_tags via
 * the observation_student / observation_tag / observation_custom_tag
 * tables; tests verify both the row and the join records.
 *
 * Quick observations (legacy, addQuickOb) flow through the same RPC chain
 * via _persistObservationCreate, but the rich path is the one the
 * page-observations UI uses for user-driven creates.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Observations — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  /**
   * Setup: a course with one enrolled student. Observations need to link
   * to enrollments, so this is the minimum scaffolding for every test.
   */
  async function setupCourseWithStudent(page, suffix) {
    const courseId = await createTestCourse(page, makeCourseName(`obs-${suffix}`));
    const student = makeStudent({ firstName: 'Obs', lastName: 'Probe' });
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, [s]), { cid: courseId, s: student });
    await page.waitForFunction(
      cid => {
        const s = window.getStudents(cid);
        return s && s.length && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s[0].id || '');
      },
      courseId,
      { timeout: 10_000 },
    );
    const enrollmentId = await page.evaluate(cid => window.getStudents(cid)[0].id, courseId);
    return { courseId, enrollmentId };
  }

  test('creates and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'create');
    const obs = makeObservation({
      body: 'Showed strong leadership during group work.',
      sentiment: 'positive',
      contextType: 'collab',
      enrollmentIds: [ctx.enrollmentId],
    });
    await page.evaluate(o => window.createObservationRich(o), { ...obs, courseId: ctx.courseId });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.observations, 'observation row must persist').toBeGreaterThan(0);

    // Confirm the observation_student join row also persisted
    const linked = await page.evaluate(
      async ({ cid, eid }) => {
        const sb = window._supabase;
        const r = await sb
          .from('observation_student')
          .select('observation_id, observation!inner(course_id)', { count: 'exact', head: true })
          .eq('observation.course_id', cid)
          .eq('enrollment_id', eid);
        return r.count || 0;
      },
      { cid: ctx.courseId, eid: ctx.enrollmentId },
    );
    expect(linked, 'observation_student join row must persist').toBeGreaterThan(0);
  });

  test('edits and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'edit');
    const created = await page.evaluate(
      async params => {
        const res = await window.createObservationRich(params);
        return res && res.data ? res.data : null;
      },
      { courseId: ctx.courseId, body: 'Original body', sentiment: 'neutral', enrollmentIds: [ctx.enrollmentId] },
    );
    expect(created, 'observation id returned').not.toBeNull();
    const obsId = created;
    await page.waitForTimeout(500);

    await page.evaluate(
      async ({ id }) => {
        await window.updateObservationRich(id, { body: 'Edited body', sentiment: 'positive' });
      },
      { id: obsId },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async id => {
      const sb = window._supabase;
      const r = await sb.from('observation').select('body, sentiment').eq('id', id).maybeSingle();
      return r.data;
    }, obsId);
    expect(row, 'observation exists after edit + sign-out').not.toBeNull();
    expect(row.body).toBe('Edited body');
    expect(row.sentiment).toBe('positive');
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'delete');
    const obsId = await page.evaluate(
      async params => {
        const res = await window.createObservationRich(params);
        return res && res.data ? res.data : null;
      },
      { courseId: ctx.courseId, body: 'Doomed observation', enrollmentIds: [ctx.enrollmentId] },
    );
    await page.waitForTimeout(500);
    const before = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(before.observations).toBeGreaterThan(0);

    // Production delete path: deleteQuickOb → _persistObservationDelete →
    // delete_observation RPC. Tests call the RPC directly via supabase-js
    // because there's no user-facing wrapper that takes just an id; the UI
    // delete button reaches through the per-student observations cache.
    await page.evaluate(async id => {
      const sb = window._supabase;
      await sb.rpc('delete_observation', { p_id: id });
    }, obsId);
    await page.waitForTimeout(500);

    await recycleSession(page);
    const after = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(after.observations, 'observation row removed after delete + sign-out').toBe(0);

    // The observation_student join row must cascade
    const linked = await page.evaluate(
      async ({ eid }) => {
        const sb = window._supabase;
        const r = await sb
          .from('observation_student')
          .select('observation_id', { count: 'exact', head: true })
          .eq('enrollment_id', eid);
        return r.count || 0;
      },
      { eid: ctx.enrollmentId },
    );
    expect(linked, 'observation_student row cascade-deleted').toBe(0);
  });

  test('race-immediate-signOut — createObservationRich must drain', async ({ page }) => {
    const ctx = await setupCourseWithStudent(page, 'race');
    // Fire and IMMEDIATELY recycle. No await on createObservationRich —
    // production user clicks Save then clicks Sign Out.
    await page.evaluate(
      params => {
        window.createObservationRich(params);
      },
      { courseId: ctx.courseId, body: 'Race body', enrollmentIds: [ctx.enrollmentId] },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId: ctx.courseId });
    expect(counts.observations, 'observation must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — body, sentiment, context, multi-student link', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('obs-roundtrip'));
    // Two students so we can verify a multi-link observation
    const s1 = makeStudent({ firstName: 'A', lastName: 'Probe' });
    const s2 = makeStudent({ firstName: 'B', lastName: 'Probe' });
    await page.evaluate(({ cid, ss }) => window.saveStudents(cid, ss), { cid: courseId, ss: [s1, s2] });
    await page.waitForFunction(
      cid => {
        const s = window.getStudents(cid);
        if (!s || s.length < 2) return false;
        return s.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(x.id || ''));
      },
      courseId,
      { timeout: 12_000 },
    );
    const enrollmentIds = await page.evaluate(cid => window.getStudents(cid).map(s => s.id), courseId);

    const obsId = await page.evaluate(
      async params => {
        const res = await window.createObservationRich(params);
        return res && res.data ? res.data : null;
      },
      {
        courseId,
        body: 'Group worked through a tough debate.',
        sentiment: 'positive',
        contextType: 'discussion',
        enrollmentIds,
      },
    );
    await page.waitForTimeout(800);

    await recycleSession(page);
    const result = await page.evaluate(async id => {
      const sb = window._supabase;
      const obs = await sb.from('observation').select('body, sentiment, context_type').eq('id', id).maybeSingle();
      const links = await sb.from('observation_student').select('enrollment_id').eq('observation_id', id);
      return {
        body: obs.data && obs.data.body,
        sentiment: obs.data && obs.data.sentiment,
        contextType: obs.data && obs.data.context_type,
        enrollmentIds: (links.data || []).map(l => l.enrollment_id).sort(),
      };
    }, obsId);

    expect(result.body).toBe('Group worked through a tough debate.');
    expect(result.sentiment).toBe('positive');
    expect(result.contextType).toBe('discussion');
    expect(result.enrollmentIds).toEqual(enrollmentIds.slice().sort());
  });
});
