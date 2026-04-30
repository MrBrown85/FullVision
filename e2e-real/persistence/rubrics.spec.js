import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';

/**
 * Rubrics — production write path is window.saveRubrics(cid, arr) which
 * queues canonical upsert_rubric / delete_rubric RPCs through
 * _persistRubricsToCanonical. Each rubric has criteria; each criterion has
 * level descriptors and optional point values. These tests verify that the
 * full criteria + level structure round-trips, not just that a row exists.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

function buildRubric(name, opts = {}) {
  return {
    id: 'rub-local-' + Math.random().toString(36).slice(2, 8),
    title: name,
    description: opts.description || '',
    criteria: opts.criteria || [
      {
        id: 'crit-' + Math.random().toString(36).slice(2, 8),
        label: 'Accuracy',
        weight: 1,
        levels: { 4: 'Exemplary', 3: 'Proficient', 2: 'Developing', 1: 'Emerging' },
      },
      {
        id: 'crit-' + Math.random().toString(36).slice(2, 8),
        label: 'Clarity',
        weight: 0.5,
        levels: { 4: 'Crystal', 3: 'Clear', 2: 'Muddy', 1: 'Opaque' },
      },
    ],
  };
}

test.describe('Rubrics — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('rub-create'));
    const rubric = buildRubric('Probe Rubric');
    await page.evaluate(({ cid, r }) => window.saveRubrics(cid, [r]), { cid: courseId, r: rubric });
    await page.waitForTimeout(1200);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.rubrics, 'rubric must persist').toBeGreaterThan(0);

    // Confirm criteria rows exist too — the persistence isn't just the
    // top-level rubric; every criterion has its own row in `criterion`.
    const critCount = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('criterion')
        .select('id, rubric!inner(course_id)', { count: 'exact', head: true })
        .eq('rubric.course_id', cid);
      return r.count || 0;
    }, courseId);
    expect(critCount, 'two criteria persisted with the rubric').toBe(2);
  });

  test('edits — update rubric title and criterion descriptor', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('rub-edit'));
    const rubric = buildRubric('Original Rubric');
    await page.evaluate(({ cid, r }) => window.saveRubrics(cid, [r]), { cid: courseId, r: rubric });
    await page.waitForTimeout(1200);

    // Read back the canonical state from cache (saveRubrics rewrites cache
    // with server-minted UUIDs after upsert), then mutate via shallow copy.
    await page.evaluate(cid => {
      const list = (window.getRubrics ? window.getRubrics(cid) : window._cache?.rubrics?.[cid] || []).map(r => ({
        ...r,
        criteria: (r.criteria || []).map(c => ({ ...c, levels: { ...(c.levels || {}) } })),
      }));
      if (!list.length) throw new Error('rubric missing before edit');
      list[0].title = 'Edited Rubric';
      if (list[0].criteria && list[0].criteria[0]) {
        list[0].criteria[0].levels[4] = 'Outstanding';
      }
      window.saveRubrics(cid, list);
    }, courseId);
    await page.waitForTimeout(1200);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('rubric').select('name').eq('course_id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'rubric exists after edit').not.toBeNull();
    expect(row.name).toBe('Edited Rubric');

    const descriptor = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('criterion')
        .select('level4_descriptor, name, rubric!inner(course_id)')
        .eq('rubric.course_id', cid)
        .eq('name', 'Accuracy')
        .maybeSingle();
      return r.data;
    }, courseId);
    expect(descriptor, 'Accuracy criterion exists').not.toBeNull();
    expect(descriptor.level4_descriptor).toBe('Outstanding');
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('rub-delete'));
    const r1 = buildRubric('Keep');
    const r2 = buildRubric('Drop');
    await page.evaluate(({ cid, list }) => window.saveRubrics(cid, list), { cid: courseId, list: [r1, r2] });
    await page.waitForTimeout(1500);

    // Wait for both canonical IDs
    await page.waitForFunction(
      cid => {
        const list = (window.getRubrics ? window.getRubrics(cid) : window._cache?.rubrics?.[cid] || []) || [];
        if (list.length < 2) return false;
        return list.every(r => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(r.id || ''));
      },
      courseId,
      { timeout: 12_000 },
    );

    // Use deleteRubric — the production helper that the curriculum panel
    // wires up. It internally calls saveRubrics with the filtered list.
    await page.evaluate(cid => {
      const list = (window.getRubrics ? window.getRubrics(cid) : []) || [];
      const target = list.find(r => (r.title || r.name) === 'Drop');
      if (!target) throw new Error('Drop rubric missing');
      window.deleteRubric(cid, target.id);
    }, courseId);
    await page.waitForTimeout(1200);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.rubrics, 'one rubric remains after delete + sign-out').toBe(1);

    // Confirm criteria for the dropped rubric cascaded
    const critCount = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('criterion')
        .select('id, rubric!inner(course_id, name)', { count: 'exact', head: true })
        .eq('rubric.course_id', cid);
      return r.count || 0;
    }, courseId);
    expect(critCount, 'criteria cascaded — only Keep rubric criteria remain').toBe(2);
  });

  test('race-immediate-signOut — saveRubrics must drain before localStorage clears', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('rub-race'));
    const rubric = buildRubric('Race Rubric');
    await page.evaluate(
      ({ cid, r }) => {
        window.saveRubrics(cid, [r]);
      },
      { cid: courseId, r: rubric },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.rubrics, 'rubric must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — criteria, weights, level descriptors, and ordering', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('rub-roundtrip'));
    const rubric = buildRubric('Round Trip', {
      description: 'Verifies the criterion structure round-trips.',
      criteria: [
        {
          id: 'crit-rt-1',
          label: 'Reasoning',
          weight: 2,
          levels: { 4: 'Insightful', 3: 'Thoughtful', 2: 'Stated', 1: 'Missing' },
        },
        {
          id: 'crit-rt-2',
          label: 'Evidence',
          weight: 1,
          levels: { 4: 'Multiple sources', 3: 'Cited', 2: 'Mentioned', 1: 'None' },
        },
        {
          id: 'crit-rt-3',
          label: 'Form',
          weight: 0.5,
          levels: { 4: 'Polished', 3: 'Clean', 2: 'Rough', 1: 'Confusing' },
        },
      ],
    });
    await page.evaluate(({ cid, r }) => window.saveRubrics(cid, [r]), { cid: courseId, r: rubric });
    await page.waitForTimeout(1500);

    await recycleSession(page);
    const result = await page.evaluate(async cid => {
      const sb = window._supabase;
      const rub = await sb.from('rubric').select('id, name, description').eq('course_id', cid).maybeSingle();
      if (!rub.data) return null;
      const crits = await sb
        .from('criterion')
        .select(
          'name, weight, level4_descriptor, level3_descriptor, level2_descriptor, level1_descriptor, display_order',
        )
        .eq('rubric_id', rub.data.id)
        .order('display_order', { ascending: true });
      return {
        name: rub.data.name,
        description: rub.data.description,
        criteria: (crits.data || []).map(c => ({
          name: c.name,
          weight: Number(c.weight),
          l4: c.level4_descriptor,
          l3: c.level3_descriptor,
          l2: c.level2_descriptor,
          l1: c.level1_descriptor,
          order: c.display_order,
        })),
      };
    }, courseId);

    expect(result, 'rubric exists after round-trip').not.toBeNull();
    expect(result.name).toBe('Round Trip');
    expect(result.description).toBe('Verifies the criterion structure round-trips.');
    expect(result.criteria.length).toBe(3);
    // Ordering preserved
    expect(result.criteria.map(c => c.name)).toEqual(['Reasoning', 'Evidence', 'Form']);
    // Weights preserved
    expect(result.criteria.map(c => c.weight)).toEqual([2, 1, 0.5]);
    // Level descriptors preserved
    expect(result.criteria[0]).toMatchObject({
      l4: 'Insightful',
      l3: 'Thoughtful',
      l2: 'Stated',
      l1: 'Missing',
    });
    expect(result.criteria[1]).toMatchObject({
      l4: 'Multiple sources',
      l3: 'Cited',
      l2: 'Mentioned',
      l1: 'None',
    });
  });
});
