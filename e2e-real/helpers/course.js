/**
 * Course-lifecycle helpers for real-Supabase tests.
 */

export const TEST_PREFIX = 'FV-PERSIST-TEST';

/**
 * Build a unique test course name. Prefix-scoped so cleanup is targeted;
 * timestamp-tagged so concurrent runs don't collide.
 */
export function makeCourseName(suffix) {
  return `${TEST_PREFIX}-${suffix}-${Date.now()}`;
}

/**
 * Create a course directly via the create_course RPC, bypassing the wizard.
 * Used by every spec that's not specifically testing the wizard — tests
 * should not couple themselves to the wizard's UI.
 */
export async function createTestCourse(page, name) {
  return page.evaluate(async courseName => {
    const sb = window._supabase;
    const res = await sb.rpc('create_course', {
      p_name: courseName,
      p_grade_level: '8',
      p_description: null,
      p_grading_system: 'proficiency',
      p_calc_method: 'mostRecent',
      p_decay_weight: 0.65,
      p_timezone: 'America/Vancouver',
    });
    if (res.error) throw new Error('create_course failed: ' + res.error.message);
    return res.data;
  }, name);
}

/**
 * Look up a course id by name. Returns null if missing.
 */
export async function getCourseIdByName(page, name) {
  return page.evaluate(async courseName => {
    const sb = window._supabase;
    const res = await sb.from('course').select('id').eq('name', courseName).maybeSingle();
    return res.data ? res.data.id : null;
  }, name);
}

/**
 * Archive every course owned by the test user that starts with the test
 * prefix. archive_course is a soft-delete; the RLS-gated function leaves
 * rows in the table but flags them archived. Idempotent — safe to call
 * before every test.
 */
export async function archiveTestCourses(page) {
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
  }, TEST_PREFIX);
}
