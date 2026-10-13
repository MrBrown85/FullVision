/**
 * Active-course pointer must never carry a client-side placeholder id.
 *
 * createCourse() returns synchronously with a local id ("c{ts}{rand}") and
 * re-keys COURSES to the server's uuid once create_course resolves. Anything
 * that persists the active-course pointer in that window used to send the
 * placeholder to save_teacher_preferences, which casts it straight to uuid and
 * fails the whole RPC with 22P02 — so the teacher's preferences never saved and
 * the UI never switched to the class they had just created.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL = '688ec2ad-f5b9-4150-bc39-55d39633b216';

function makeRecordingClient(responses) {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      var data = responses && Object.prototype.hasOwnProperty.call(responses, name) ? responses[name] : null;
      return Promise.resolve({ data: data, error: null });
    },
  };
}

function prefPatches(client) {
  return client.calls
    .filter(function (c) {
      return c.name === 'save_teacher_preferences';
    })
    .map(function (c) {
      return c.payload.p_patch || {};
    });
}

describe('active-course placeholder guard', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    localStorage.clear();
    _cache.config = null;
    _cache.courseConfigs = {};
    for (var k in COURSES) delete COURSES[k];
    client = makeRecordingClient({ create_course: CANONICAL });
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  describe('setActiveCourse', () => {
    it('omits active_course_id while the placeholder is still unresolved', () => {
      COURSES['clocal1'] = { id: 'clocal1', name: 'New Class', __pendingLocalId: 'clocal1' };

      setActiveCourse('clocal1');

      var patches = prefPatches(client);
      expect(patches).toHaveLength(1);
      // Omitted, not null: the RPC's on-conflict branch leaves the column
      // alone when the key is absent, and create_course has already pointed
      // it at the new course server-side.
      expect(Object.prototype.hasOwnProperty.call(patches[0], 'active_course_id')).toBe(false);
    });

    it('keeps the placeholder locally so the UI can still resolve the course', () => {
      COURSES['clocal1'] = { id: 'clocal1', name: 'New Class', __pendingLocalId: 'clocal1' };

      setActiveCourse('clocal1');

      expect(getConfig().activeCourse).toBe('clocal1');
    });

    it('resolves a placeholder to the canonical uuid once the re-key has landed', () => {
      COURSES[CANONICAL] = { id: CANONICAL, name: 'New Class', __pendingLocalId: 'clocal1' };

      setActiveCourse('clocal1');

      expect(getConfig().activeCourse).toBe(CANONICAL);
      expect(prefPatches(client)[0].active_course_id).toBe(CANONICAL);
    });

    it('passes a canonical uuid through untouched', () => {
      COURSES[CANONICAL] = { id: CANONICAL, name: 'Humanities 8' };

      setActiveCourse(CANONICAL);

      expect(getConfig().activeCourse).toBe(CANONICAL);
      expect(prefPatches(client)[0].active_course_id).toBe(CANONICAL);
    });

    it('still clears the pointer when passed an empty value', () => {
      setActiveCourse(null);

      expect(prefPatches(client)[0].active_course_id).toBeNull();
    });
  });

  describe('_migrateCourseDataLocalToCanonical', () => {
    it('moves a stored placeholder pointer onto the canonical id', () => {
      COURSES[CANONICAL] = { id: CANONICAL, name: 'New Class', __pendingLocalId: 'clocal1' };
      saveConfig({ activeCourse: 'clocal1' });
      client.calls.length = 0;

      _migrateCourseDataLocalToCanonical('clocal1', CANONICAL);

      expect(getConfig().activeCourse).toBe(CANONICAL);
      expect(prefPatches(client).pop().active_course_id).toBe(CANONICAL);
    });

    it('leaves a pointer aimed at some other course alone', () => {
      COURSES[CANONICAL] = { id: CANONICAL, name: 'New Class', __pendingLocalId: 'clocal1' };
      saveConfig({ activeCourse: CANONICAL });

      _migrateCourseDataLocalToCanonical('clocal1', CANONICAL);

      expect(getConfig().activeCourse).toBe(CANONICAL);
    });

    it('replays the course-config blob written during the in-flight window', () => {
      saveCourseConfig('clocal1', { calcMethod: 'mostRecent', decayWeight: 0.65 });
      COURSES[CANONICAL] = { id: CANONICAL, name: 'New Class', __pendingLocalId: 'clocal1' };

      _migrateCourseDataLocalToCanonical('clocal1', CANONICAL);

      expect(getCourseConfig(CANONICAL).calcMethod).toBe('mostRecent');
      expect(getCourseConfig(CANONICAL).decayWeight).toBe(0.65);
    });
  });

  describe('create_course round trip', () => {
    it('never sends a non-uuid active_course_id across the whole create', async () => {
      var course = createCourse({ name: 'Humanities 8' });
      setActiveCourse(course.id);
      await waitForPendingSyncs();
      setActiveCourse(course.id);

      prefPatches(client).forEach(function (patch) {
        if (Object.prototype.hasOwnProperty.call(patch, 'active_course_id') && patch.active_course_id !== null) {
          expect(patch.active_course_id).toMatch(UUID_RE);
        }
      });
    });

    it('sends a uuid idempotency key with create_course', () => {
      createCourse({ name: 'Humanities 8' });

      var call = client.calls.find(function (c) {
        return c.name === 'create_course';
      });
      expect(call.payload.p_idempotency_key).toMatch(UUID_RE);
    });

    it('mints a fresh key per create so two deliberate classes both save', () => {
      createCourse({ name: 'Class One' });
      createCourse({ name: 'Class Two' });

      var keys = client.calls
        .filter(function (c) {
          return c.name === 'create_course';
        })
        .map(function (c) {
          return c.payload.p_idempotency_key;
        });
      expect(keys[0]).not.toBe(keys[1]);
    });
  });
});
