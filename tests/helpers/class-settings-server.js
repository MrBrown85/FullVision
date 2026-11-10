/**
 * One class on a stand-in server, for tests of class settings saved from
 * more than one device (tests/stale-settings-revert.test.js).
 *
 * The server is tests/helpers/fake-supabase.js with the settings RPCs
 * answered the way the live functions answer them:
 *
 *   update_course        the live body (migrations/local-test/batch-a-prelude.sql,
 *                        then Batch A's two columns): a column changes only
 *                        when the patch has its key. UPDATE_COURSE_COLUMNS
 *                        says how each column reads its key; the test file
 *                        checks that table against the SQL.
 *   save_categories      migrations/20261029_category_calc_mode.sql: the
 *                        list replaces the class's categories; weights must
 *                        total 100; a category with work in it can't go.
 *   reorder_categories   the ids given take their place in the list, in the
 *                        order given (its body is not in this repository:
 *                        only that much is assumed).
 *   list_categories, list_teacher_courses, bootstrap_teacher, get_class_bundle
 *   and get_gradebook    reads of the same rows.
 *
 * The class itself (students, work, marks) is tests/eval-fixture.js.
 *
 * `server.fromAnotherDevice(name, params)` is a request from a device the
 * test does not drive: it reaches the server the same way and is not listed
 * in `server.sent`, which holds only what the device under test sent.
 */
import { makeFakeSupabase } from './fake-supabase.js';
import { syntheticClass } from '../eval-fixture.js';

export const CID = 'e0000000-0000-4000-8000-000000000001';
export const TEACHER = 'f0000000-0000-4000-8000-00000000000a';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const CAT_ASSIGNMENTS = id(500); // every piece of work in the class is in it
export const CAT_TESTS = id(501);

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* How the live update_course reads each column from p_patch.
     coalesce   coalesce(p_patch->>'x', x): changed when the key is there
                with a value; a missing key or a JSON null leaves it
     key        case when p_patch ? 'x' then … else x end: changed when the
                key is there, a JSON null included */
export const UPDATE_COURSE_COLUMNS = {
  name: 'coalesce',
  grade_level: 'coalesce',
  description: 'key',
  color: 'key',
  block: 'key',
  grading_system: 'coalesce',
  calc_method: 'coalesce',
  decay_weight: 'key',
  timezone: 'coalesce',
  late_work_policy: 'key',
  grading_scale: 'key',
  category_weights: 'key',
  round_percent: 'key',
  reporting_terms: 'key',
  recent_score_limit: 'key',
  level_order: 'coalesce',
  folders_count_as_one: 'key',
  courses_count_equally: 'key',
  curriculum_tags: 'key',
  student_page_enabled: 'key',
  return_grades: 'key',
};

/* A JSON null for these is not null in the column. */
const NULL_BECOMES = { folders_count_as_one: true, courses_count_equally: false, student_page_enabled: false };

export function applyUpdateCourse(row, patch) {
  patch = clone(patch) || {}; // as it crosses the wire: undefined keys are gone
  Object.keys(UPDATE_COURSE_COLUMNS).forEach(col => {
    if (!has(patch, col)) return;
    const value = patch[col];
    if (UPDATE_COURSE_COLUMNS[col] === 'coalesce') {
      if (value != null) row[col] = String(value);
      return;
    }
    if (value == null) row[col] = has(NULL_BECOMES, col) ? NULL_BECOMES[col] : null;
    else if (col === 'block') row[col] = String(value).trim() || null;
    else if (col === 'return_grades') row[col] = value === '' ? null : value;
    else if (col === 'decay_weight' || col === 'recent_score_limit') row[col] = Number(value);
    else row[col] = value;
  });
  row.updated_at = new Date().toISOString();
}

/* The course row as a class made in the New Class wizard has it. */
function courseRow(start) {
  return Object.assign(
    {
      id: CID,
      teacher_id: TEACHER,
      name: 'History 12',
      grade_level: '9',
      description: null,
      color: null,
      block: null,
      is_archived: false,
      display_order: 0,
      grading_system: 'proficiency',
      calc_method: 'average',
      decay_weight: 0.65,
      timezone: 'America/Vancouver',
      late_work_policy: null,
      grading_scale: null,
      category_weights: null,
      round_percent: null,
      reporting_terms: null,
      recent_score_limit: null,
      level_order: 'desc',
      folders_count_as_one: true,
      courses_count_equally: false,
      curriculum_tags: null,
      student_page_enabled: false,
      return_grades: null,
      created_at: '2026-09-01T16:00:00.000Z',
      updated_at: '2026-09-01T16:00:00.000Z',
      deleted_at: null,
    },
    clone(start) || {},
  );
}

