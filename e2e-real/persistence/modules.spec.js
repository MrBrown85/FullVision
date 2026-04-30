import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, createTestCourse, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';

/**
 * Modules — production write path is window.saveModules(cid, arr) which
 * is invoked from page-assignments (addModuleInline, updateModuleName,
 * updateModuleColor, deleteModule). The v2 RPC wrappers
 * window.v2.upsertModule and window.v2.deleteModule exist in shared/data.js
 * but are NOT called from production code today — saveModules only writes
 * to localStorage.
 *
 * If saveModules doesn't dispatch to Supabase, modules are lost on
 * sign-out. These tests exist to expose that gap; expect failures until
 * a saveModules → upsert_module dispatcher is wired up.
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
}

function buildModule(overrides = {}) {
  return {
    id: uid('mod'),
    name: 'Probe Module',
    color: '#0891b2',
    sortOrder: 0,
    created: new Date().toISOString(),
    ...overrides,
  };
}

test.describe('Modules — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('creates and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('mod-create'));
    const m = buildModule({ name: 'Probe Module' });
    await page.evaluate(({ cid, mod }) => window.saveModules(cid, [mod]), { cid: courseId, mod: m });
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(
      counts.modules,
      'module must persist — saveModules does not dispatch to upsert_module today, so this catches the gap',
    ).toBeGreaterThan(0);
  });

  test('edits — updating module name persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('mod-edit'));
    const m = buildModule({ name: 'Original Module' });
    await page.evaluate(({ cid, mod }) => window.saveModules(cid, [mod]), { cid: courseId, mod: m });
    await page.waitForTimeout(800);

    await page.evaluate(cid => {
      const list = window.getModules(cid).map(x => ({ ...x }));
      const target = list.find(x => x.name === 'Original Module');
      if (!target) throw new Error('module missing before edit');
      target.name = 'Edited Module';
      window.saveModules(cid, list);
    }, courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const row = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('module').select('name').eq('course_id', cid).maybeSingle();
      return r.data;
    }, courseId);
    expect(row, 'module row exists after edit').not.toBeNull();
    expect(row.name).toBe('Edited Module');
  });

  test('deletes and persists across sign-out', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('mod-delete'));
    const keep = buildModule({ name: 'Keep' });
    const drop = buildModule({ name: 'Drop' });
    await page.evaluate(({ cid, list }) => window.saveModules(cid, list), { cid: courseId, list: [keep, drop] });
    await page.waitForTimeout(800);

    await page.evaluate(cid => {
      const list = window.getModules(cid).filter(m => m.name !== 'Drop');
      window.saveModules(cid, list);
    }, courseId);
    await page.waitForTimeout(800);

    await recycleSession(page);
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.modules, 'one module remains after delete + sign-out').toBe(1);
  });

  test('race-immediate-signOut — saveModules must dispatch and drain', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('mod-race'));
    const m = buildModule({ name: 'Race Module' });
    await page.evaluate(
      ({ cid, mod }) => {
        window.saveModules(cid, [mod]);
      },
      { cid: courseId, mod: m },
    );
    await recycleSession(page);

    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.modules, 'module must reach Supabase even with immediate sign-out').toBeGreaterThan(0);
  });

  test('value round-trip — name, color, display order', async ({ page }) => {
    const courseId = await createTestCourse(page, makeCourseName('mod-roundtrip'));
    const m1 = buildModule({ name: 'Unit One', color: '#dc2626', sortOrder: 0 });
    const m2 = buildModule({ name: 'Unit Two', color: '#16a34a', sortOrder: 1 });
    const m3 = buildModule({ name: 'Unit Three', color: '#7c3aed', sortOrder: 2 });
    await page.evaluate(({ cid, list }) => window.saveModules(cid, list), { cid: courseId, list: [m1, m2, m3] });
    await page.waitForTimeout(1000);

    await recycleSession(page);
    const rows = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb
        .from('module')
        .select('name, color, display_order')
        .eq('course_id', cid)
        .order('display_order', { ascending: true });
      return r.data || [];
    }, courseId);

    expect(rows.length, 'all three modules round-trip').toBe(3);
    expect(rows.map(r => r.name)).toEqual(['Unit One', 'Unit Two', 'Unit Three']);
    expect(rows.map(r => r.color)).toEqual(['#dc2626', '#16a34a', '#7c3aed']);
  });
});