export function classSettingsServer(start) {
  const fake = makeFakeSupabase();
  const server = {
    fake,
    version: 1,
    course: courseRow(start),
    categories: [
      { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 60, display_order: 0, calc_mode: 'points' },
      { id: CAT_TESTS, name: 'Tests', weight: 40, display_order: 1, calc_mode: 'points' },
    ],
    /** Every write the device under test sent, in order: { name, params }. */
    sent: [],
    /** False: every request fails as a dropped connection does. */
    reachable: true,
    /** (name, params) => an error the server answers a write with, or nothing. */
    rejects: null,
  };
  let seq = 0;
  const newId = () => 'cccccccc-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const dropped = () => ({ data: null, error: { message: 'network: failed to fetch' } });
  const ok = data => ({ data: data === undefined ? null : clone(data), error: null });

  const writes = {
    update_course(p) {
      if (p.p_course_id !== CID) return { data: null, error: { message: 'course not found', code: 'P0002' } };
      applyUpdateCourse(server.course, p.p_patch);
      server.version += 1;
      return ok(null);
    },
    save_categories(p) {
      const rows = clone(p.p_categories) || [];
      const total = rows.reduce((sum, r) => sum + Number(r.weight || 0), 0);
      if (rows.length && total !== 100) {
        return {
          data: null,
          error: { message: 'category weights must total 100 (they total ' + total + ')', code: '23514' },
        };
      }
      const keep = rows.map(r => r.id).filter(Boolean);
      const going = server.categories.filter(c => keep.indexOf(c.id) < 0);
      // Every piece of work in the fixture is in Assignments.
      if (rows.length && going.some(c => c.id === CAT_ASSIGNMENTS)) {
        return {
          data: null,
          error: { message: 'category in use: move its assessments to another category first', code: 'P0001' },
        };
      }
      const byId = {};
      server.categories.forEach(c => (byId[c.id] = c));
      const ids = [];
      const next = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!String(r.name || '').trim())
          return { data: null, error: { message: 'every category needs a name', code: '22023' } };
        if (r.id && !byId[r.id]) return { data: null, error: { message: 'category not found', code: 'P0002' } };
        const was = r.id ? byId[r.id] : null;
        const row = {
          id: r.id || newId(),
          name: String(r.name).trim(),
          weight: Number(r.weight || 0),
          display_order: i,
          calc_mode: r.calc_mode || (was ? was.calc_mode : 'points'),
        };
        ids.push(row.id);
        next.push(row);
      }
      server.categories = next;
      server.version += 1;
      return ok(ids);
    },
    reorder_categories(p) {
      const ids = clone(p.p_ids) || [];
      const at = c => (ids.indexOf(c.id) < 0 ? ids.length + c.display_order : ids.indexOf(c.id));
      server.categories = server.categories
        .slice()
        .sort((a, b) => at(a) - at(b))
        .map((c, i) => Object.assign({}, c, { display_order: i }));
      server.version += 1;
      return ok(null);
    },
  };

  function classFile() {
    const bundle = syntheticClass();
    bundle.version = server.version;
    bundle.gradebook.course = clone(server.course);
    bundle.gradebook.categories = clone(server.categories);
    bundle.course_config = {
      grading_scale: clone(server.course.grading_scale),
      category_weights: clone(server.course.category_weights),
    };
    return bundle;
  }

  const reads = {
    bootstrap_teacher: () => ok({ id: TEACHER, email: 'teacher@example.test', preferences: { active_course_id: CID } }),
    list_teacher_courses: () => {
      const c = server.course;
      const row = {};
      [
        'id',
        'name',
        'grade_level',
        'description',
        'color',
        'is_archived',
        'display_order',
        'grading_system',
        'calc_method',
        'decay_weight',
        'timezone',
        'late_work_policy',
        'created_at',
        'updated_at',
        'block',
        'curriculum_tags',
      ].forEach(k => (row[k] = c[k]));
      return ok([row]);
    },
    get_class_bundle: p =>
      p.p_if_version === server.version ? ok({ not_modified: true, version: server.version }) : ok(classFile()),
    // The older load, used when the server has no get_class_bundle: the
    // gradebook alone, its course the whole course row.
    get_gradebook: () => {
      const gb = classFile().gradebook;
      gb.cells = {};
      return ok(gb);
    },
    list_categories: () => ok(server.categories),
  };

  Object.keys(writes).forEach(name =>
    fake.on(name, params => {
      if (!server.reachable) return dropped();
      const refused = server.rejects && server.rejects(name, params);
      if (refused) return { data: null, error: refused };
      const res = writes[name](params);
      if (!res.error) server.sent.push({ name, params: clone(params) });
      return res;
    }),
  );
  Object.keys(reads).forEach(name =>
    fake.on(name, params => (server.reachable ? reads[name](params || {}) : dropped())),
  );

  // The session a signed-in teacher has (initAllCourses reads it).
  fake.auth = {
    getSession: () =>
      Promise.resolve({
        data: { session: { user: { id: TEACHER, email: 'teacher@example.test', user_metadata: {} } } },
      }),
    getUser: () => Promise.resolve({ data: { user: { id: TEACHER } } }),
  };

  server.fromAnotherDevice = function (name, params) {
    const res = writes[name](clone(params));
    if (res.error) throw new Error('the other device’s ' + name + ' was refused: ' + res.error.message);
    return res.data;
  };
  /** The patches of every update_course the device under test sent. */
  server.patches = () => server.sent.filter(s => s.name === 'update_course').map(s => s.params.p_patch);
  return server;
}
