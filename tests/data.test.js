/**
 * data: the tests that were tests/data-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdtDate, runnerLocalDay } from './helpers/pdt-date.js';
import { signedIn, slipsFetch } from './helpers/teacher-cards-slips-fetch.js';

describe('data-active-course-placeholder', () => {
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

      // The pending-id migration cleared every _cache bucket for both ids,
      // and _cache.courses is COURSES, so the new class vanished right after
      // the re-key and the class wizard never found its uuid.
      it('keeps the re-keyed class in COURSES', async () => {
        var course = createCourse({ name: 'Humanities 8' });
        await waitForPendingSyncs();

        expect(COURSES[CANONICAL]).toBeDefined();
        expect(COURSES[CANONICAL].name).toBe('Humanities 8');
        expect(COURSES[CANONICAL].__pendingLocalId).toBe(course.id);
        expect(COURSES[course.id]).toBeUndefined();
        expect(_resolveCanonicalCourseId(course.id)).toBe(CANONICAL);
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
});

describe('data-assessments-v2-dispatch', () => {
  /**
   * v2 assessment CRUD dispatch tests — shared/data.js (Phase 4.2)
   *
   * Covers:
   *   _canonicalCreateAssessment  → create_assessment (+ tag_ids)
   *   _canonicalUpdateAssessment  → update_assessment (jsonb patch + tag_ids replace)
   *   _canonicalDeleteAssessment  → delete_assessment
   *   window.duplicateAssessment  → duplicate_assessment
   *   window.saveAssessmentTags   → save_assessment_tags
   *   window.saveCollab           → save_collab
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const AID = '22222222-2222-2222-2222-222222222222';
  const TAG1 = '33333333-3333-3333-3333-333333333333';
  const TAG2 = '44444444-4444-4444-4444-444444444444';
  const RUBRIC_ID = '55555555-5555-5555-5555-555555555555';
  const MODULE_ID = '66666666-6666-4666-8666-666666666666';
  const CAT_ID = '77777777-7777-4777-8777-777777777777';

  function makeRecordingClient(responses) {
    var calls = [];
    responses = responses || {};
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        var r = responses[name];
        return Promise.resolve(r || { data: null, error: null });
      },
    };
  }

  describe('v2 assessment CRUD dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('_canonicalCreateAssessment', () => {
      it('maps app-shape fields to snake_case RPC params', async () => {
        var a = {
          id: 'temp-id',
          title: 'Essay 1',
          description: 'First essay',
          categoryId: CAT_ID,
          dateAssigned: '2026-04-18',
          dueDate: '2026-04-25',
          scoreMode: 'rubric',
          maxPoints: 20,
          weight: 2,
          evidenceType: 'writing',
          rubricId: RUBRIC_ID,
          moduleId: MODULE_ID,
          tagIds: [TAG1, TAG2, 'not-a-uuid'],
        };
        await _canonicalCreateAssessment(client, CID, a);
        var call = client.calls.find(function (c) {
          return c.name === 'create_assessment';
        });
        expect(call).toBeDefined();
        expect(call.payload).toEqual({
          p_course_id: CID,
          p_title: 'Essay 1',
          p_category_id: CAT_ID,
          p_description: 'First essay',
          p_date_assigned: '2026-04-18',
          p_due_date: '2026-04-25',
          p_score_mode: 'rubric',
          p_max_points: 20,
          p_weight: 2,
          p_evidence_type: 'writing',
          p_rubric_id: RUBRIC_ID,
          p_module_id: MODULE_ID,
          p_tag_ids: [TAG1, TAG2],
          p_idempotency_key: expect.any(String),
        });
      });

      it('defaults score_mode to proficiency and weight to 1.0', async () => {
        await _canonicalCreateAssessment(client, CID, { id: 'x', title: 'T' });
        var call = client.calls.find(function (c) {
          return c.name === 'create_assessment';
        });
        expect(call.payload.p_score_mode).toBe('proficiency');
        expect(call.payload.p_weight).toBe(1.0);
        expect(call.payload.p_max_points).toBeNull();
      });

      it('nullifies non-UUID categoryId / rubricId / moduleId', async () => {
        var a = { id: 'x', title: 'T', categoryId: 'legacy-cat', rubricId: 'legacy-rubric', moduleId: 'legacy-mod' };
        await _canonicalCreateAssessment(client, CID, a);
        var call = client.calls.find(function (c) {
          return c.name === 'create_assessment';
        });
        expect(call.payload.p_category_id).toBeNull();
        expect(call.payload.p_rubric_id).toBeNull();
        expect(call.payload.p_module_id).toBeNull();
      });

      it('patches the cached assessment id with the returned UUID on success', async () => {
        var a = { id: 'temp-id', title: 'T' };
        _cache.assessments[CID] = [a];
        client = makeRecordingClient({
          create_assessment: { data: AID, error: null },
        });
        globalThis.getSupabase = () => client;
        await _canonicalCreateAssessment(client, CID, a);
        expect(a.id).toBe(AID);
      });
    });

    describe('_canonicalUpdateAssessment', () => {
      it('calls update_assessment with jsonb patch + filtered tag_ids', async () => {
        var a = {
          title: 'Updated',
          description: 'New desc',
          categoryId: CAT_ID,
          dateAssigned: '2026-04-18',
          dueDate: '2026-04-25',
          scoreMode: 'points',
          maxPoints: 50,
          weight: 1.5,
          evidenceType: 'quiz',
          rubricId: null,
          moduleId: MODULE_ID,
          tagIds: [TAG1],
        };
        await _canonicalUpdateAssessment(client, CID, AID, a);
        var call = client.calls.find(function (c) {
          return c.name === 'update_assessment';
        });
        expect(call.payload.p_id).toBe(AID);
        expect(call.payload.p_tag_ids).toEqual([TAG1]);
        expect(call.payload.p_patch).toMatchObject({
          title: 'Updated',
          description: 'New desc',
          category_id: CAT_ID,
          date_assigned: '2026-04-18',
          due_date: '2026-04-25',
          score_mode: 'points',
          evidence_type: 'quiz',
          module_id: MODULE_ID,
          rubric_id: null,
        });
        // max_points + weight serialize as strings per the write-paths contract
        expect(call.payload.p_patch.max_points).toBe('50');
        expect(call.payload.p_patch.weight).toBe('1.5');
      });

      it('defaults missing weight to "1"', async () => {
        await _canonicalUpdateAssessment(client, CID, AID, { title: 'T' });
        var call = client.calls.find(function (c) {
          return c.name === 'update_assessment';
        });
        expect(call.payload.p_patch.weight).toBe('1');
      });
    });

    describe('group count', () => {
      it('sends Number of Groups in collab_config, even with no groups made', async () => {
        await _canonicalUpdateAssessment(
          client,
          CID,
          AID,
          { title: 'T', collaboration: 'group', groupCount: 6 },
          { title: 'T', collaboration: 'group', groupCount: 4 },
        );
        var call = client.calls.find(function (c) {
          return c.name === 'save_collab';
        });
        expect(call.payload).toEqual({ p_id: AID, p_mode: 'groups', p_config: { groupCount: 6 } });
      });

      it('leaves it out for pairs', async () => {
        await _canonicalUpdateAssessment(client, CID, AID, {
          title: 'T',
          collaboration: 'pair',
          pairs: [['a', 'b']],
          groupCount: 6,
        });
        var call = client.calls.find(function (c) {
          return c.name === 'save_collab';
        });
        expect(call.payload.p_config).toEqual({ pairs: [['a', 'b']] });
      });

      it('reads it back from the server row', () => {
        var a = _assessmentFromDetail(
          {},
          { assessment: { id: AID, collab_mode: 'groups', collab_config: { groups: [['a'], []], groupCount: 2 } } },
        );
        expect(a.collaboration).toBe('group');
        expect(a.groupCount).toBe(2);
        expect(a.groups).toEqual([['a'], []]);
      });
    });

    describe('_canonicalDeleteAssessment', () => {
      it('calls delete_assessment with the assessment id', async () => {
        await _canonicalDeleteAssessment(client, CID, AID);
        var call = client.calls.find(function (c) {
          return c.name === 'delete_assessment';
        });
        expect(call.payload).toEqual({ p_id: AID });
      });
    });

    describe('window.duplicateAssessment', () => {
      it('calls duplicate_assessment with p_src_id', async () => {
        await window.duplicateAssessment(AID);
        var call = client.calls.find(function (c) {
          return c.name === 'duplicate_assessment';
        });
        expect(call.payload).toEqual({ p_src_id: AID, p_idempotency_key: expect.any(String) });
      });

      it('skips dispatch on non-UUID id', async () => {
        await window.duplicateAssessment('legacy-id');
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.saveAssessmentTags', () => {
      it('calls save_assessment_tags with filtered UUID list', async () => {
        await window.saveAssessmentTags(AID, [TAG1, 'junk', TAG2]);
        var call = client.calls.find(function (c) {
          return c.name === 'save_assessment_tags';
        });
        expect(call.payload).toEqual({ p_id: AID, p_tag_ids: [TAG1, TAG2] });
      });

      it('skips dispatch on non-UUID assessment id', async () => {
        await window.saveAssessmentTags('junk', [TAG1]);
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.saveCollab', () => {
      it('calls save_collab with mode + config jsonb', async () => {
        var cfg = { pairs: [['a', 'b']] };
        await window.saveCollab(AID, 'pairs', cfg);
        var call = client.calls.find(function (c) {
          return c.name === 'save_collab';
        });
        expect(call.payload).toEqual({ p_id: AID, p_mode: 'pairs', p_config: cfg });
      });

      it('nulls the config when mode is "none"', async () => {
        await window.saveCollab(AID, 'none', { stale: true });
        var call = client.calls.find(function (c) {
          return c.name === 'save_collab';
        });
        expect(call.payload.p_config).toBeNull();
      });

      it('defaults mode to "none" when missing', async () => {
        await window.saveCollab(AID);
        var call = client.calls.find(function (c) {
          return c.name === 'save_collab';
        });
        expect(call.payload.p_mode).toBe('none');
      });
    });
  });
});

describe('data-cache-first', () => {
  /**
   * Saved copy first (docs/class-loading-plan.md, Phase 4).
   *
   * A class this device has saved opens from that copy without waiting for
   * the server; a request carrying the copy's version then asks whether it
   * changed. The copy is only trusted for the teacher who saved it, within
   * 14 days, and only becomes the server baseline when it holds no local
   * edits.
   */

  const CID = 'd0000000-0000-4000-8000-000000000001';
  const OTHER = 'd0000000-0000-4000-8000-000000000002';
  const E1 = 'd0000000-0000-4000-8000-000000000021';
  const S1 = 'd0000000-0000-4000-8000-000000000011';

  function bundle(version, firstName) {
    return {
      bundle_schema: 2,
      version: version,
      gradebook: {
        course: { id: CID },
        students: [
          { enrollment_id: E1, student_id: S1, first_name: firstName, last_name: 'Lovelace', roster_position: 1 },
        ],
        assessments: [],
        categories: [],
        modules: [],
        tag_index: [],
        criterion_index: [],
        score_rows: [],
        tag_rows: [],
        criterion_rows: [],
      },
      learning_map: { competency_groups: [], subjects: [] },
      rubrics: { rubrics: [], criteria: [], criterion_tags: [] },
      observations: { observations: [], total: 0 },
      profiles: [],
      term_ratings: [],
      report_config: null,
      custom_tags: [],
    };
  }

  function deferred() {
    var resolve;
    var promise = new Promise(function (r) {
      resolve = r;
    });
    return { promise: promise, resolve: resolve };
  }

  function serve(handler) {
    var calls = [];
    globalThis.getSupabase = function () {
      return {
        rpc(name, payload) {
          if (name !== 'get_class_bundle') return Promise.resolve({ data: null, error: null });
          calls.push({ name: name, payload: payload || {} });
          return Promise.resolve(handler(payload || {}));
        },
      };
    };
    return calls;
  }

  function forgetMemory() {
    Object.keys(_DATA_KEYS).forEach(function (field) {
      delete _cache[field][CID];
    });
    delete _classVersion[CID];
    delete _classFresh[CID];
    _serverState = {};
  }

  describe('saved copy first', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var originalTeacher;
    var originalQuiet;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      originalTeacher = _teacherId;
      originalQuiet = _REFRESH_QUIET_MS;
      _REFRESH_QUIET_MS = 0;
      _useSupabase = true;
      _teacherId = 'teacher-a';
      globalThis.__FV_CLASS_BUNDLE = true;
      localStorage.clear();
      forgetMemory();
      _dirtyMarked = {};
      serve(function () {
        return { data: null, error: null };
      });
      saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
      saveConfig({ activeCourse: CID });
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      _teacherId = originalTeacher;
      _REFRESH_QUIET_MS = originalQuiet;
      globalThis.__FV_CLASS_BUNDLE = false;
    });

    async function saveCopy(version, firstName) {
      serve(function () {
        return { data: bundle(version, firstName), error: null };
      });
      await initData(CID);
      forgetMemory();
    }

    it('shows the saved copy before the server answers, then confirms it', async () => {
      await saveCopy(5, 'Ada');
      var gate = deferred();
      var calls = serve(function () {
        return gate.promise.then(function () {
          return { data: { not_modified: true, version: 5 }, error: null };
        });
      });

      await initData(CID);
      expect(getStudents(CID).map(s => s.firstName)).toEqual(['Ada']);
      expect(_classFresh[CID]).toBe(false);

      gate.resolve();
      await _refreshState[CID].running;
      expect(calls[0].payload.p_if_version).toBe(5);
      expect(_classFresh[CID]).toBe(true);
    });

    it('replaces the saved copy when the class changed elsewhere', async () => {
      await saveCopy(5, 'Ada');
      serve(function () {
        return { data: bundle(6, 'Augusta'), error: null };
      });

      await initData(CID);
      await _refreshState[CID].running;

      expect(getStudents(CID).map(s => s.firstName)).toEqual(['Augusta']);
      expect(_classVersion[CID]).toBe(6);
      expect(_classMeta(CID).version).toBe(6);
    });

    it("doesn't use another teacher's saved copy", async () => {
      await saveCopy(5, 'Ada');
      _teacherId = 'teacher-b';
      var calls = serve(function () {
        return { data: bundle(5, 'Ada'), error: null };
      });

      await initData(CID);

      expect(calls[0].payload.p_if_version).toBeNull();
      expect(_refreshState[CID] && _refreshState[CID].running).toBeFalsy();
    });

    it("doesn't use a copy unopened for more than 14 days", async () => {
      await saveCopy(5, 'Ada');
      _saveClassMeta(CID, { lastOpenedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 });
      var calls = serve(function () {
        return { data: bundle(5, 'Ada'), error: null };
      });

      await initData(CID);

      expect(calls[0].payload.p_if_version).toBeNull();
    });

    it('downloads again rather than trusting a copy with local edits', async () => {
      await saveCopy(5, 'Ada');
      _saveClassMeta(CID, { dirty: true });
      var calls = serve(function () {
        return { data: bundle(5, 'Ada'), error: null };
      });

      await initData(CID);
      expect(_serverState.students && _serverState.students[CID]).toBeUndefined();
      await _refreshState[CID].running;

      expect(calls[0].payload.p_if_version).toBeNull();
      expect(_classMeta(CID).dirty).toBe(false);
    });

    it('flags the saved copy on the first local edit', async () => {
      await saveCopy(5, 'Ada');
      _markLocalWrite('scores', CID);
      expect(_classMeta(CID).dirty).toBe(true);
    });

    it('removes saved copies unopened for 14 days', () => {
      _saveClassMeta(OTHER, { lastOpenedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 });
      localStorage.setItem('gb-students-' + OTHER, '[]');
      _saveClassMeta(CID, { lastOpenedAt: Date.now() });
      localStorage.setItem('gb-students-' + CID, '[]');

      _purgeStaleSavedCopies();

      expect(localStorage.getItem('gb-students-' + OTHER)).toBeNull();
      expect(localStorage.getItem('gb-bundle-meta-' + OTHER)).toBeNull();
      expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
    });

    it('frees space from the copy opened longest ago, never the open class', () => {
      _saveClassMeta(CID, { lastOpenedAt: 1 });
      localStorage.setItem('gb-students-' + CID, '[]');
      _saveClassMeta(OTHER, { lastOpenedAt: 2 });
      localStorage.setItem('gb-students-' + OTHER, '[]');

      expect(_evictOldestSavedCopy(null)).toBe(true);

      expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
      expect(localStorage.getItem('gb-students-' + OTHER)).toBeNull();
    });
  });
});

describe('data-competency-groups', () => {
  /**
   * Competency group data layer tests — shared/data.js
   * Tests getCompetencyGroups, saveCompetencyGroups, getCompetencyGroupById,
   * and course isolation.
   */

  const CID = 'test';

  const MOCK_MAP = {
    _flatVersion: 2,
    _customized: true,
    subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
    sections: [
      {
        id: 't1',
        name: 'Questioning',
        color: '#0891b2',
        subject: 'SCI8',
        shortName: 'Questioning',
        tags: [
          {
            id: 't1',
            label: 'Question and Predict',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Questioning',
            shortName: 'Questioning',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    _cache.learningMaps[CID] = structuredClone(MOCK_MAP);
    _cache.learningMaps['other'] = undefined;
    _cache.courseConfigs[CID] = undefined;
    localStorage.clear();
  });

  describe('getCompetencyGroups', () => {
    it('returns empty array when none saved', () => {
      expect(getCompetencyGroups(CID)).toEqual([]);
    });
  });

  describe('saveCompetencyGroups / getCompetencyGroups roundtrip', () => {
    it('persists and retrieves competency groups', () => {
      const groups = [
        { id: 'g1', name: 'Science Skills', sortOrder: 0 },
        { id: 'g2', name: 'Math Skills', sortOrder: 1 },
      ];
      saveCompetencyGroups(CID, groups);
      const result = getCompetencyGroups(CID);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Science Skills');
      expect(result[1].name).toBe('Math Skills');
    });
  });

  describe('getCompetencyGroupById', () => {
    it('returns the correct group', () => {
      saveCompetencyGroups(CID, [
        { id: 'g1', name: 'Group A' },
        { id: 'g2', name: 'Group B' },
      ]);
      const group = getCompetencyGroupById(CID, 'g2');
      expect(group).toBeDefined();
      expect(group.name).toBe('Group B');
    });

    it('returns undefined for nonexistent ID', () => {
      saveCompetencyGroups(CID, [{ id: 'g1', name: 'Group A' }]);
      expect(getCompetencyGroupById(CID, 'nonexistent')).toBeUndefined();
    });
  });

  describe('multiple groups coexist', () => {
    it('all groups are retrievable', () => {
      const groups = [
        { id: 'g1', name: 'First', sortOrder: 0 },
        { id: 'g2', name: 'Second', sortOrder: 1 },
        { id: 'g3', name: 'Third', sortOrder: 2 },
      ];
      saveCompetencyGroups(CID, groups);
      expect(getCompetencyGroups(CID)).toHaveLength(3);
      expect(getCompetencyGroupById(CID, 'g1').name).toBe('First');
      expect(getCompetencyGroupById(CID, 'g3').name).toBe('Third');
    });
  });

  describe('group with sections array', () => {
    it('saves group containing section references correctly', () => {
      const groups = [{ id: 'g1', name: 'Inquiry', sortOrder: 0, color: '#10b981', sectionIds: ['t1', 't2'] }];
      saveCompetencyGroups(CID, groups);
      const loaded = getCompetencyGroupById(CID, 'g1');
      expect(loaded.sectionIds).toEqual(['t1', 't2']);
      expect(loaded.color).toBe('#10b981');
    });
  });

  describe('saveCompetencyGroups overwrites previous', () => {
    it('replaces all groups with new set', () => {
      saveCompetencyGroups(CID, [{ id: 'g1', name: 'Old Group' }]);
      saveCompetencyGroups(CID, [{ id: 'g2', name: 'New Group' }]);
      const groups = getCompetencyGroups(CID);
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe('g2');
      expect(groups[0].name).toBe('New Group');
    });
  });

  describe('competency groups course isolation', () => {
    it('groups from different course are isolated', () => {
      // Set up other course's learning map
      _cache.learningMaps['other'] = {
        _flatVersion: 2,
        _customized: true,
        subjects: [{ id: 'MATH', name: 'Math', color: '#6366f1' }],
        sections: [],
      };

      saveCompetencyGroups(CID, [{ id: 'g1', name: 'Science Groups' }]);
      saveCompetencyGroups('other', [{ id: 'g2', name: 'Math Groups' }]);

      expect(getCompetencyGroups(CID)).toHaveLength(1);
      expect(getCompetencyGroups(CID)[0].name).toBe('Science Groups');
      expect(getCompetencyGroups('other')).toHaveLength(1);
      expect(getCompetencyGroups('other')[0].name).toBe('Math Groups');
    });
  });
});

describe('data-course-config-sync', () => {
  /**
   * A class's grading scale and category weights follow the teacher to every
   * device (migrations/20261015_course_grading_config.sql).
   *
   * They used to live only in this browser's course config: update_course never
   * carried them and no read returned them. Now saveCourseConfig sends them,
   * get_class_bundle returns them in course_config, and loading a class puts
   * the server's values in place of this device's.
   */

  const CID = 'e0000000-0000-4000-8000-000000000001';
  const SCALE = {
    boundaries: [
      { min: 90, proficiency: 4 },
      { min: 75, proficiency: 3 },
      { min: 55, proficiency: 2 },
      { min: 0, proficiency: 1 },
    ],
    labels: ['Beginning', 'Approaching', 'Meeting', 'Exceeding'],
  };
  const WEIGHTS = { summative: 0.6, formative: 0.4 };

  /* One class on a fake server: update_course merges its patch into the
   course row and bumps the version, as the course trigger does. */
  function fakeServer() {
    var server = { version: 1, course: { grading_scale: null, category_weights: null }, patches: [] };
    server.client = function () {
      return {
        rpc(name, payload) {
          payload = payload || {};
          if (name === 'update_course') {
            server.patches.push(payload.p_patch);
            Object.keys(payload.p_patch).forEach(function (k) {
              server.course[k] = payload.p_patch[k] == null ? null : JSON.parse(JSON.stringify(payload.p_patch[k]));
            });
            server.version += 1;
            return Promise.resolve({ data: null, error: null });
          }
          if (name !== 'get_class_bundle') return Promise.resolve({ data: null, error: null });
          if (payload.p_if_version === server.version) {
            return Promise.resolve({ data: { not_modified: true, version: server.version }, error: null });
          }
          return Promise.resolve({ data: bundle(server), error: null });
        },
      };
    };
    return server;
  }

  function bundle(server) {
    return {
      bundle_schema: 3,
      version: server.version,
      gradebook: {
        course: { id: CID },
        students: [],
        assessments: [],
        categories: [],
        modules: [],
        tag_index: [],
        criterion_index: [],
        score_rows: [],
        tag_rows: [],
        criterion_rows: [],
      },
      learning_map: { competency_groups: [], subjects: [] },
      rubrics: { rubrics: [], criteria: [], criterion_tags: [] },
      observations: { observations: [], total: 0 },
      profiles: [],
      term_ratings: [],
      report_config: null,
      custom_tags: [],
      course_config: {
        grading_scale: server.course.grading_scale,
        category_weights: server.course.category_weights,
      },
    };
  }

  /* A different device: nothing in memory or localStorage from this one. */
  function switchDevice() {
    localStorage.clear();
    Object.keys(_DATA_KEYS).forEach(function (field) {
      delete _cache[field][CID];
    });
    delete _classVersion[CID];
    delete _classFresh[CID];
    _serverState = {};
    _localWrites = {};
    _refreshState = {};
    _dirtyMarked = {};
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
    if (typeof clearProfCache === 'function') clearProfCache();
  }

  /* What this device saved before the server stored these settings. */
  function saveOnThisDeviceOnly(config) {
    var was = _useSupabase;
    _useSupabase = false;
    saveCourseConfig(CID, config);
    _useSupabase = was;
  }

  async function settle() {
    for (var i = 0; i < 5; i++) await Promise.resolve();
  }

  describe('course grading config sync', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var originalTeacher;
    var server;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      originalTeacher = _teacherId;
      _useSupabase = true;
      _teacherId = 'teacher-a';
      globalThis.__FV_CLASS_BUNDLE = true;
      server = fakeServer();
      globalThis.getSupabase = server.client;
      switchDevice();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      _teacherId = originalTeacher;
      globalThis.__FV_CLASS_BUNDLE = false;
    });

    it('sends the grading scale and category weights with update_course', async () => {
      await initData(CID);
      var cc = getCourseConfig(CID);
      cc.gradingScale = SCALE;
      cc.categoryWeights = WEIGHTS;
      saveCourseConfig(CID, cc);
      await settle();

      var last = server.patches[server.patches.length - 1];
      expect(last.grading_scale).toEqual(SCALE);
      expect(last.category_weights).toEqual(WEIGHTS);
    });

    it('shows a scale and weights set on one device on another', async () => {
      await initData(CID);
      var cc = getCourseConfig(CID);
      cc.gradingScale = SCALE;
      cc.categoryWeights = WEIGHTS;
      saveCourseConfig(CID, cc);
      await settle();

      switchDevice();
      await initData(CID);

      expect(getGradingScale(CID)).toEqual(SCALE);
      expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
    });

    it("replaces this device's values with the server's", async () => {
      saveOnThisDeviceOnly({ gradingScale: DEFAULT_GRADING_SCALE, categoryWeights: { summative: 1, formative: 0 } });
      server.course.grading_scale = SCALE;
      server.course.category_weights = WEIGHTS;

      await initData(CID);

      expect(getGradingScale(CID)).toEqual(SCALE);
      expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
      expect(server.patches).toEqual([]);
    });

    it('sends up values only this device has, and keeps them', async () => {
      saveOnThisDeviceOnly({ gradingScale: SCALE, categoryWeights: WEIGHTS, calcMethod: 'mostRecent' });

      await initData(CID);
      await settle();

      expect(getGradingScale(CID)).toEqual(SCALE);
      expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
      expect(server.patches).toEqual([{ grading_scale: SCALE, category_weights: WEIGHTS }]);
    });

    it('saves a reset as the default scale, so other devices take the reset', async () => {
      server.course.grading_scale = SCALE;
      await initData(CID);
      var cc = getCourseConfig(CID);
      cc.gradingScale = structuredClone(DEFAULT_GRADING_SCALE);
      saveCourseConfig(CID, cc);
      await settle();
      expect(server.course.grading_scale).toEqual(DEFAULT_GRADING_SCALE);

      switchDevice();
      saveOnThisDeviceOnly({ gradingScale: SCALE });
      server.patches = [];
      await initData(CID);
      await settle();

      expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
      expect(server.patches).toEqual([]);
    });
  });
});

describe('data-course-isolation', () => {
  /**
   * Multi-course data isolation tests — shared/data.js
   * Verifies that students, assessments, scores, and learning maps
   * for one course do not leak into another.
   */

  const A = 'courseA';
  const B = 'courseB';

  beforeEach(() => {
    _cache.students[A] = undefined;
    _cache.students[B] = undefined;
    _cache.assessments[A] = undefined;
    _cache.assessments[B] = undefined;
    _cache.scores[A] = undefined;
    _cache.scores[B] = undefined;
    _cache.learningMaps[A] = undefined;
    _cache.learningMaps[B] = undefined;
    _cache.config = {};
    localStorage.clear();
    // Use saveCourses to update the internal COURSES variable (let-scoped in shared/data.js)
    saveCourses({
      courseA: { id: 'courseA', name: 'Course A', calcMethod: 'mostRecent', decayWeight: 0.65 },
      courseB: { id: 'courseB', name: 'Course B', calcMethod: 'highest', decayWeight: 0.65 },
    });
  });

  describe('student isolation', () => {
    it('students saved to course A are not returned by getStudents(courseB)', () => {
      saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      saveStudents(B, []);
      expect(getStudents(A)).toHaveLength(1);
      expect(getStudents(B)).toHaveLength(0);
    });
  });

  describe('assessment isolation', () => {
    it('assessments saved to course A are not in getAssessments(courseB)', () => {
      saveAssessments(A, [{ id: 'a1', title: 'Quiz A', tagIds: ['t1'] }]);
      saveAssessments(B, []);
      expect(getAssessments(A)).toHaveLength(1);
      expect(getAssessments(B)).toHaveLength(0);
    });
  });

  describe('score isolation', () => {
    it('scores saved to course A are not in getScores(courseB)', () => {
      saveScores(A, {
        stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
      });
      saveScores(B, {});
      expect(Object.keys(getScores(A))).toHaveLength(1);
      expect(Object.keys(getScores(B))).toHaveLength(0);
    });
  });

  describe('setActiveCourse / getActiveCourse', () => {
    it('setActiveCourse changes the active course', () => {
      setActiveCourse('courseB');
      expect(getActiveCourse()).toBe('courseB');
    });

    it('getActiveCourse returns config activeCourse when valid', () => {
      _cache.config = { activeCourse: 'courseA' };
      expect(getActiveCourse()).toBe('courseA');
    });
  });

  describe('independent course data', () => {
    it('creating data in A then B — both exist independently', () => {
      saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      saveStudents(B, [{ id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' }]);
      saveScores(A, {
        s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
      });
      saveScores(B, {
        s2: [{ id: 'e2', assessmentId: 'a2', tagId: 't2', score: 4, date: '2025-02-01', type: 'formative' }],
      });

      expect(getStudents(A)[0].firstName).toBe('Alice');
      expect(getStudents(B)[0].firstName).toBe('Bob');
      expect(getScores(A)['s1'][0].score).toBe(3);
      expect(getScores(B)['s2'][0].score).toBe(4);
    });

    it('clearing course A data does not affect course B', () => {
      saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      saveStudents(B, [{ id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' }]);

      saveStudents(A, []);
      expect(getStudents(A)).toHaveLength(0);
      expect(getStudents(B)).toHaveLength(1);
      expect(getStudents(B)[0].firstName).toBe('Bob');
    });
  });

  describe('learning map isolation', () => {
    it('learning map for course A is separate from course B', () => {
      const mapA = { subjects: [{ id: 'S1', name: 'Subject A' }], sections: [], _customized: true, _flatVersion: 2 };
      const mapB = { subjects: [{ id: 'S2', name: 'Subject B' }], sections: [], _customized: true, _flatVersion: 2 };
      saveLearningMap(A, mapA);
      saveLearningMap(B, mapB);

      expect(getLearningMap(A).subjects[0].name).toBe('Subject A');
      expect(getLearningMap(B).subjects[0].name).toBe('Subject B');
    });
  });
});

describe('data-course-soft-delete', () => {
  const CID_A = '11111111-1111-1111-1111-111111111111';
  const CID_B = '22222222-2222-2222-2222-222222222222';

  function resetDataState() {
    localStorage.clear();
    COURSES = {};
    _cache.courses = null;
    _cache.config = null;
    _cache.students = {};
    _cache.categories = {};
    _cache.assessments = {};
    _cache.scores = {};
    _cache.learningMaps = {};
    _cache.courseConfigs = {};
    _cache.modules = {};
    _cache.rubrics = {};
    _cache.flags = {};
    _cache.goals = {};
    _cache.reflections = {};
    _cache.overrides = {};
    _cache.statuses = {};
    _cache.observations = {};
    _cache.termRatings = {};
    _cache.customTags = {};
    _cache.notes = {};
    _cache.reportConfig = {};
    _cache.studentProfileSummaries = {};
    _cache.v2Gradebook = {};
    _useSupabase = false;
  }

  function seedCourses() {
    saveCourses({
      [CID_A]: { id: CID_A, name: 'Science 8', archived: false },
      [CID_B]: { id: CID_B, name: 'ELA 8', archived: false },
    });
  }

  function makeClient(deleteError) {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        if (name === 'delete_course' && deleteError) {
          return Promise.resolve({ data: null, error: deleteError });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('course soft-delete client flow', () => {
    var originalGetSupabase;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      resetDataState();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      resetDataState();
    });

    it('soft-deletes remotely, clears local course state, and advances the active course', async () => {
      var client = makeClient();
      _useSupabase = true;
      globalThis.getSupabase = function () {
        return client;
      };

      seedCourses();
      _cache.config = { activeCourse: CID_A, viewMode: 'dashboard' };
      localStorage.setItem('gb-config', JSON.stringify(_cache.config));
      localStorage.setItem('gb-students-' + CID_A, JSON.stringify([{ id: 's1' }]));
      _cache.students[CID_A] = [{ id: 's1' }];

      await deleteCourseData(CID_A);

      expect(
        client.calls.map(function (c) {
          return c.name;
        }),
      ).toEqual(['delete_course', 'save_teacher_preferences']);
      expect(client.calls[0]).toEqual({
        name: 'delete_course',
        payload: { p_course_id: CID_A },
      });
      expect(COURSES[CID_A]).toBeUndefined();
      expect(COURSES[CID_B]).toBeDefined();
      expect(localStorage.getItem('gb-students-' + CID_A)).toBeNull();
      expect(_cache.students[CID_A]).toBeUndefined();
      expect(getConfig().activeCourse).toBe(CID_B);
    });

    it('keeps local state intact when the delete RPC fails', async () => {
      var client = makeClient({ message: 'boom' });
      _useSupabase = true;
      globalThis.getSupabase = function () {
        return client;
      };

      seedCourses();
      _cache.config = { activeCourse: CID_A };
      localStorage.setItem('gb-config', JSON.stringify(_cache.config));
      localStorage.setItem('gb-students-' + CID_A, JSON.stringify([{ id: 's1' }]));
      _cache.students[CID_A] = [{ id: 's1' }];

      await expect(deleteCourseData(CID_A)).rejects.toMatchObject({ message: 'boom' });

      expect(COURSES[CID_A]).toBeDefined();
      expect(localStorage.getItem('gb-students-' + CID_A)).not.toBeNull();
      expect(_cache.students[CID_A]).toEqual([{ id: 's1' }]);
      expect(getConfig().activeCourse).toBe(CID_A);
      expect(client.calls).toHaveLength(1);
    });

    it('clears the active course when the last class is removed locally', async () => {
      saveCourses({
        [CID_A]: { id: CID_A, name: 'Science 8', archived: false },
      });
      _cache.config = { activeCourse: CID_A };
      localStorage.setItem('gb-config', JSON.stringify(_cache.config));

      await deleteCourseData(CID_A);

      expect(Object.keys(COURSES)).toHaveLength(0);
      expect(getConfig().activeCourse).toBeNull();
    });
  });
});

describe('data-create-course-timezone', () => {
  /**
   * createCourse timezone default — T-UI-03 (simplified scope)
   *
   * Every new course defaults to Pacific time. No UI picker (per product
   * decision 2026-04-22). The local course object gets timezone set, and
   * the create_course RPC is called with p_timezone.
   */

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('createCourse timezone default', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      localStorage.clear();
      for (var k in COURSES) delete COURSES[k];
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('sets timezone to America/Vancouver on the returned course object', () => {
      var course = createCourse({ name: 'Test Class' });
      expect(course.timezone).toBe('America/Vancouver');
    });

    it('passes p_timezone=America/Vancouver to create_course RPC', () => {
      createCourse({ name: 'Test Class' });
      var call = client.calls.find(function (c) {
        return c.name === 'create_course';
      });
      expect(call).toBeDefined();
      expect(call.payload.p_timezone).toBe('America/Vancouver');
    });
  });

  /**
   * courseToday — score-date correctness across timezone boundaries (P5.9).
   *
   * Scores record the date a teacher entered them. If the gradebook used
   * `new Date().toISOString().slice(0, 10)` (UTC midnight), a Vancouver
   * teacher grading at 11 pm local on Apr 22 would see the score dated
   * Apr 23 on the next day's reports — confusing and wrong.
   */
  describe('courseToday — timezone-correct today', () => {
    var OriginalDate;

    beforeEach(() => {
      for (var k in COURSES) delete COURSES[k];
      OriginalDate = globalThis.Date;
    });

    afterEach(() => {
      globalThis.Date = OriginalDate;
    });

    // Pin "now" by subclassing Date. Constructing `new Date()` with no args
    // returns the pinned instant; all other Date behaviours (parsing,
    // toISOString, Intl.DateTimeFormat consumption) pass through to the real
    // implementation.
    function pinNow(isoInstant) {
      var pinned = new OriginalDate(isoInstant).getTime();
      globalThis.Date = function (...args) {
        if (args.length === 0) return new OriginalDate(pinned);
        return new OriginalDate(...args);
      };
      globalThis.Date.prototype = OriginalDate.prototype;
      globalThis.Date.now = () => pinned;
      globalThis.Date.parse = OriginalDate.parse;
      globalThis.Date.UTC = OriginalDate.UTC;
    }

    it('returns the PST local date when the UTC instant is the next day', () => {
      // 11 pm Apr 22 Pacific = 06:00 UTC Apr 23. Naive UTC slice would give
      // "2026-04-23". We want "2026-04-22" because that's what the teacher
      // saw on their clock.
      COURSES['c1'] = { id: 'c1', name: 'Test', timezone: 'America/Vancouver' };
      pinNow('2026-04-23T06:00:00Z');
      expect(courseToday('c1')).toBe('2026-04-22');
    });

    it('returns the EST local date when the UTC instant is the next day', () => {
      COURSES['c2'] = { id: 'c2', name: 'Test', timezone: 'America/Toronto' };
      pinNow('2026-04-23T03:00:00Z'); // 11 pm EDT Apr 22
      expect(courseToday('c2')).toBe('2026-04-22');
    });

    it('matches UTC when the timezone is UTC', () => {
      COURSES['c3'] = { id: 'c3', name: 'Test', timezone: 'UTC' };
      pinNow('2026-04-23T06:00:00Z');
      expect(courseToday('c3')).toBe('2026-04-23');
    });

    it('falls back to America/Vancouver default when the course timezone is missing', () => {
      COURSES['c4'] = { id: 'c4', name: 'Test' }; // no timezone set
      pinNow('2026-04-23T06:00:00Z');
      expect(courseToday('c4')).toBe('2026-04-22');
    });

    it('falls back to America/Vancouver default when the course is unknown', () => {
      pinNow('2026-04-23T06:00:00Z');
      expect(courseToday('nonexistent-cid')).toBe('2026-04-22');
    });

    it('returns YYYY-MM-DD zero-padded', () => {
      COURSES['c5'] = { id: 'c5', name: 'Test', timezone: 'America/Vancouver' };
      pinNow('2026-01-05T20:00:00Z'); // noon PST
      expect(courseToday('c5')).toBe('2026-01-05');
    });
  });
});

describe('data-dead-bridge-removed', () => {
  /**
   * Regression guard — the legacy Supabase bridge helpers (_doSync,
   * _syncToSupabase, _initRealtimeSync, _handleCrossTabChange,
   * _refreshFromSupabase, _deleteFromSupabase) were removed in Phase 6.1 of
   * the reconciliation plan (2026-04-20). They all short-circuited against
   * dropped legacy public-schema tables; writes now route through the v2
   * RPC dispatch + window.v2Queue instead.
   *
   * This test fails the moment any of those helpers gets re-introduced —
   * preventing a regression to the pre-v2 bridge pattern.
   */

  describe('legacy Supabase bridge helpers are gone (Phase 6.1)', () => {
    it('_doSync is undefined', () => {
      expect(typeof globalThis._doSync).toBe('undefined');
    });

    it('_syncToSupabase is undefined', () => {
      expect(typeof globalThis._syncToSupabase).toBe('undefined');
    });

    it('_initRealtimeSync is undefined', () => {
      expect(typeof globalThis._initRealtimeSync).toBe('undefined');
    });

    it('_handleCrossTabChange is undefined', () => {
      expect(typeof globalThis._handleCrossTabChange).toBe('undefined');
    });

    it('_refreshFromSupabase is undefined', () => {
      expect(typeof globalThis._refreshFromSupabase).toBe('undefined');
    });

    it('_deleteFromSupabase is undefined', () => {
      expect(typeof globalThis._deleteFromSupabase).toBe('undefined');
    });

    it('window.refreshFromSupabase is not re-exported', () => {
      expect(typeof window.refreshFromSupabase).toBe('undefined');
    });
  });
});

describe('data-deletion', () => {
  /**
   * Deletion and cascade tests — shared/data.js
   * Tests withdrawStudent taking a student out of the class, deleteRubric on
   * nonexistent,
   * and clearing data via save with empty values.
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.students[CID] = undefined;
    _cache.assessments[CID] = undefined;
    _cache.scores[CID] = undefined;
    _cache.rubrics[CID] = undefined;
    _cache.goals[CID] = undefined;
    _cache.reflections[CID] = undefined;
    _cache.notes[CID] = undefined;
    _cache.flags[CID] = undefined;
    _cache.statuses[CID] = undefined;
    _cache.observations[CID] = undefined;
    _cache.termRatings[CID] = undefined;
    _cache.overrides[CID] = undefined;
    _cache.courseConfigs[CID] = undefined;
    _cache.withdrawn[CID] = undefined;
    localStorage.clear();
    globalThis.COURSES = {
      test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', decayWeight: 0.65 },
    };
  });

  describe('withdrawStudent', () => {
    it('removes student from getStudents', () => {
      saveStudents(CID, [
        { id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' },
        { id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' },
      ]);
      saveScores(CID, {});
      saveGoals(CID, {});
      saveReflections(CID, {});
      saveNotes(CID, {});
      saveFlags(CID, {});
      saveAssignmentStatuses(CID, {});
      saveQuickObs(CID, {});

      withdrawStudent(CID, 's1');

      const students = getStudents(CID);
      expect(students).toHaveLength(1);
      expect(students[0].id).toBe('s2');
    });

    it("takes the withdrawn student's scores out of getScores and keeps them", () => {
      saveStudents(CID, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
      saveScores(CID, {
        s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
      });
      saveGoals(CID, {});
      saveReflections(CID, {});
      saveNotes(CID, {});
      saveFlags(CID, {});
      saveAssignmentStatuses(CID, {});
      saveQuickObs(CID, {});

      withdrawStudent(CID, 's1');

      const scores = getScores(CID);
      expect(scores['s1']).toBeUndefined();
      expect(getWithdrawnStudents(CID)[0].records.scores).toHaveLength(1);
    });
  });

  describe('deleteRubric on nonexistent ID', () => {
    it('does not crash when deleting a nonexistent rubric', () => {
      saveRubrics(CID, [{ id: 'r1', title: 'Real Rubric' }]);
      saveAssessments(CID, []);

      expect(() => deleteRubric(CID, 'nonexistent')).not.toThrow();
      expect(getRubrics(CID)).toHaveLength(1);
    });
  });

  describe('orphaned score cleanup on assessment removal', () => {
    it('scores for removed assessments are cleaned up by saveAssessments', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
      saveScores(CID, {
        stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-15', type: 'summative' }],
      });

      // Remove the assessment — orphaned scores should be cleaned
      saveAssessments(CID, []);

      const scores = getScores(CID);
      expect(scores['stu1']).toHaveLength(0);
    });

    it('only cleans scores for the removed assessment', () => {
      saveAssessments(CID, [
        { id: 'a1', title: 'Quiz 1', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
        { id: 'a2', title: 'Quiz 2', date: '2025-01-20', type: 'summative', tagIds: ['t1'] },
      ]);
      saveScores(CID, {
        stu1: [
          { id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-15', type: 'summative' },
          { id: 'e2', assessmentId: 'a2', tagId: 't1', score: 4, date: '2025-01-20', type: 'summative' },
        ],
      });

      // Remove only a1 — a2 scores should remain
      saveAssessments(CID, [{ id: 'a2', title: 'Quiz 2', date: '2025-01-20', type: 'summative', tagIds: ['t1'] }]);

      const scores = getScores(CID);
      expect(scores['stu1']).toHaveLength(1);
      expect(scores['stu1'][0].assessmentId).toBe('a2');
    });
  });

  describe('clearing data with empty values', () => {
    it('saveCourses with empty object clears all courses', () => {
      saveCourses({ test: { id: 'test', name: 'Test' } });
      saveCourses({});
      const courses = loadCourses();
      expect(Object.keys(courses)).toHaveLength(0);
    });

    it('saveStudents with empty array clears roster', () => {
      saveStudents(CID, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
      saveStudents(CID, []);
      expect(getStudents(CID)).toEqual([]);
    });

    it('saveScores with empty object clears all scores', () => {
      saveScores(CID, {
        s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
      });
      saveScores(CID, {});
      expect(getScores(CID)).toEqual({});
    });

    it('saveAssessments with empty array clears assessments', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Quiz', tagIds: ['t1'] }]);
      saveAssessments(CID, []);
      expect(getAssessments(CID)).toEqual([]);
    });
  });
});

describe('data-display', () => {
  /**
   * Display name and sorting tests — shared/data.js
   */

  describe('fullName', () => {
    it('concatenates firstName and lastName', () => {
      expect(fullName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    });

    it('handles only firstName', () => {
      expect(fullName({ firstName: 'Jane', lastName: '' })).toBe('Jane');
    });

    it('handles only lastName', () => {
      expect(fullName({ firstName: '', lastName: 'Doe' })).toBe('Doe');
    });

    it('returns empty string when both empty', () => {
      expect(fullName({ firstName: '', lastName: '' })).toBe('');
    });
  });

  describe('displayName', () => {
    it('puts the preferred name before the last name', () => {
      expect(displayName({ preferred: 'Teddy', firstName: 'Theodore', lastName: 'Okafor' })).toBe('Teddy Okafor');
    });

    it('keeps a preferred name alone when there is no last name', () => {
      expect(displayName({ preferred: 'Zee', firstName: '', lastName: '' })).toBe('Zee');
    });

    it('falls back to fullName when no preferred', () => {
      expect(displayName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    });

    it('falls back to fullName when preferred is empty', () => {
      expect(displayName({ preferred: '', firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    });
  });

  describe('displayNameFirst', () => {
    it('returns preferred when set', () => {
      expect(displayNameFirst({ preferred: 'JD', firstName: 'Jane', lastName: 'Doe' })).toBe('JD');
    });

    it('falls back to firstName', () => {
      expect(displayNameFirst({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane');
    });

    it('falls back to lastName when no firstName', () => {
      expect(displayNameFirst({ firstName: '', lastName: 'Doe' })).toBe('Doe');
    });

    it('returns empty string when all missing', () => {
      expect(displayNameFirst({ firstName: '', lastName: '' })).toBe('');
    });
  });

  describe('displayNameWithLast', () => {
    it('puts the preferred name before the last name', () => {
      expect(displayNameWithLast({ preferred: 'Bobby', firstName: 'Robert', lastName: 'Smith' })).toBe('Bobby Smith');
    });

    it('uses the first name when there is no preferred name', () => {
      expect(displayNameWithLast({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    });

    it('handles a missing last name', () => {
      expect(displayNameWithLast({ preferred: 'Cece', firstName: 'Cece', lastName: '' })).toBe('Cece');
    });
  });

  describe('sortStudents', () => {
    const students = [
      { firstName: 'Charlie', lastName: 'Adams' },
      { firstName: 'Alice', lastName: 'Brown' },
      { firstName: 'Bob', lastName: 'Adams' },
    ];

    it('sorts by lastName by default', () => {
      const result = sortStudents(students);
      expect(result[0].firstName).toBe('Bob'); // Adams, Bob < Adams, Charlie
      expect(result[1].firstName).toBe('Charlie');
      expect(result[2].firstName).toBe('Alice'); // Brown
    });

    it('sorts by firstName when mode is firstName', () => {
      const result = sortStudents(students, 'firstName');
      expect(result[0].firstName).toBe('Alice');
      expect(result[1].firstName).toBe('Bob');
      expect(result[2].firstName).toBe('Charlie');
    });

    it('does not mutate original array', () => {
      const original = [...students];
      sortStudents(students);
      expect(students[0]).toBe(original[0]);
    });

    describe('gradeLow and flagged', () => {
      const roster = [
        { id: 'a', firstName: 'Ann', lastName: 'Able' },
        { id: 'b', firstName: 'Ben', lastName: 'Best' },
        { id: 'c', firstName: 'Cal', lastName: 'Cole' },
      ];
      const saved = {};
      const stub = (name, fn) => {
        saved[name] = globalThis[name];
        globalThis[name] = fn;
      };
      afterEach(() => {
        Object.keys(saved).forEach(name => (globalThis[name] = saved[name]));
      });

      it('puts the lowest proficiency first and ungraded students last', () => {
        stub('courseGradeMode', () => 'proficiency');
        stub('getOverallProficiency', (cid, sid) => ({ a: 0, b: 3.2, c: 1.8 })[sid]);
        expect(sortStudents(roster, 'gradeLow', 'c1').map(s => s.id)).toEqual(['c', 'b', 'a']);
      });

      it('sorts a Letter class by percent', () => {
        stub('courseGradeMode', () => 'letter');
        stub('getCourseLetterData', (cid, sid) => ({ R: { a: 91, b: 64, c: null }[sid] }));
        expect(sortStudents(roster, 'gradeLow', 'c1').map(s => s.id)).toEqual(['b', 'a', 'c']);
      });

      it('puts flagged students first and keeps the order within each group', () => {
        stub('getFlags', () => ({ c: true }));
        expect(sortStudents(roster, 'flagged', 'c1').map(s => s.id)).toEqual(['c', 'a', 'b']);
      });
    });
  });
});

describe('data-idempotency-keys', () => {
  /**
   * Idempotency keys on the direct (online) write paths.
   *
   * Every mutating v2 RPC in FV_IDEMPOTENT_RPCS accepts an optional
   * p_idempotency_key uuid and caches its result per (key, teacher, endpoint)
   * through fv_idem_check / fv_idem_store. The offline queue already sent one;
   * the direct call sites did not, so fv_idempotency stayed empty.
   *
   * The property that makes the key worth anything is that it survives a retry:
   * _callRpcWithAuthGuard re-sends the same params after a token refresh, and
   * again from the session-expired queue. A key minted per attempt would dedup
   * nothing.
   */

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function keyOf(params) {
    return params.p_idempotency_key;
  }

  describe('_stampIdempotencyKey', () => {
    it('stamps a uuid key on an endpoint that accepts one', () => {
      var params = _stampIdempotencyKey('upsert_subject', { p_course_id: 'c1' });
      expect(keyOf(params)).toMatch(UUID_RE);
    });

    it('leaves an endpoint that has no such parameter untouched', () => {
      // PostgREST resolves overloads by argument name, so sending the parameter
      // to one of these would fail the call with "function does not exist".
      ['update_assessment', 'delete_subject', 'save_term_rating', 'upsert_tag_score', 'reorder_roster'].forEach(
        function (name) {
          var params = _stampIdempotencyKey(name, { p_id: 'x' });
          expect(Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')).toBe(false);
        },
      );
    });

    it('keeps the first key when stamped again — this is what makes a retry dedup', () => {
      var params = { p_course_id: 'c1' };
      _stampIdempotencyKey('upsert_subject', params);
      var first = keyOf(params);
      _stampIdempotencyKey('upsert_subject', params);
      expect(keyOf(params)).toBe(first);
    });

    it('gives distinct writes distinct keys, so neither suppresses the other', () => {
      var a = _stampIdempotencyKey('upsert_note', { p_enrollment_id: 'e1', p_body: 'first' });
      var b = _stampIdempotencyKey('upsert_note', { p_enrollment_id: 'e1', p_body: 'second' });
      expect(keyOf(a)).not.toBe(keyOf(b));
    });

    it('tolerates a missing params object', () => {
      expect(_stampIdempotencyKey('upsert_subject', null)).toBeNull();
    });
  });

  describe('FV_IDEMPOTENT_RPCS', () => {
    it('names exactly the endpoints the server retrofitted', () => {
      // Verified against pg_proc: these 44 are the public functions carrying a
      // p_idempotency_key argument (the three student ones from
      // migrations/20261019_withdraw_students.sql, the six report-form ones
      // from migrations/20261020_report_template / _report_issue / _guardian,
      // remove_section / restore_section from
      // migrations/20261022_soft_remove_competency.sql, the four questionnaire
      // ones from migrations/20261025_questionnaires_tables_and_functions.sql,
      // the four phone-report ones from migrations/20261025_phone_reports.sql,
      // save_score_report_note from migrations/20261031_score_report_note.sql,
      // and save_comment_template / delete_comment_template from
      // migrations/20261031_comment_template.sql, live once it is applied),
      // set_rubric_printed from migrations/20261102_rubric_print.sql, and
      // move_rubric_scores from migrations/20261102_move_rubric_scores.sql,
      // and submit_support_report from migrations/20261105_support_report.sql.
      // Keep in lockstep with the database.
      expect(Object.keys(FV_IDEMPOTENT_RPCS).sort()).toEqual([
        'close_phone_report',
        'create_assessment',
        'create_course',
        'create_custom_tag',
        'create_observation',
        'create_phone_report',
        'create_report_issue',
        'create_student_and_enroll',
        'delete_comment_template',
        'delete_guardian',
        'delete_questionnaire',
        'delete_report_issue',
        'delete_report_template',
        'delete_withdrawn_student',
        'duplicate_assessment',
        'duplicate_course',
        'import_json_restore',
        'import_roster_csv',
        'import_teams_class',
        'move_rubric_scores',
        'reenrol_student',
        'remove_section',
        'restore_section',
        'save_comment_template',
        'save_report_template',
        'save_score_report_note',
        'set_questionnaire_on',
        'set_rubric_printed',
        'submit_support_report',
        'update_phone_report',
        'upsert_category',
        'upsert_competency_group',
        'upsert_guardian',
        'upsert_module',
        'upsert_note',
        'upsert_observation_template',
        'upsert_questionnaire',
        'upsert_rubric',
        'upsert_section',
        'upsert_subject',
        'upsert_tag',
        'withdraw_student',
      ]);
    });
  });

  describe('retry reuses the same key', () => {
    var originalGetSupabase;
    var originalRefresh;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      originalRefresh = globalThis.refreshSupabaseSession;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      globalThis.refreshSupabaseSession = originalRefresh;
      _useSupabase = originalUseSupabase;
    });

    it('sends the identical key on the post-refresh retry', async () => {
      var calls = [];
      var attempt = 0;
      globalThis.getSupabase = function () {
        return {
          rpc: function (name, payload) {
            calls.push({ name: name, key: payload.p_idempotency_key });
            attempt += 1;
            // First attempt looks like an expired token; the guard refreshes the
            // session and replays the very same params object.
            if (attempt === 1) return Promise.resolve({ data: null, error: { message: 'JWT expired' } });
            return Promise.resolve({ data: 'subject-uuid', error: null });
          },
        };
      };
      globalThis.refreshSupabaseSession = function () {
        return Promise.resolve({ session: { access_token: 't' } });
      };

      await _callRpcWithAuthGuard('upsert_subject', { p_course_id: 'c1', p_name: 'Science' }, {});

      expect(calls).toHaveLength(2);
      expect(calls[0].key).toMatch(UUID_RE);
      expect(calls[1].key).toBe(calls[0].key);
    });

    it('carries a key through the v2 upsert wrappers', async () => {
      var seen = [];
      globalThis.getSupabase = function () {
        return {
          rpc: function (name, payload) {
            seen.push({ name: name, key: payload.p_idempotency_key });
            return Promise.resolve({ data: null, error: null });
          },
        };
      };

      await window.v2.upsertSubject({ courseId: 'c1', name: 'Science', displayOrder: 0 });
      await window.v2.upsertTag({ id: null, sectionId: 's1', label: 'Tag' });

      expect(seen).toHaveLength(2);
      seen.forEach(function (c) {
        expect(c.key, c.name).toMatch(UUID_RE);
      });
    });
  });
});

describe('data-init-invokes-canonical-reads', () => {
  /**
   * Regression guard — proves initData actually calls the v2 read RPC.
   *
   * This exists because on April 3, 2026 the canonical_schema_foundation migration
   * dropped every legacy public table, and the shared/data.js reads were gated
   * behind an `if (false && _useSupabase)` stub for 16 days. Writes worked, but
   * on sign-in no RPC was fired, localStorage silently filled the gap, and
   * sign-out wiped the cache. Teachers reloaded to empty dashboards.
   *
   * In the v2 rebuild, the boot read is get_gradebook(p_course_id). The old
   * canonical-schema RPCs (list_course_roster, list_course_assessments, etc.)
   * do not exist on gradebook-prod and were never shipped. This file guards
   * against get_gradebook being stubbed out or silently skipped.
   */

  const CID = '11111111-1111-1111-1111-111111111111';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: { students: [], assessments: [], cells: {}, row_summaries: {} }, error: null });
      },
    };
  }

  describe('initData invokes the v2 get_gradebook RPC', () => {
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();

      COURSES[CID] = { id: CID, name: 'Science 8', subjectCode: 'SCI8' };
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('fires get_gradebook on init', async () => {
      var client = makeRecordingClient();
      globalThis.getSupabase = () => client;

      await initData(CID);

      var names = client.calls.map(function (c) {
        return c.name;
      });
      expect(names).toContain('get_gradebook');
    });

    it('passes p_course_id to get_gradebook', async () => {
      var client = makeRecordingClient();
      globalThis.getSupabase = () => client;

      await initData(CID);

      var call = client.calls.find(function (c) {
        return c.name === 'get_gradebook';
      });
      expect(call, 'get_gradebook should have been called').toBeDefined();
      expect(call.payload.p_course_id).toBe(CID);
    });

    it('does not silently no-op when Supabase is enabled for a canonical-UUID course', async () => {
      var client = makeRecordingClient();
      globalThis.getSupabase = () => client;

      await initData(CID);

      // The April 3 stub looked like `if (false && _useSupabase) { ...reads... }`
      // which meant zero RPCs fired. This is the bare-minimum assertion that
      // the read path is reachable at all.
      expect(client.calls.length).toBeGreaterThan(0);
    });
  });
});

describe('data-learningmap', () => {
  /**
   * Learning map accessor tests — shared/data.js
   * Uses flat format (1:1 section-to-tag, section.id = tag.id)
   */

  const CID = 'test';

  const MOCK_MAP = {
    _flatVersion: 2,
    subjects: [{ id: 'SCI8', name: 'Science 8' }],
    sections: [
      {
        id: 't1',
        name: 'Questioning',
        color: '#0891b2',
        subject: 'SCI8',
        shortName: 'Questioning',
        tags: [
          {
            id: 't1',
            label: 'Question and Predict',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Questioning',
            shortName: 'Questioning',
          },
        ],
      },
      {
        id: 't2',
        name: 'Planning',
        color: '#0891b2',
        subject: 'SCI8',
        shortName: 'Planning',
        tags: [
          {
            id: 't2',
            label: 'Plan Investigations',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Planning',
            shortName: 'Planning',
          },
        ],
      },
      {
        id: 't3',
        name: 'Processing',
        color: '#0891b2',
        subject: 'SCI8',
        shortName: 'Processing',
        tags: [
          {
            id: 't3',
            label: 'Identify Patterns',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Processing',
            shortName: 'Processing',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    _cache.learningMaps[CID] = MOCK_MAP;
  });

  describe('getSections', () => {
    it('returns sections from learning map', () => {
      const sections = getSections(CID);
      expect(sections).toHaveLength(3);
      expect(sections[0].name).toBe('Questioning');
    });

    it('returns empty array if no sections', () => {
      _cache.learningMaps[CID] = { subjects: [] };
      expect(getSections(CID)).toEqual([]);
    });
  });

  describe('getSubjects', () => {
    it('returns subjects from learning map', () => {
      const subjects = getSubjects(CID);
      expect(subjects).toHaveLength(1);
      expect(subjects[0].id).toBe('SCI8');
    });
  });

  describe('getAllTags', () => {
    it('flattens tags from all sections', () => {
      const tags = getAllTags(CID);
      expect(tags).toHaveLength(3);
      expect(tags.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    });

    it('returns empty array when no sections', () => {
      _cache.learningMaps[CID] = { sections: [] };
      expect(getAllTags(CID)).toEqual([]);
    });
  });

  describe('getTagById', () => {
    it('finds tag by id', () => {
      const tag = getTagById(CID, 't2');
      expect(tag.label).toBe('Plan Investigations');
    });

    it('returns undefined for missing tag', () => {
      expect(getTagById(CID, 'nonexistent')).toBeUndefined();
    });
  });

  describe('getSectionForTag', () => {
    it('returns section containing the tag (section.id = tag.id in flat format)', () => {
      const section = getSectionForTag(CID, 't3');
      expect(section.id).toBe('t3');
      expect(section.name).toBe('Processing');
    });

    it('returns undefined for tag not in any section', () => {
      expect(getSectionForTag(CID, 'nonexistent')).toBeUndefined();
    });
  });
});

describe('data-list-course-student-profiles-hydration', () => {
  /**
   * list_course_student_profiles happy-path hydration test.
   *
   * Codex's regression coverage in tests/data-pagination.test.js mocks
   * list_course_student_profiles as PGRST202 (the missing-RPC fallback).
   * That proves the fallback works but says nothing about the common path —
   * the path that fires on every sign-in against a current Supabase deployment.
   *
   * This test pins the rich-hydration contract: when list_course_student_profiles
   * returns a populated row, _applyStudentProfileSummaries must correctly
   * populate _cache.notes / goals / reflections / overrides / flags /
   * studentProfileSummaries. If a future schema change drops a field or
   * renames a key, this test catches it.
   */

  const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ENROLLMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const SECTION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  function richProfileRow() {
    return {
      enrollment: {
        id: ENROLLMENT_ID,
        student_id: STUDENT_ID,
        roster_position: 1,
        designations: [],
        is_flagged: true,
      },
      student: {
        id: STUDENT_ID,
        first_name: 'Ada',
        last_name: 'Lovelace',
        preferred_name: 'Countess',
        pronouns: 'she/her',
        student_number: 'A001',
        email: 'ada@example.test',
        date_of_birth: '1815-12-10',
      },
      overall_proficiency: 3.5,
      letter: 'B',
      counts: { assessments: 4 },
      goals: { [SECTION_ID]: 'Master argument structure by midterm.' },
      reflections: {
        [SECTION_ID]: { body: 'I am improving my evidence use.', confidence: 4, updated_at: '2026-04-20' },
      },
      section_overrides: {
        [SECTION_ID]: { level: 4, reason: 'Capstone work demonstrated mastery.', updated_at: '2026-04-20' },
      },
      notes: [{ body: 'First note about strong work.' }, { body: 'Second note: ready for extension.' }],
      is_flagged: true,
      recent_observations: [],
    };
  }

  describe('loadStudentProfileSummaries — happy path (rich RPC response)', () => {
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();

      // Reset the relevant cache slots so the test starts from a clean state.
      ['students', 'goals', 'reflections', 'overrides', 'notes', 'flags', 'studentProfileSummaries'].forEach(
        function (field) {
          if (_cache[field]) _cache[field][CID] = undefined;
        },
      );
      // Seed a student in the cache so _applyStudentProfileSummaries can
      // hydrate enriched fields onto it.
      _cache.students[CID] = [{ id: ENROLLMENT_ID, firstName: 'placeholder', lastName: '' }];
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('populates notes / goals / reflections / overrides / flags from one rich row', async () => {
      var calls = [];
      globalThis.getSupabase = function () {
        return {
          rpc(name, payload) {
            calls.push({ name: name, payload: payload || {} });
            if (name === 'list_course_student_profiles') {
              return Promise.resolve({ data: [richProfileRow()], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      };

      await loadStudentProfileSummaries(CID);

      // Confirm it actually called the rich-hydration RPC.
      expect(calls.map(c => c.name)).toContain('list_course_student_profiles');

      // Notes — array of {body} → joined with double-newline.
      expect(_cache.notes[CID]).toEqual({
        [ENROLLMENT_ID]: 'First note about strong work.\n\nSecond note: ready for extension.',
      });

      // Goals + reflections — passed through as-is.
      expect(_cache.goals[CID]).toEqual({
        [ENROLLMENT_ID]: { [SECTION_ID]: 'Master argument structure by midterm.' },
      });
      expect(_cache.reflections[CID]).toEqual({
        [ENROLLMENT_ID]: {
          [SECTION_ID]: { body: 'I am improving my evidence use.', confidence: 4, updated_at: '2026-04-20' },
        },
      });

      // Section overrides — same structure.
      expect(_cache.overrides[CID]).toEqual({
        [ENROLLMENT_ID]: {
          [SECTION_ID]: { level: 4, reason: 'Capstone work demonstrated mastery.', updated_at: '2026-04-20' },
        },
      });

      // Flags — true row → entry in cache.
      expect(_cache.flags[CID]).toEqual({ [ENROLLMENT_ID]: true });

      // Summaries — full normalized record indexed by enrollment id.
      var summary = _cache.studentProfileSummaries[CID][ENROLLMENT_ID];
      expect(summary).toBeDefined();
      expect(summary.student.firstName).toBe('Ada');
      expect(summary.student.lastName).toBe('Lovelace');
      expect(summary.student.personId).toBe(STUDENT_ID);
      expect(summary.overallProficiency).toBe(3.5);
      expect(summary.letter).toBe('B');
      expect(summary.isFlagged).toBe(true);

      // The cached student row was enriched with name fields off the summary.
      expect(_cache.students[CID][0]).toEqual(
        expect.objectContaining({
          id: ENROLLMENT_ID,
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferred: 'Countess',
          pronouns: 'she/her',
          studentNumber: 'A001',
          isFlagged: true,
        }),
      );
    });

    it('skips populating note/goal caches when the row has empty arrays/objects', async () => {
      var emptyRow = richProfileRow();
      emptyRow.notes = [];
      emptyRow.goals = {};
      emptyRow.reflections = {};
      emptyRow.section_overrides = {};
      emptyRow.is_flagged = false;
      emptyRow.enrollment.is_flagged = false;

      globalThis.getSupabase = function () {
        return {
          rpc(name) {
            if (name === 'list_course_student_profiles') {
              return Promise.resolve({ data: [emptyRow], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      };

      await loadStudentProfileSummaries(CID);

      // Empty inputs should NOT write entries — guards against the cache
      // getting populated with empty placeholder objects.
      expect(_cache.notes[CID] || {}).toEqual({});
      expect(_cache.goals[CID]).toEqual({});
      expect(_cache.reflections[CID]).toEqual({});
      expect(_cache.overrides[CID]).toEqual({});
      expect(_cache.flags[CID]).toEqual({});
      // But the summary record itself is still populated.
      expect(_cache.studentProfileSummaries[CID][ENROLLMENT_ID]).toBeDefined();
    });
  });
});

describe('data-load-safety', () => {
  /**
   * Class load safety (docs/class-loading-plan.md, Phase 1).
   *
   * Showing a saved copy before the server answers is only safe if a load can
   * never make that copy worse. These cover the ways a load used to: a failed
   * request blanked the class, a load overwrote edits still being sent, every
   * load rewrote localStorage (so other tabs reloaded in a loop), and report
   * card fields were wiped on load and sent back to the server empty.
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const OTHER_CID = '99999999-9999-9999-9999-999999999999';
  const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
  const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
  const ASSESSMENT_ID = '55555555-5555-5555-5555-555555555555';
  const TAG_ID = '88888888-8888-8888-8888-888888888888';

  function gradebookPayload(score) {
    return {
      course: { id: CID },
      students: [
        {
          enrollment_id: ENROLLMENT_ID,
          student_id: STUDENT_ID,
          first_name: 'Ada',
          last_name: 'Lovelace',
          roster_position: 1,
        },
      ],
      assessments: [
        {
          id: ASSESSMENT_ID,
          title: 'Lab 1',
          score_mode: 'proficiency',
          tag_ids: [TAG_ID],
          date_assigned: '2026-10-01',
        },
      ],
      categories: [],
      modules: [],
      cells: {
        [ENROLLMENT_ID]: {
          [ASSESSMENT_ID]: {
            score: { value: score, status: null, comment: '', updated_at: '2026-10-02T00:00:00Z' },
            tag_scores: [{ tag_id: TAG_ID, value: score }],
            rubric_scores: [],
          },
        },
      },
    };
  }

  function deferred() {
    var resolve;
    var promise = new Promise(function (r) {
      resolve = r;
    });
    return { promise: promise, resolve: resolve };
  }

  function useServer(routes) {
    var calls = [];
    globalThis.getSupabase = function () {
      return {
        rpc(name, payload) {
          calls.push(name);
          var handler = routes[name];
          if (!handler) return Promise.resolve({ data: null, error: null });
          return Promise.resolve(typeof handler === 'function' ? handler(payload || {}) : handler);
        },
      };
    };
    return calls;
  }

  function resetCourse(cid) {
    Object.keys(_DATA_KEYS).forEach(function (field) {
      delete _cache[field][cid];
    });
  }

  describe('class load safety', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var originalQuiet;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      originalQuiet = _REFRESH_QUIET_MS;
      _REFRESH_QUIET_MS = 0;
      _useSupabase = true;
      localStorage.clear();
      resetCourse(CID);
      resetCourse(OTHER_CID);
      _loadError = {};
      delete globalThis.v2Queue;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      _REFRESH_QUIET_MS = originalQuiet;
      delete globalThis.v2Queue;
    });

    it('keeps the saved copy and the server baseline when a load fails', async () => {
      var fail = false;
      useServer({
        get_gradebook() {
          return fail ? { data: null, error: { message: 'timeout' } } : { data: gradebookPayload(3), error: null };
        },
      });
      await initData(CID);
      var savedStudents = localStorage.getItem('gb-students-' + CID);
      var savedScores = localStorage.getItem('gb-scores-' + CID);
      var baseline = JSON.stringify(_serverState.scores[CID]);

      fail = true;
      await initData(CID);

      expect(getStudents(CID).map(s => s.firstName)).toEqual(['Ada']);
      expect(localStorage.getItem('gb-students-' + CID)).toBe(savedStudents);
      expect(localStorage.getItem('gb-scores-' + CID)).toBe(savedScores);
      expect(JSON.stringify(_serverState.scores[CID])).toBe(baseline);
      expect(courseLoadFailed(CID)).toBe(true);
    });

    it('loads the localStorage copy when a load fails with nothing in memory', async () => {
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
      await initData(CID);
      resetCourse(CID);

      useServer({ get_gradebook: { data: null, error: { message: 'offline' } } });
      await initData(CID);

      expect(getStudents(CID).map(s => s.firstName)).toEqual(['Ada']);
    });

    it('writes the same localStorage string when the same data loads twice', async () => {
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
      await initData(CID);
      var first = localStorage.getItem('gb-scores-' + CID);
      await initData(CID);
      expect(localStorage.getItem('gb-scores-' + CID)).toBe(first);
    });

    it('keeps term ratings and report config this device has', async () => {
      saveTermRatings(CID, { [ENROLLMENT_ID]: { 'term-1': { narrative: 'Kind and curious.' } } });
      saveReportConfig(CID, { preset: 'brief' });
      resetCourse(CID);
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });

      await initData(CID);

      expect(getTermRatings(CID)[ENROLLMENT_ID]['term-1'].narrative).toBe('Kind and curious.');
      expect(getReportConfig(CID)).toEqual(expect.objectContaining({ preset: 'brief' }));
    });

    it('does not overwrite a field edited while the load was running', async () => {
      var gate = deferred();
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
      await initData(CID);

      useServer({
        get_gradebook() {
          return gate.promise.then(function () {
            return { data: gradebookPayload(1), error: null };
          });
        },
      });
      var load = initData(CID);
      var edited = JSON.parse(JSON.stringify(getScores(CID)));
      edited[ENROLLMENT_ID][0].score = 4;
      _cache.scores[CID] = edited;
      _markLocalWrite('scores', CID);
      gate.resolve();
      await load;

      expect(getScores(CID)[ENROLLMENT_ID][0].score).toBe(4);
      // The skipped field is fetched again once the edit has landed.
      expect(_refreshState[CID].running).toBeTruthy();
      useServer({ get_gradebook: { data: gradebookPayload(4), error: null } });
      await _refreshState[CID].running;
    });

    it('keeps refreshing until a pass is not interrupted by an edit', async () => {
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
      await initData(CID);

      // The teacher edits scores during each of the first four fetches.
      var fetches = 0;
      useServer({
        get_gradebook() {
          fetches += 1;
          if (fetches <= 4) _markLocalWrite('scores', CID);
          return { data: gradebookPayload(fetches <= 4 ? 1 : 2), error: null };
        },
      });
      await _handleExternalCourseUpdate(CID, 'gradebook');

      expect(fetches).toBe(5);
      expect(getScores(CID)[ENROLLMENT_ID][0].score).toBe(2);
    });

    it('keeps the saved copy while earlier writes are still unsent', async () => {
      useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
      await initData(CID);
      resetCourse(CID);

      var queued = 1;
      globalThis.v2Queue = {
        stats() {
          return { queued: queued };
        },
      };
      var calls = useServer({ get_gradebook: { data: gradebookPayload(1), error: null } });
      await initData(CID);

      expect(calls).not.toContain('get_gradebook');
      expect(getScores(CID)[ENROLLMENT_ID][0].score).toBe(3);

      queued = 0;
      await _refreshState[CID].running;
      expect(calls).toContain('get_gradebook');
    });

    it('lets the last of two overlapping switches win', async () => {
      var originalBody = document.body;
      document.body = {
        appendChild() {},
        setAttribute() {},
        removeAttribute() {},
        classList: { add() {}, remove() {} },
      };
      saveCourses({ [CID]: { id: CID, name: 'A' }, [OTHER_CID]: { id: OTHER_CID, name: 'B' } });
      var gate = deferred();
      useServer({
        get_gradebook(payload) {
          if (payload.p_course_id === CID) {
            return gate.promise.then(function () {
              return { data: gradebookPayload(3), error: null };
            });
          }
          return { data: gradebookPayload(2), error: null };
        },
      });

      var first = switchActiveCourse(CID);
      var second = switchActiveCourse(OTHER_CID);
      expect(await second).toBe(true);
      gate.resolve();
      expect(await first).toBe(false);
      expect(getActiveCourse()).toBe(OTHER_CID);
      document.body = originalBody;
    });
  });

  describe('term rating saves', () => {
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();
      resetCourse(CID);
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    function captureSaves() {
      var saves = [];
      globalThis.getSupabase = function () {
        return {
          rpc(name, payload) {
            if (name === 'save_term_rating') saves.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      };
      return saves;
    }

    it('sends only the changed field, for the Reports page term ids', async () => {
      var saves = captureSaves();
      upsertTermRating(CID, ENROLLMENT_ID, 'term-2', { socialTraits: ['kind'] });
      await Promise.resolve();

      expect(saves).toHaveLength(1);
      expect(saves[0].p_term).toBe(2);
      expect(saves[0].p_payload).toEqual({ social_traits: ['kind'] });
    });

    it('sends a cleared rating as null', async () => {
      var saves = captureSaves();
      upsertTermRating(CID, ENROLLMENT_ID, 'term-1', { workHabits: 0 });
      await Promise.resolve();
      expect(saves[0].p_payload).toEqual({ work_habits_rating: null });
    });

    it('sends nothing for fields the server does not store', async () => {
      var saves = captureSaves();
      upsertTermRating(CID, ENROLLMENT_ID, 'term-1', { dims: { engagement: 3 } });
      await Promise.resolve();
      expect(saves).toHaveLength(0);
    });
  });

  describe('saved data belongs to one teacher', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('removes another teacher’s saved classes and keeps the outbox', () => {
      localStorage.setItem('gb-owner', 'teacher-a');
      localStorage.setItem('gb-students-' + CID, '[]');
      localStorage.setItem('fv-sync-queue-v1', '{"entries":[]}');

      _scopeLocalDataToTeacher('teacher-b');

      expect(localStorage.getItem('gb-students-' + CID)).toBeNull();
      expect(localStorage.getItem('fv-sync-queue-v1')).not.toBeNull();
      expect(localStorage.getItem('gb-owner')).toBe('teacher-b');
    });

    it('keeps saved classes for the same teacher', () => {
      localStorage.setItem('gb-owner', 'teacher-a');
      localStorage.setItem('gb-students-' + CID, '[]');
      _scopeLocalDataToTeacher('teacher-a');
      expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
    });

    it('removes saved data for classes the server no longer lists', () => {
      localStorage.setItem('gb-students-' + CID, '[]');
      localStorage.setItem('gb-student-profile-summaries-' + OTHER_CID, '{}');
      localStorage.setItem('gb-config', '{}');

      _purgeUnlistedCourseData({ [CID]: { id: CID } });

      expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
      expect(localStorage.getItem('gb-student-profile-summaries-' + OTHER_CID)).toBeNull();
      expect(localStorage.getItem('gb-config')).toBe('{}');
    });

    it('clears every per-class key when a class is removed locally', () => {
      saveCourses({ [CID]: { id: CID, name: 'A' } });
      localStorage.setItem('gb-categories-' + CID, '[]');
      localStorage.setItem('gb-student-profile-summaries-' + CID, '{}');
      _clearCourseLocalState(CID);
      expect(localStorage.getItem('gb-categories-' + CID)).toBeNull();
      expect(localStorage.getItem('gb-student-profile-summaries-' + CID)).toBeNull();
    });
  });

  describe('quick observations', () => {
    it('count as local edits so a running load leaves them alone', () => {
      _useSupabase = false;
      var before = _localWriteCount(CID, 'observations');
      addQuickOb(CID, ENROLLMENT_ID, 'Helped a classmate');
      expect(_localWriteCount(CID, 'observations')).toBe(before + 1);
    });
  });
});

describe('data-localstorage', () => {
  /**
   * localStorage safety layer tests — shared/data.js
   * Tests _safeLSSet, _safeParseLS, and localStorage persistence.
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.scores[CID] = undefined;
    _cache.students[CID] = undefined;
    _cache.assessments[CID] = undefined;
    _cache.courses = null;
    localStorage.clear();
  });

  describe('_safeLSSet', () => {
    it('writes to localStorage successfully', () => {
      _safeLSSet('gb-test-key', JSON.stringify({ hello: 'world' }));
      expect(localStorage.getItem('gb-test-key')).toBe('{"hello":"world"}');
    });

    it('catches errors without crashing when setItem throws', () => {
      const origSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      expect(() => _safeLSSet('gb-boom', 'value')).not.toThrow();
      localStorage.setItem = origSetItem;
    });

    it('reports a full device on the sync dot until that key saves again', () => {
      const origSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      };
      expect(_safeLSSet('gb-scores-full', 'value')).toBe(false);
      localStorage.setItem = origSetItem;
      expect(getSaveProblem()).toMatch(/storage is full/);
      // Another key saving does not clear it; the failed key saving does.
      _safeLSSet('gb-other', 'value');
      expect(getSaveProblem()).toMatch(/storage is full/);
      _safeLSSet('gb-scores-full', 'value');
      expect(getSaveProblem()).toBeNull();
    });

    it('handles very large values without crashing', () => {
      const bigValue = 'x'.repeat(100000);
      expect(() => _safeLSSet('gb-big', bigValue)).not.toThrow();
      expect(localStorage.getItem('gb-big')).toBe(bigValue);
    });
  });

  describe('_safeParseLS', () => {
    it('returns parsed JSON on valid data', () => {
      localStorage.setItem('gb-valid', JSON.stringify([1, 2, 3]));
      expect(_safeParseLS('gb-valid', [])).toEqual([1, 2, 3]);
    });

    it('returns fallback on corrupted JSON', () => {
      localStorage.setItem('gb-corrupt', '{broken');
      expect(_safeParseLS('gb-corrupt', 'default')).toBe('default');
    });

    it('returns fallback on null/missing key', () => {
      expect(_safeParseLS('gb-nonexistent', [])).toEqual([]);
    });

    it('returns fallback object when key is missing', () => {
      expect(_safeParseLS('gb-nope', { a: 1 })).toEqual({ a: 1 });
    });
  });

  describe('saveCourses localStorage persistence', () => {
    it('persists courses to localStorage when Supabase is off', () => {
      const courses = { test: { id: 'test', name: 'Test Course' } };
      saveCourses(courses);
      const stored = JSON.parse(localStorage.getItem('gb-courses'));
      expect(stored.test.name).toBe('Test Course');
    });
  });

  describe('clearing all gb-* keys', () => {
    it('results in empty arrays from getStudents and getAssessments', () => {
      // Save some data first
      saveStudents(CID, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
      saveAssessments(CID, [{ id: 'a1', title: 'Quiz', tagIds: ['t1'] }]);
      // Clear cache so getters fall through to localStorage
      _cache.students[CID] = undefined;
      _cache.assessments[CID] = undefined;
      // Clear localStorage
      localStorage.clear();
      // Reset cache again to force LS read
      _cache.students[CID] = undefined;
      _cache.assessments[CID] = undefined;
      expect(getStudents(CID)).toEqual([]);
      expect(getAssessments(CID)).toEqual([]);
    });
  });
});

describe('data-migration', () => {
  /**
   * Learning map migration tests — flatten section/tag hierarchy
   */

  const CID = 'migtest';

  describe('migrateLearningMap', () => {
    it('promotes section properties onto tags and changes section ID to tag ID', () => {
      const oldMap = {
        subjects: [{ id: 'SCI8', name: 'Science 8' }],
        sections: [
          {
            id: 'SCI8_questioning',
            subject: 'SCI8',
            name: 'Questioning and Predicting',
            shortName: 'Questioning',
            color: '#0891b2',
            tags: [{ id: 'QAP', label: 'Question and Predict', text: '' }],
          },
          {
            id: 'SCI8_evaluating',
            subject: 'SCI8',
            name: 'Evaluating',
            shortName: 'Evaluating',
            color: '#dc2626',
            tags: [{ id: 'EM', label: 'Evaluate Methods', text: '' }],
          },
        ],
      };

      const result = migrateLearningMap(oldMap);

      expect(result._flatVersion).toBe(2);
      // Section IDs become tag IDs
      expect(result.sections[0].id).toBe('QAP');
      expect(result.sections[1].id).toBe('EM');
      // Tags gain section properties
      expect(result.sections[0].tags[0].color).toBe('#0891b2');
      expect(result.sections[0].tags[0].subject).toBe('SCI8');
      expect(result.sections[0].tags[0].shortName).toBe('Questioning');
      expect(result.sections[0].tags[0].name).toBe('Questioning and Predicting');
      expect(result.sections[1].tags[0].color).toBe('#dc2626');
      // Legacy section ID is preserved for rollback
      expect(result.sections[0].tags[0]._legacySectionId).toBe('SCI8_questioning');
      expect(result.sections[1].tags[0]._legacySectionId).toBe('SCI8_evaluating');
      // sectionToTagMap is stored
      expect(result._sectionToTagMap).toEqual({
        SCI8_questioning: 'QAP',
        SCI8_evaluating: 'EM',
      });
    });

    it('is idempotent — already migrated maps are returned unchanged', () => {
      const alreadyFlat = {
        _flatVersion: 2,
        subjects: [{ id: 'SCI8', name: 'Science 8' }],
        sections: [
          {
            id: 'QAP',
            subject: 'SCI8',
            name: 'Questioning',
            color: '#0891b2',
            tags: [{ id: 'QAP', label: 'Question and Predict', color: '#0891b2' }],
          },
        ],
      };

      const result = migrateLearningMap(alreadyFlat);
      expect(result).toBe(alreadyFlat); // same reference — no mutation
      expect(result.sections[0].id).toBe('QAP');
    });

    it('handles null/undefined/empty maps gracefully', () => {
      expect(migrateLearningMap(null)).toBeNull();
      expect(migrateLearningMap(undefined)).toBeUndefined();
      expect(migrateLearningMap({ sections: [] })._flatVersion).toBe(2);
    });

    it('handles sections with no tags', () => {
      const map = {
        sections: [
          { id: 'empty', name: 'Empty Section', tags: [] },
          { id: 'sec2', name: 'Has Tag', color: '#ff0000', tags: [{ id: 'T1', label: 'Tag 1' }] },
        ],
      };
      const result = migrateLearningMap(map);
      expect(result.sections[0].id).toBe('empty'); // unchanged — no tag to adopt
      expect(result.sections[1].id).toBe('T1');
    });

    it('preserves tag IDs exactly — scores remain valid', () => {
      const map = {
        sections: [
          { id: 'OLD_SEC', tags: [{ id: 'QAP', label: 'Q&P' }] },
          { id: 'OLD_SEC2', tags: [{ id: 'PI', label: 'Plan' }] },
        ],
      };
      migrateLearningMap(map);
      // Tag IDs never change
      expect(map.sections[0].tags[0].id).toBe('QAP');
      expect(map.sections[1].tags[0].id).toBe('PI');
    });
  });

  describe('migrateOverridesForFlatMap', () => {
    beforeEach(() => {
      _cache.overrides[CID] = {
        stu1: {
          SCI8_questioning: { level: 3, reason: 'Good progress' },
          SCI8_evaluating: { level: 2, reason: 'Needs work' },
        },
        stu2: {
          SCI8_questioning: { level: 4, reason: 'Excellent' },
        },
      };
    });

    it('re-keys overrides from old section IDs to tag IDs', () => {
      const sectionToTag = {
        SCI8_questioning: 'QAP',
        SCI8_evaluating: 'EM',
      };

      migrateOverridesForFlatMap(CID, sectionToTag);

      const overrides = _cache.overrides[CID];
      expect(overrides['stu1']['QAP']).toEqual({ level: 3, reason: 'Good progress' });
      expect(overrides['stu1']['EM']).toEqual({ level: 2, reason: 'Needs work' });
      expect(overrides['stu1']['SCI8_questioning']).toBeUndefined();
      expect(overrides['stu2']['QAP']).toEqual({ level: 4, reason: 'Excellent' });
    });

    it('does nothing with empty sectionToTag map', () => {
      const before = JSON.stringify(_cache.overrides[CID]);
      migrateOverridesForFlatMap(CID, {});
      expect(JSON.stringify(_cache.overrides[CID])).toBe(before);
    });

    it('does nothing when overrides already use tag IDs', () => {
      _cache.overrides[CID] = {
        stu1: { QAP: { level: 3, reason: 'test' } },
      };
      const sectionToTag = { SCI8_questioning: 'QAP' };
      migrateOverridesForFlatMap(CID, sectionToTag);
      expect(_cache.overrides[CID]['stu1']['QAP']).toEqual({ level: 3, reason: 'test' });
    });
  });

  describe('migrateGoalsForFlatMap', () => {
    it('re-keys goals from old section IDs to tag IDs', () => {
      _cache.goals[CID] = {
        stu1: { SCI8_questioning: 'Improve questioning skills' },
      };
      migrateGoalsForFlatMap(CID, { SCI8_questioning: 'QAP' });
      expect(_cache.goals[CID]['stu1']['QAP']).toBe('Improve questioning skills');
      expect(_cache.goals[CID]['stu1']['SCI8_questioning']).toBeUndefined();
    });
  });

  describe('migrateReflectionsForFlatMap', () => {
    it('re-keys reflections from old section IDs to tag IDs', () => {
      _cache.reflections[CID] = {
        stu1: { SCI8_evaluating: { confidence: 3, text: 'Getting better', date: '2025-01-01' } },
      };
      migrateReflectionsForFlatMap(CID, { SCI8_evaluating: 'EM' });
      expect(_cache.reflections[CID]['stu1']['EM'].confidence).toBe(3);
      expect(_cache.reflections[CID]['stu1']['SCI8_evaluating']).toBeUndefined();
    });
  });
});

describe('data-observations-v2-dispatch', () => {
  /**
   * v2 observation + template + custom-tag dispatch tests — shared/data.js (Phase 4.4)
   *
   * Covers:
   *   _persistObservationCreate  → create_observation (single-student quick-post)
   *   _persistObservationUpdate  → update_observation (patch-only, joins=null)
   *   _persistObservationDelete  → delete_observation
   *   window.createObservationRich   → create_observation (multi-student + tags)
   *   window.updateObservationRich   → update_observation (patch + join replace)
   *   window.upsertObservationTemplate → upsert_observation_template
   *   window.deleteObservationTemplate → delete_observation_template
   *   window.createCustomTag           → create_custom_tag
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const ENR = '22222222-2222-2222-2222-222222222222';
  const ENR2 = '33333333-3333-3333-3333-333333333333';
  const OB_ID = '44444444-4444-4444-4444-444444444444';
  const AID = '55555555-5555-5555-5555-555555555555';
  const TAG1 = '66666666-6666-4666-8666-666666666666';
  const CTAG1 = '77777777-7777-4777-8777-777777777777';
  const TPL_ID = '88888888-8888-4888-8888-888888888888';

  function makeRecordingClient(responses) {
    var calls = [];
    responses = responses || {};
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        var r = responses[name];
        return Promise.resolve(r || { data: null, error: null });
      },
    };
  }

  describe('v2 observation / template / custom-tag dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('_persistObservationCreate (quick-post)', () => {
      it('calls create_observation with single-student enrollment_ids array', async () => {
        _persistObservationCreate(CID, ENR, {
          id: 'temp-id',
          text: 'Great insight',
          sentiment: 'strength',
          context: 'class-discussion',
        });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        expect(call).toBeDefined();
        expect(call.payload).toEqual({
          p_course_id: CID,
          p_body: 'Great insight',
          p_sentiment: 'strength',
          p_context_type: 'class-discussion',
          p_assessment_id: null,
          p_enrollment_ids: [ENR],
          p_tag_ids: [],
          p_custom_tag_ids: [],
          p_dims: [],
          p_level: null,
          p_idempotency_key: expect.any(String),
        });
      });

      it('sends the tags as p_dims string keys', async () => {
        _persistObservationCreate(CID, ENR, {
          id: 'temp-id',
          text: 't',
          dims: ['engagement', 'cc:3', 'tag:Lab safety', 'engagement', '', null],
        });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        expect(call.payload.p_dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);
        // Tag keys are not learning-map or custom_tag ids.
        expect(call.payload.p_tag_ids).toEqual([]);
        expect(call.payload.p_custom_tag_ids).toEqual([]);
      });

      it('passes p_assessment_id when assignmentContext has a UUID', async () => {
        _persistObservationCreate(CID, ENR, {
          id: 'x',
          text: 't',
          assignmentContext: { assessmentId: AID },
        });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        expect(call.payload.p_assessment_id).toBe(AID);
      });

      it('skips dispatch when course id is not a UUID', () => {
        _persistObservationCreate('legacy', ENR, { id: 'x', text: 't' });
        expect(client.calls).toHaveLength(0);
      });

      it('patches cache id with returned observation id on success', async () => {
        var entry = { id: 'temp-id', text: 't' };
        _cache.observations[CID] = _cache.observations[CID] || {};
        _cache.observations[CID][ENR] = [entry];
        client = makeRecordingClient({
          create_observation: { data: OB_ID, error: null },
        });
        globalThis.getSupabase = () => client;
        _persistObservationCreate(CID, ENR, entry);
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        expect(entry.id).toBe(OB_ID);
      });
    });

    describe('_persistObservationUpdate', () => {
      it('calls update_observation with jsonb patch and null joins', async () => {
        _persistObservationUpdate(CID, { id: OB_ID, text: 'Updated', sentiment: 'growth', context: 'lab' });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_id).toBe(OB_ID);
        expect(call.payload.p_patch).toEqual({
          body: 'Updated',
          sentiment: 'growth',
          context_type: 'lab',
          dims: [],
          level: null,
        });
        expect(call.payload.p_enrollment_ids).toBeNull();
        expect(call.payload.p_tag_ids).toBeNull();
        expect(call.payload.p_custom_tag_ids).toBeNull();
      });

      it('sends the current tags in the patch', async () => {
        _persistObservationUpdate(CID, { id: OB_ID, text: 'x', dims: ['collaboration', 'cc:7'] });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_patch.dims).toEqual(['collaboration', 'cc:7']);
      });

      it('sends an empty dims list when the last tag is removed', async () => {
        _persistObservationUpdate(CID, { id: OB_ID, text: 'x', dims: [] });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_patch.dims).toEqual([]);
      });

      it('adds assessment_id to patch when assignmentContext is a UUID', async () => {
        _persistObservationUpdate(CID, { id: OB_ID, assignmentContext: { assessmentId: AID } });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_patch.assessment_id).toBe(AID);
      });
    });

    describe('round trip to a second device', () => {
      it('a tag added on one device shows after another device loads the class', async () => {
        // Device A: post an observation with tags, then edit its tags.
        _cache.observations[CID] = {};
        client = makeRecordingClient({ create_observation: { data: OB_ID, error: null } });
        globalThis.getSupabase = () => client;
        addQuickOb(CID, ENR, 'Asked a strong question', ['engagement', 'cc:3'], 'strength', null);
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        updateQuickOb(CID, ENR, OB_ID, { dims: ['engagement', 'cc:3', 'tag:Lab safety'] });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var create = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        var update = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(create.payload.p_dims).toEqual(['engagement', 'cc:3']);
        expect(update.payload.p_patch.dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);

        // The server stores what was sent and returns it on the row.
        var row = {
          id: OB_ID,
          body: create.payload.p_body,
          sentiment: create.payload.p_sentiment,
          context_type: null,
          assessment_id: null,
          created_at: '2026-10-18T15:00:00Z',
          enrollment_ids: [ENR],
          tag_ids: [],
          custom_tag_ids: [],
          dims: update.payload.p_patch.dims,
        };

        // Device B: load the class from the server.
        var blob = _observationsPayloadToBlob({ observations: [row] }, CID);
        expect(blob[ENR][0].dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);
      });

      it('an Assignments-page comment keeps its assessment title after reload', async () => {
        _cache.assessments[CID] = [{ id: AID, title: 'Lab report 2' }];
        _cache.observations[CID] = {};
        addQuickOb(CID, ENR, 'Clear method section', [], null, null, {
          assessmentId: AID,
          assessmentTitle: 'Lab report 2',
        });
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var create = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        expect(create.payload.p_assessment_id).toBe(AID);

        var blob = _observationsPayloadToBlob(
          {
            observations: [
              {
                id: OB_ID,
                body: create.payload.p_body,
                assessment_id: create.payload.p_assessment_id,
                created_at: '2026-10-18T15:00:00Z',
                enrollment_ids: [ENR],
                dims: [],
              },
            ],
          },
          CID,
        );
        expect(blob[ENR][0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: 'Lab report 2' });
        delete _cache.assessments[CID];
      });
    });

    describe('competency and level', () => {
      function lastCall(name) {
        return client.calls
          .filter(function (c) {
            return c.name === name;
          })
          .pop();
      }
      function tick() {
        return new Promise(function (r) {
          setTimeout(r, 0);
        });
      }

      it('create sends the competency in p_tag_ids and the level in p_level', async () => {
        _cache.observations[CID] = {};
        addQuickOb(CID, ENR, 'Planned the variables first', [], 'strength', null, null, {
          competencyId: TAG1,
          level: 3,
        });
        await tick();
        var call = lastCall('create_observation');
        expect(call.payload.p_tag_ids).toEqual([TAG1]);
        expect(call.payload.p_level).toBe(3);
        expect(call.payload.p_dims).toEqual([]);
        var stored = _cache.observations[CID][ENR][0];
        expect(stored.competencyId).toBe(TAG1);
        expect(stored.level).toBe(3);
      });

      it('keeps Core Competency keys in dims beside a learning-map competency', async () => {
        _cache.observations[CID] = {};
        addQuickOb(CID, ENR, 't', ['cc:3'], null, null, null, { competencyId: TAG1 });
        await tick();
        var call = lastCall('create_observation');
        expect(call.payload.p_dims).toEqual(['cc:3']);
        expect(call.payload.p_tag_ids).toEqual([TAG1]);
        expect(call.payload.p_level).toBeNull();
      });

      it('a level outside 1-4 is not stored or sent', async () => {
        _cache.observations[CID] = {};
        addQuickOb(CID, ENR, 't', [], null, null, null, { competencyId: TAG1, level: 7 });
        await tick();
        expect(lastCall('create_observation').payload.p_level).toBeNull();
        expect(_cache.observations[CID][ENR][0].level).toBeUndefined();
      });

      it('never sends a local learning-map id the server has not seen (rule 6)', async () => {
        _cache.observations[CID] = {};
        addQuickOb(CID, ENR, 't', [], null, null, null, { competencyId: 'tag_local_123', level: 2 });
        await tick();
        var call = lastCall('create_observation');
        expect(call.payload.p_tag_ids).toEqual([]);
        expect(call.payload.p_level).toBeNull();
      });

      it('update sends the level in the patch; the competency only when it changed', async () => {
        _cache.observations[CID] = {
          [ENR]: [{ id: OB_ID, text: 't', dims: [], competencyId: TAG1, level: 2, created: '2026-10-18T15:00:00Z' }],
        };
        updateQuickOb(CID, ENR, OB_ID, { text: 'edited' });
        await tick();
        var first = lastCall('update_observation');
        expect(first.payload.p_patch.level).toBe(2);
        expect(first.payload.p_tag_ids).toBeNull();

        updateQuickOb(CID, ENR, OB_ID, { level: 4 });
        await tick();
        expect(lastCall('update_observation').payload.p_patch.level).toBe(4);

        updateQuickOb(CID, ENR, OB_ID, { competencyId: null });
        await tick();
        var cleared = lastCall('update_observation');
        expect(cleared.payload.p_tag_ids).toEqual([]);
        expect(cleared.payload.p_patch.level).toBeNull();
        expect(_cache.observations[CID][ENR][0].competencyId).toBeUndefined();
        expect(_cache.observations[CID][ENR][0].level).toBeUndefined();
      });

      it('a competency-linked observation round-trips the server', async () => {
        _cache.observations[CID] = {};
        client = makeRecordingClient({ create_observation: { data: OB_ID, error: null } });
        globalThis.getSupabase = () => client;
        addQuickOb(CID, ENR, 'Explained the process to two classmates', ['collaboration'], 'strength', null, null, {
          competencyId: TAG1,
          level: 3,
        });
        await tick();
        var create = lastCall('create_observation');

        // What the server stores and returns on the row.
        var row = {
          id: OB_ID,
          body: create.payload.p_body,
          sentiment: create.payload.p_sentiment,
          context_type: null,
          assessment_id: null,
          created_at: '2026-10-18T15:00:00Z',
          enrollment_ids: [ENR],
          tag_ids: create.payload.p_tag_ids,
          custom_tag_ids: [],
          dims: create.payload.p_dims,
          level: create.payload.p_level,
        };
        var blob = _observationsPayloadToBlob({ observations: [row] }, CID);
        expect(blob[ENR][0]).toMatchObject({
          id: OB_ID,
          text: 'Explained the process to two classmates',
          dims: ['collaboration'],
          sentiment: 'strength',
          competencyId: TAG1,
          level: 3,
        });
      });

      it('a competency with a local id is re-keyed when its tag reaches the server', () => {
        _cache.observations[CID] = {
          [ENR]: [
            { id: OB_ID, text: 't', dims: [], competencyId: 'tLOCALTAG1', level: 3, created: '2026-10-18T15:00:00Z' },
          ],
        };
        _rekey(CID, 'tag', 'tLOCALTAG1', TAG1);
        expect(getQuickObs(CID)[ENR][0].competencyId).toBe(TAG1);
        expect(getQuickObs(CID)[ENR][0].level).toBe(3);
      });

      it('a row without a level or tag loads without them', () => {
        var blob = _observationsPayloadToBlob(
          {
            observations: [
              {
                id: OB_ID,
                body: 'b',
                created_at: '2026-10-18T15:00:00Z',
                enrollment_ids: [ENR],
                dims: [],
                level: null,
              },
            ],
          },
          CID,
        );
        expect(blob[ENR][0].competencyId).toBeUndefined();
        expect(blob[ENR][0].level).toBeUndefined();
      });
    });

    describe('_persistObservationDelete', () => {
      it('calls delete_observation', async () => {
        _persistObservationDelete(CID, OB_ID);
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        var call = client.calls.find(function (c) {
          return c.name === 'delete_observation';
        });
        expect(call.payload).toEqual({ p_id: OB_ID });
      });

      it('skips on non-UUID id', () => {
        _persistObservationDelete(CID, 'legacy');
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.createObservationRich', () => {
      it('filters enrollment_ids, tag_ids, custom_tag_ids to UUIDs', async () => {
        await window.createObservationRich({
          courseId: CID,
          body: 'body',
          sentiment: 'strength',
          contextType: 'class',
          assessmentId: AID,
          enrollmentIds: [ENR, 'junk', ENR2],
          tagIds: [TAG1, 'junk'],
          customTagIds: [CTAG1],
        });
        var call = client.calls.find(function (c) {
          return c.name === 'create_observation';
        });
        expect(call.payload.p_enrollment_ids).toEqual([ENR, ENR2]);
        expect(call.payload.p_tag_ids).toEqual([TAG1]);
        expect(call.payload.p_custom_tag_ids).toEqual([CTAG1]);
      });
    });

    describe('window.updateObservationRich', () => {
      it('passes null for any joins not provided', async () => {
        await window.updateObservationRich(OB_ID, { body: 'x' }, {});
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_enrollment_ids).toBeNull();
        expect(call.payload.p_tag_ids).toBeNull();
        expect(call.payload.p_custom_tag_ids).toBeNull();
      });

      it('passes filtered UUID arrays when joins are provided', async () => {
        await window.updateObservationRich(
          OB_ID,
          {},
          {
            enrollmentIds: [ENR, 'junk'],
            tagIds: [TAG1],
            customTagIds: [],
          },
        );
        var call = client.calls.find(function (c) {
          return c.name === 'update_observation';
        });
        expect(call.payload.p_enrollment_ids).toEqual([ENR]);
        expect(call.payload.p_tag_ids).toEqual([TAG1]);
        expect(call.payload.p_custom_tag_ids).toEqual([]);
      });
    });

    describe('window.upsertObservationTemplate', () => {
      it('maps camelCase payload to snake_case RPC params', async () => {
        await window.upsertObservationTemplate(CID, {
          id: TPL_ID,
          body: 'Template body',
          defaultSentiment: 'strength',
          defaultContextType: 'class',
          displayOrder: 2,
        });
        var call = client.calls.find(function (c) {
          return c.name === 'upsert_observation_template';
        });
        expect(call.payload).toEqual({
          p_id: TPL_ID,
          p_course_id: CID,
          p_body: 'Template body',
          p_default_sentiment: 'strength',
          p_default_context_type: 'class',
          p_display_order: 2,
          p_default_dims: null,
          p_idempotency_key: expect.any(String),
        });
      });

      it('nullifies non-UUID template id (insert path)', async () => {
        await window.upsertObservationTemplate(CID, { body: 'new' });
        var call = client.calls.find(function (c) {
          return c.name === 'upsert_observation_template';
        });
        expect(call.payload.p_id).toBeNull();
      });
    });

    describe('window.deleteObservationTemplate', () => {
      it('calls delete_observation_template with the template id', async () => {
        await window.deleteObservationTemplate(TPL_ID);
        var call = client.calls.find(function (c) {
          return c.name === 'delete_observation_template';
        });
        expect(call.payload).toEqual({ p_id: TPL_ID });
      });

      it('skips on non-UUID id', async () => {
        await window.deleteObservationTemplate('legacy');
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.createCustomTag', () => {
      it('calls create_custom_tag with course id and label', async () => {
        await window.createCustomTag(CID, 'My Tag');
        var call = client.calls.find(function (c) {
          return c.name === 'create_custom_tag';
        });
        expect(call.payload).toEqual({
          p_course_id: CID,
          p_label: 'My Tag',
          p_idempotency_key: expect.any(String),
        });
      });

      it('skips on non-UUID course id', async () => {
        await window.createCustomTag('legacy', 'Tag');
        expect(client.calls).toHaveLength(0);
      });
    });
  });
});

describe('data-observations', () => {
  /**
   * Observation function tests — shared/data.js
   * Tests CRUD and filtering for quick observations.
   */

  const CID = 'test';

  beforeEach(() => {
    // Clear observation cache and localStorage
    _cache.observations[CID] = undefined;
    localStorage.clear();
  });

  describe('getStudentQuickObs', () => {
    it('returns observations sorted by created descending', () => {
      saveQuickObs(CID, {
        stu1: [
          { id: 'ob1', text: 'first', created: '2025-01-01T10:00:00Z' },
          { id: 'ob2', text: 'second', created: '2025-03-01T10:00:00Z' },
          { id: 'ob3', text: 'third', created: '2025-02-01T10:00:00Z' },
        ],
      });
      const result = getStudentQuickObs(CID, 'stu1');
      expect(result[0].id).toBe('ob2');
      expect(result[1].id).toBe('ob3');
      expect(result[2].id).toBe('ob1');
    });

    it('returns empty array for missing student', () => {
      saveQuickObs(CID, {});
      expect(getStudentQuickObs(CID, 'nobody')).toEqual([]);
    });

    it('returns empty array for course with no observations', () => {
      expect(getStudentQuickObs(CID, 'stu1')).toEqual([]);
    });
  });

  describe('getAllQuickObs', () => {
    it('flattens all students observations with studentId', () => {
      saveQuickObs(CID, {
        stu1: [{ id: 'ob1', text: 'a', created: '2025-01-01T10:00:00Z' }],
        stu2: [{ id: 'ob2', text: 'b', created: '2025-02-01T10:00:00Z' }],
      });
      const result = getAllQuickObs(CID);
      expect(result).toHaveLength(2);
      expect(result[0].studentId).toBe('stu2'); // more recent first
      expect(result[1].studentId).toBe('stu1');
    });

    it('sorts by created descending across students', () => {
      saveQuickObs(CID, {
        stu1: [{ id: 'ob1', text: 'old', created: '2025-01-01T10:00:00Z' }],
        stu2: [{ id: 'ob2', text: 'new', created: '2025-03-01T10:00:00Z' }],
      });
      const result = getAllQuickObs(CID);
      expect(result[0].text).toBe('new');
    });

    it('returns empty array for empty observations', () => {
      saveQuickObs(CID, {});
      expect(getAllQuickObs(CID)).toEqual([]);
    });
  });

  describe('addQuickOb', () => {
    it('adds observation with generated id and trimmed text', () => {
      saveQuickObs(CID, {});
      addQuickOb(CID, 'stu1', '  Good work  ', ['engagement'], 'strength', 'whole-class');
      const obs = getStudentQuickObs(CID, 'stu1');
      expect(obs).toHaveLength(1);
      expect(obs[0].text).toBe('Good work');
      expect(obs[0].id).toMatch(/^qo_/);
      expect(obs[0].dims).toEqual(['engagement']);
      expect(obs[0].sentiment).toBe('strength');
      expect(obs[0].context).toBe('whole-class');
    });

    it('stores assignmentContext when provided', () => {
      saveQuickObs(CID, {});
      addQuickOb(CID, 'stu1', 'Feedback', [], null, null, { assessmentId: 'a1' });
      const obs = getStudentQuickObs(CID, 'stu1');
      expect(obs[0].assignmentContext).toEqual({ assessmentId: 'a1' });
    });

    it('omits optional fields when not provided', () => {
      saveQuickObs(CID, {});
      addQuickOb(CID, 'stu1', 'Note', []);
      const obs = getStudentQuickObs(CID, 'stu1');
      expect(obs[0].sentiment).toBeUndefined();
      expect(obs[0].context).toBeUndefined();
      expect(obs[0].assignmentContext).toBeUndefined();
    });

    it('creates student key for first observation', () => {
      saveQuickObs(CID, {});
      addQuickOb(CID, 'newStudent', 'First note', []);
      expect(getStudentQuickObs(CID, 'newStudent')).toHaveLength(1);
    });
  });

  describe('deleteQuickOb', () => {
    it('removes observation by id', () => {
      saveQuickObs(CID, {
        stu1: [
          { id: 'ob1', text: 'keep' },
          { id: 'ob2', text: 'delete' },
        ],
      });
      deleteQuickOb(CID, 'stu1', 'ob2');
      const obs = getStudentQuickObs(CID, 'stu1');
      expect(obs).toHaveLength(1);
      expect(obs[0].id).toBe('ob1');
    });

    it('no-op if student has no observations', () => {
      saveQuickObs(CID, {});
      expect(() => deleteQuickOb(CID, 'nobody', 'ob1')).not.toThrow();
    });
  });

  describe('getQuickObsByDim', () => {
    it('filters by dimension', () => {
      saveQuickObs(CID, {
        stu1: [
          { id: 'ob1', text: 'a', dims: ['engagement', 'curiosity'], created: '2025-01-01T00:00:00Z' },
          { id: 'ob2', text: 'b', dims: ['collaboration'], created: '2025-01-02T00:00:00Z' },
        ],
      });
      const result = getQuickObsByDim(CID, 'stu1', 'engagement');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ob1');
    });

    it('returns empty for non-matching dimension', () => {
      saveQuickObs(CID, {
        stu1: [{ id: 'ob1', dims: ['engagement'], created: '2025-01-01T00:00:00Z' }],
      });
      expect(getQuickObsByDim(CID, 'stu1', 'resilience')).toEqual([]);
    });
  });

  describe('getAssignmentObs', () => {
    it('filters by assignment context', () => {
      saveQuickObs(CID, {
        stu1: [
          { id: 'ob1', text: 'feedback', assignmentContext: { assessmentId: 'a1' }, created: '2025-01-01T00:00:00Z' },
          { id: 'ob2', text: 'general', created: '2025-01-02T00:00:00Z' },
        ],
      });
      expect(getAssignmentObs(CID, 'stu1', 'a1')).toHaveLength(1);
      expect(getAssignmentObs(CID, 'stu1', 'a2')).toHaveLength(0);
    });
  });

  describe('hasAssignmentFeedback', () => {
    it('returns true when feedback exists', () => {
      saveQuickObs(CID, {
        stu1: [{ id: 'ob1', assignmentContext: { assessmentId: 'a1' }, created: '2025-01-01T00:00:00Z' }],
      });
      expect(hasAssignmentFeedback(CID, 'stu1', 'a1')).toBe(true);
    });

    it('returns false when no feedback exists', () => {
      saveQuickObs(CID, { stu1: [{ id: 'ob1', text: 'general', created: '2025-01-01T00:00:00Z' }] });
      expect(hasAssignmentFeedback(CID, 'stu1', 'a1')).toBe(false);
    });
  });

  describe('loading observations from the server', () => {
    const AID = '55555555-5555-5555-5555-555555555555';

    afterEach(() => {
      delete _cache.assessments[CID];
    });

    it('restores the tags on each observation row', () => {
      const blob = _observationsPayloadToBlob({
        observations: [
          {
            id: 'ob1',
            body: 'Helped a partner',
            enrollment_ids: ['stu1', 'stu2'],
            dims: ['collaboration', 'cc:5', 'tag:Lab safety'],
            created_at: '2026-10-18T10:00:00Z',
          },
        ],
      });
      expect(blob.stu1[0].dims).toEqual(['collaboration', 'cc:5', 'tag:Lab safety']);
      expect(blob.stu2[0].dims).toEqual(['collaboration', 'cc:5', 'tag:Lab safety']);
    });

    it('gives an empty tag list to rows saved before tags were stored', () => {
      const blob = _observationsPayloadToBlob({
        observations: [{ id: 'ob1', body: 'x', enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' }],
      });
      expect(blob.stu1[0].dims).toEqual([]);
    });

    it('fills in the assessment title from the course assessments', () => {
      _cache.assessments[CID] = [{ id: AID, title: 'Cell model' }];
      const blob = _observationsPayloadToBlob(
        {
          observations: [
            { id: 'ob1', body: 'x', assessment_id: AID, enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' },
          ],
        },
        CID,
      );
      expect(blob.stu1[0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: 'Cell model' });
    });

    it('leaves the title empty when the assessment is not in the course', () => {
      _cache.assessments[CID] = [];
      const blob = _observationsPayloadToBlob(
        {
          observations: [
            { id: 'ob1', body: 'x', assessment_id: AID, enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' },
          ],
        },
        CID,
      );
      expect(blob.stu1[0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: '' });
    });

    it('the bundle load restores tags and the assessment title', () => {
      _bundleToCache(CID, {
        gradebook: {
          course: { id: CID },
          students: [],
          assessments: [{ id: AID, title: 'Cell model', score_mode: 'proficiency' }],
          categories: [],
          modules: [],
        },
        observations: {
          observations: [
            {
              id: 'ob1',
              body: 'Careful drawing',
              assessment_id: AID,
              enrollment_ids: ['stu1'],
              dims: ['engagement'],
              created_at: '2026-10-18T10:00:00Z',
            },
          ],
          total: 1,
        },
      });
      const ob = getStudentQuickObs(CID, 'stu1')[0];
      expect(ob.dims).toEqual(['engagement']);
      expect(ob.assignmentContext.assessmentTitle).toBe('Cell model');
    });
  });

  describe('observation dates use the local day of created_at', () => {
    // A row written after 5 pm PDT has created_at on the next UTC day. A
    // reload must keep it on the day it was written. Date reads as PDT here
    // whatever zone the runner is in.
    beforeEach(() => {
      vi.stubGlobal('Date', PdtDate);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('hydrates a 6:30 pm PDT row (01:30 UTC next day) to the day it was written', () => {
      const blob = _observationsPayloadToBlob({
        observations: [
          {
            id: 'ob1',
            body: 'Evening note',
            enrollment_ids: ['stu1'],
            created_at: '2026-10-19T01:30:00Z',
            observed_at: '2026-10-19T01:30:00Z',
          },
        ],
      });
      expect(blob.stu1[0].date).toBe('2026-10-18');
    });

    it('hydrates a 23:30 UTC row to the Pacific day it was written', () => {
      const blob = _observationsPayloadToBlob({
        observations: [
          {
            id: 'ob1',
            body: 'Evening note',
            enrollment_ids: ['stu1'],
            created_at: '2026-10-18T23:30:00Z',
            observed_at: '2026-10-18T23:30:00Z',
          },
        ],
      });
      expect(blob.stu1[0].date).toBe('2026-10-18');
      expect(blob.stu1[0].created).toBe('2026-10-18T23:30:00Z');
    });

    it('dates profile recent_observations by the local day too', () => {
      const obs = _normalizeProfileObservations([
        { id: 'ob1', text: 'Evening note', created_at: '2026-10-19T01:30:00Z', observed_at: '2026-10-19T01:30:00Z' },
      ]);
      expect(obs[0].date).toBe('2026-10-18');
    });

    it('keeps a date-only value as given', () => {
      expect(_localDayOf('2026-10-18')).toBe('2026-10-18');
      expect(
        _normalizeProfileObservations([{ text: 'x', date: '2026-10-19', created_at: '2026-10-18T23:30:00Z' }])[0].date,
      ).toBe('2026-10-19');
    });

    it('leaves assessment dates untouched', () => {
      expect(_dateOnly('2026-10-18')).toBe('2026-10-18');
    });
  });

  describe('observation dates in the runner zone', () => {
    it('match the local day of created_at', () => {
      const iso = '2026-10-19T01:30:00Z';
      const blob = _observationsPayloadToBlob({
        observations: [{ id: 'ob1', body: 'x', enrollment_ids: ['stu1'], created_at: iso }],
      });
      expect(blob.stu1[0].date).toBe(runnerLocalDay(iso));
    });
  });
});

describe('data-own-change-echo', () => {
  /**
   * Realtime reports this page's own changes too (write-path audit, finding 15).
   *
   * Every change to a class bumps its version, and the tab that made the
   * change hears about it like every other device. A version the database
   * recorded with this page's client id, one past the version this page has,
   * is this page's own change: the page already holds it, so it doesn't
   * download the class again. Anything else still reloads.
   */

  const CID = 'e0000000-0000-4000-8000-000000000001';

  describe('own-change echoes', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var originalHandle;
    var originalClientId;
    var onChange;
    var refreshes;

    beforeEach(async () => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      originalHandle = globalThis._handleExternalCourseUpdate;
      originalClientId = window.__fvClientId;
      _useSupabase = true;
      globalThis.__FV_CLASS_BUNDLE = true;
      window.__fvClientId = 'tab-me';
      _echoNeedsReload = false;
      refreshes = [];
      globalThis._handleExternalCourseUpdate = function (cid, kind) {
        refreshes.push(kind);
        return Promise.resolve();
      };
      var query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      globalThis.getSupabase = function () {
        return {
          from() {
            return query;
          },
          channel() {
            var channel = {
              on(type, filter, handler) {
                onChange = handler;
                return channel;
              },
              subscribe() {
                return channel;
              },
            };
            return channel;
          },
          removeChannel() {},
          rpc() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      };
      _unsubscribeCourseSyncCursor();
      await _subscribeCourseSyncCursor(CID);
      _classVersion[CID] = 5;
    });

    afterEach(() => {
      _unsubscribeCourseSyncCursor();
      globalThis.getSupabase = originalGetSupabase;
      globalThis._handleExternalCourseUpdate = originalHandle;
      _useSupabase = originalUseSupabase;
      window.__fvClientId = originalClientId;
      globalThis.__FV_CLASS_BUNDLE = false;
      _echoNeedsReload = false;
      delete _classVersion[CID];
    });

    function change(version, lastClient) {
      onChange({ new: { course_id: CID, version: version, last_client: lastClient } });
    }

    it("doesn't reload for this page's own score", () => {
      _noteOutboxSend({ endpoint: 'upsert_tag_score', fromThisTab: true });
      change(6, 'tab-me');
      change(7, 'tab-me');
      expect(refreshes).toEqual([]);
      expect(_classVersion[CID]).toBe(7);
    });

    it('reloads for a change from another device', () => {
      change(6, 'tab-other');
      expect(refreshes).toEqual(['gradebook']);
      expect(_classVersion[CID]).toBe(5);
    });

    it('reloads when a version was missed in between', () => {
      change(7, 'tab-me');
      expect(refreshes).toEqual(['gradebook']);
    });

    it('reloads for a change with no client id (an older client or the server)', () => {
      change(6, null);
      expect(refreshes).toEqual(['gradebook']);
    });

    it('reloads after a create, which the server fills in', () => {
      _noteOutboxSend({ endpoint: 'create_assessment', fromThisTab: true });
      change(6, 'tab-me');
      expect(refreshes).toEqual(['gradebook']);
    });

    it('reloads for a write this tab sent for another tab', () => {
      _noteOutboxSend({ endpoint: 'upsert_tag_score', fromThisTab: false });
      change(6, 'tab-me');
      expect(refreshes).toEqual(['gradebook']);
    });
  });
});

describe('data-pending-syncs', () => {
  describe('pending sync drain', () => {
    it('waitForPendingSyncs waits for tracked writes without a default timeout', async () => {
      let release;
      _trackPendingSync(
        new Promise(resolve => {
          release = resolve;
        }),
      );

      let resolved = false;
      const wait = waitForPendingSyncs().then(() => {
        resolved = true;
      });

      await new Promise(resolve => setTimeout(resolve, 25));
      expect(resolved).toBe(false);

      release();
      await wait;
      expect(resolved).toBe(true);
      expect(getSyncStatus().pending).toBe(0);
    });
  });
});

describe('data-questionnaires-v2-dispatch', () => {
  /**
   * Student questionnaire server calls in shared/data.js
   * (migrations/20261025_questionnaires_tables_and_functions.sql):
   *
   *   listQuestionnaireTemplates / listCourseQuestionnaires / listCourseResponses
   *   upsertQuestionnaire / setQuestionnaireOn / deleteQuestionnaire
   *   issueAccessCodes
   *
   * Each sends the RPC the migration defines with the parameters it expects,
   * every write carries an idempotency key, lists come back as arrays, and
   * slip codes come from teacher-cards (plan S3-S1), never through the outbox.
   */

  const CID = '11111111-1111-4111-8111-111111111111';
  const QID = '22222222-2222-4222-8222-222222222222';
  const ENR = '33333333-3333-4333-8333-333333333333';

  function makeRecordingClient(answers) {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        var data = answers && Object.prototype.hasOwnProperty.call(answers, name) ? answers[name] : null;
        return Promise.resolve({ data: data, error: null });
      },
    };
  }

  describe('questionnaires v2 dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    function use(answers) {
      client = makeRecordingClient(answers);
      globalThis.getSupabase = () => client;
    }

    beforeEach(() => {
      localStorage.clear();
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      use();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('upsertQuestionnaire sends every field, a key, and null questions to copy a template', async () => {
      await window.v2.upsertQuestionnaire({
        courseId: CID,
        kind: 'core_reflection',
        title: '  November Reflection ',
        templateId: 'core-8-1',
        reportPeriod: '1',
        opensOn: '2026-11-03',
        closesOn: '2026-11-14',
      });
      var call = client.calls.find(c => c.name === 'upsert_questionnaire');
      expect(call.payload).toMatchObject({
        p_course_id: CID,
        p_kind: 'core_reflection',
        p_title: 'November Reflection',
        p_template_id: 'core-8-1',
        p_report_period: 1,
        p_opens_on: '2026-11-03',
        p_closes_on: '2026-11-14',
        p_is_on: true,
        p_questions: null,
        p_id: null,
      });
      expect(call.payload.p_idempotency_key).toBeTruthy();
    });

    it('setQuestionnaireOn and deleteQuestionnaire carry keys; a local id goes nowhere', async () => {
      await window.v2.setQuestionnaireOn(QID, false);
      await window.v2.deleteQuestionnaire(QID);
      await window.v2.deleteQuestionnaire('local-id');
      expect(client.calls.map(c => c.name)).toEqual(['set_questionnaire_on', 'delete_questionnaire']);
      expect(client.calls[0].payload).toMatchObject({ p_id: QID, p_is_on: false });
      client.calls.forEach(c => expect(c.payload.p_idempotency_key).toBeTruthy());
    });

    it('lists come back as arrays and responses as an object', async () => {
      use({
        list_questionnaire_templates: [{ id: 'about-me' }],
        list_course_questionnaires: [{ id: QID, questions: [] }],
        list_course_responses: { [QID]: { [ENR]: [] } },
      });
      expect((await window.v2.listQuestionnaireTemplates()).data).toEqual([{ id: 'about-me' }]);
      expect((await window.v2.listCourseQuestionnaires(CID)).data).toEqual([{ id: QID, questions: [] }]);
      expect((await window.v2.listCourseResponses(CID)).data).toEqual({ [QID]: { [ENR]: [] } });
    });

    // Since plan S3-S1 slips are made by teacher-cards: the database keeps only their tags.
    it('issueAccessCodes asks teacher-cards for the named students, with only server ids, and nothing is queued', async () => {
      const fake = slipsFetch({ passwords: { [ENR]: '4821' } });
      globalThis.getSupabase = () => signedIn(client);
      try {
        var res = await window.v2.issueAccessCodes(QID, [ENR, 'local-id']);
        expect(res.data).toEqual([{ enrollment_id: ENR, code: 'K7M-4QX', password: '4821' }]);
        expect(fake.bodies).toHaveLength(1);
        expect(fake.bodies[0].url).toContain('/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1');
        expect(fake.bodies[0].body).toMatchObject({
          route: 'slips',
          kind: 'questionnaire',
          id: QID,
          enrollment_ids: [ENR],
        });
        expect(fake.bodies[0].body.request_id).toBeTruthy();
        expect(client.calls).toEqual([]);
        var queued = localStorage.getItem('fv-outbox') || '';
        expect(queued).not.toContain('K7M');
      } finally {
        fake.restore();
      }
    });

    it('issueAccessCodes asks for every student when none are named, and asks again after a lost reply', async () => {
      const fake = slipsFetch({ roster: [ENR], replayFirst: true });
      globalThis.getSupabase = () => signedIn(client);
      try {
        var res = await window.v2.issueAccessCodes(QID);
        expect(fake.bodies[0].body.enrollment_ids).toBeNull();
        expect(fake.bodies).toHaveLength(2);
        expect(fake.bodies[1].body.request_id).not.toBe(fake.bodies[0].body.request_id);
        expect(res.data).toEqual([{ enrollment_id: ENR, code: 'K7M-4QX' }]);
      } finally {
        fake.restore();
      }
    });
  });
});

describe('data-remove-restore-competency', () => {
  /**
   * Removing a competency and putting it back (Re-link's "add back"). From the
   * Nov 3 sweep: after Remove the class still counted the removed competency,
   * and Re-link put QP1 back at the end of its folder (QP2, QP3, QP1).
   */

  const CID = 'course-remove-restore';

  function sec(id) {
    return {
      id,
      name: id,
      subject: 'SCI9',
      groupId: 'g1',
      tags: [{ id, code: id, label: id, subject: 'SCI9' }],
    };
  }

  beforeEach(() => {
    localStorage.clear();
    _cache.learningMaps[CID] = {
      _flatVersion: 2,
      _customized: true,
      subjects: [{ id: 'SCI9', name: 'Science 9' }],
      competencyGroups: [{ id: 'g1', name: 'Questioning and Predicting', sortOrder: 0 }],
      sections: [sec('QP1'), sec('QP2'), sec('QP3'), sec('PC1')],
    };
  });

  const codes = () => getSections(CID).map(s => s.id);

  describe('removeCompetencies', () => {
    it('drops the competency from the counts at once', () => {
      expect(getAllTags(CID)).toHaveLength(4);
      removeCompetencies(CID, ['QP1']);
      expect(getAllTags(CID)).toHaveLength(3);
      expect(getSectionForTag(CID, 'QP1')).toBeUndefined();
    });
  });

  describe('restoreCompetency', () => {
    it('puts a competency back where it was', () => {
      removeCompetencies(CID, ['QP1']);
      expect(codes()).toEqual(['QP2', 'QP3', 'PC1']);
      restoreCompetency(CID, 'QP1');
      expect(codes()).toEqual(['QP1', 'QP2', 'QP3', 'PC1']);
      expect(getAllTags(CID)).toHaveLength(4);
    });

    it('puts several back in their places, whatever order they come back in', () => {
      removeCompetencies(CID, ['QP2', 'QP3']);
      expect(codes()).toEqual(['QP1', 'PC1']);
      restoreCompetency(CID, 'QP3');
      restoreCompetency(CID, 'QP2');
      expect(codes()).toEqual(['QP1', 'QP2', 'QP3', 'PC1']);
    });

    it('puts one removed before places were kept at the end', () => {
      removeCompetencies(CID, ['QP1']);
      const list = getRemovedSections(CID).map(r => ({ section: r.section, removedAt: r.removedAt }));
      localStorage.setItem('gb-removed-sections-' + CID, JSON.stringify(list));
      restoreCompetency(CID, 'QP1');
      expect(codes()).toEqual(['QP2', 'QP3', 'PC1', 'QP1']);
    });
  });
});

describe('data-report-forms-v2-dispatch', () => {
  /**
   * Report forms server calls in shared/data.js (migrations/20261020_*):
   *
   *   saveReportTemplate / listReportTemplates / deleteReportTemplate
   *   createReportIssue / listReportIssues / getReportIssue / deleteReportIssue
   *   upsertGuardian / deleteGuardian / listCourseGuardians
   *
   * Each sends the RPC the migration defines with the parameters it expects,
   * every write carries an idempotency key, lists come back as arrays, and
   * an Issue goes straight to the server (its HTML can be bigger than the
   * outbox allows) with only server-id students.
   */

  const CID = '11111111-1111-4111-8111-111111111111';
  const TID = '22222222-2222-4222-8222-222222222222';
  const ENR = '33333333-3333-4333-8333-333333333333';
  const STU = '44444444-4444-4444-8444-444444444444';
  const GID = '55555555-5555-4555-8555-555555555555';
  const FORM = { v: 3, type: 'standard', front: [{ block: 'header' }], back: [] };

  function makeRecordingClient(answers) {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        var data = answers && Object.prototype.hasOwnProperty.call(answers, name) ? answers[name] : null;
        return Promise.resolve({ data: data, error: null });
      },
    };
  }

  describe('report forms v2 dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    function use(answers) {
      client = makeRecordingClient(answers);
      globalThis.getSupabase = () => client;
    }

    beforeEach(() => {
      localStorage.clear();
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      use();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('library', () => {
      it('saveReportTemplate trims the name, sends the form and a key, and no id for a new form', async () => {
        await window.v2.saveReportTemplate({ name: '  Science 8 form ', form: FORM });
        expect(client.calls[0].name).toBe('save_report_template');
        expect(client.calls[0].payload).toMatchObject({ p_name: 'Science 8 form', p_form: FORM, p_id: null });
        expect(_isUuid(client.calls[0].payload.p_idempotency_key)).toBe(true);
      });

      it('saveReportTemplate passes a server id through to rename', async () => {
        await window.v2.saveReportTemplate({ id: TID, name: 'Renamed', form: FORM });
        expect(client.calls[0].payload.p_id).toBe(TID);
      });

      it('a list read with no rows is an empty array, and a failed one is null', async () => {
        use({ list_report_templates: [] });
        expect((await window.v2.listReportTemplates()).data).toEqual([]);
        client = {
          calls: [],
          rpc() {
            return Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });
          },
        };
        globalThis.getSupabase = () => client;
        var res = await window.v2.listReportTemplates();
        expect(res.data).toBeNull();
        expect(res.error.message).toMatch(/network/);
      });

      it('listReportTemplates returns the rows as an array', async () => {
        use({ list_report_templates: [{ id: TID, name: 'A', form: FORM }] });
        var res = await window.v2.listReportTemplates();
        expect(client.calls[0]).toEqual({ name: 'list_report_templates', payload: {} });
        expect(res.data).toEqual([{ id: TID, name: 'A', form: FORM }]);
        expect(res.error).toBeNull();
      });

      it('deleteReportTemplate sends the id with a key and skips a non-server id', async () => {
        await window.v2.deleteReportTemplate(TID);
        expect(client.calls[0].name).toBe('delete_report_template');
        expect(client.calls[0].payload.p_id).toBe(TID);
        expect(_isUuid(client.calls[0].payload.p_idempotency_key)).toBe(true);
        await window.v2.deleteReportTemplate('tpl-local');
        expect(client.calls).toHaveLength(1);
      });
    });

    describe('issued copies', () => {
      it('createReportIssue sends the class, term, paper, form and server-id students with a key', async () => {
        use({ create_report_issue: { id: TID, issued_at: '2026-10-20T00:00:00Z', student_count: 1 } });
        var res = await window.v2.createReportIssue({
          courseId: CID,
          term: '2',
          termLabel: 'Term 1',
          paper: 'legal',
          form: FORM,
          students: [
            { enrollmentId: ENR, sheets: 2, hash: 'h1', html: '<div class="report-sheet">A</div>' },
            { enrollmentId: 's123local', sheets: 1, hash: 'h2', html: 'pending' },
          ],
        });
        expect(client.calls).toHaveLength(1);
        expect(client.calls[0].name).toBe('create_report_issue');
        expect(client.calls[0].payload).toMatchObject({
          p_course_id: CID,
          p_term: 2,
          p_term_label: 'Term 1',
          p_paper: 'legal',
          p_form: FORM,
          p_students: [{ enrollment_id: ENR, sheets: 2, hash: 'h1', html: '<div class="report-sheet">A</div>' }],
        });
        expect(_isUuid(client.calls[0].payload.p_idempotency_key)).toBe(true);
        expect(res.data).toEqual({ id: TID, issued_at: '2026-10-20T00:00:00Z', student_count: 1 });
      });

      it('createReportIssue defaults the paper to letter and clamps sheets', async () => {
        await window.v2.createReportIssue({
          courseId: CID,
          term: 1,
          students: [{ enrollmentId: ENR, sheets: 99, hash: 'h', html: 'x' }],
        });
        expect(client.calls[0].payload.p_paper).toBe('letter');
        expect(client.calls[0].payload.p_form).toBeNull();
        expect(client.calls[0].payload.p_students[0].sheets).toBe(20);
      });

      it('createReportIssue sends nothing when no student has a server id', async () => {
        var res = await window.v2.createReportIssue({
          courseId: CID,
          term: 1,
          students: [{ enrollmentId: 's123local', sheets: 1, hash: 'h', html: 'x' }],
        });
        expect(client.calls).toHaveLength(0);
        expect(res.error.blocked).toBe(true);
      });

      it('listReportIssues filters by term only when one is given', async () => {
        use({ list_report_issues: [{ id: TID, term: 2, hashes: {} }] });
        var res = await window.v2.listReportIssues(CID, 2);
        expect(client.calls[0]).toEqual({ name: 'list_report_issues', payload: { p_course_id: CID, p_term: 2 } });
        expect(res.data).toEqual([{ id: TID, term: 2, hashes: {} }]);
        await window.v2.listReportIssues(CID);
        expect(client.calls[1].payload).toEqual({ p_course_id: CID });
      });

      it('getReportIssue returns the issue object', async () => {
        use({ get_report_issue: { id: TID, students: [{ enrollment_id: ENR, html: 'x' }] } });
        var res = await window.v2.getReportIssue(TID);
        expect(client.calls[0]).toEqual({ name: 'get_report_issue', payload: { p_issue_id: TID } });
        expect(res.data.students[0].enrollment_id).toBe(ENR);
      });

      it('deleteReportIssue sends the id with a key', async () => {
        await window.v2.deleteReportIssue(TID);
        expect(client.calls[0].name).toBe('delete_report_issue');
        expect(client.calls[0].payload.p_issue_id).toBe(TID);
        expect(_isUuid(client.calls[0].payload.p_idempotency_key)).toBe(true);
      });
    });

    describe('guardians', () => {
      it('upsertGuardian sends the fields and consent only as a pair', async () => {
        await window.v2.upsertGuardian({
          studentId: STU,
          name: ' Amara Adeyemi ',
          relationship: 'mother',
          email: 'a@example.com',
          consentAt: '2026-10-01T00:00:00Z',
        });
        expect(client.calls[0].name).toBe('upsert_guardian');
        expect(client.calls[0].payload).toMatchObject({
          p_student_id: STU,
          p_name: 'Amara Adeyemi',
          p_relationship: 'mother',
          p_email: 'a@example.com',
          p_phone: null,
          p_language: 'en',
          p_consent_at: null,
          p_consent_source: null,
          p_id: null,
        });
        expect(_isUuid(client.calls[0].payload.p_idempotency_key)).toBe(true);

        await window.v2.upsertGuardian({
          id: GID,
          studentId: STU,
          name: 'Amara Adeyemi',
          language: 'fr',
          consentAt: '2026-10-01T00:00:00Z',
          consentSource: 'form',
        });
        expect(client.calls[1].payload).toMatchObject({
          p_id: GID,
          p_language: 'fr',
          p_consent_at: '2026-10-01T00:00:00Z',
          p_consent_source: 'form',
        });
      });

      it('deleteGuardian and listCourseGuardians call their RPCs', async () => {
        use({ list_course_guardians: [{ id: GID, enrollment_id: ENR }] });
        await window.v2.deleteGuardian(GID);
        expect(client.calls[0].name).toBe('delete_guardian');
        expect(client.calls[0].payload.p_id).toBe(GID);
        var res = await window.v2.listCourseGuardians(CID);
        expect(client.calls[1]).toEqual({ name: 'list_course_guardians', payload: { p_course_id: CID } });
        expect(res.data).toEqual([{ id: GID, enrollment_id: ENR }]);
      });
    });

    it('every write RPC is registered as idempotent', () => {
      [
        'save_report_template',
        'delete_report_template',
        'create_report_issue',
        'delete_report_issue',
        'upsert_guardian',
        'delete_guardian',
      ].forEach(function (name) {
        expect(FV_IDEMPOTENT_RPCS[name], name).toBe(true);
      });
    });

    it('Demo Mode sends nothing', async () => {
      globalThis.isDemoMode = () => true;
      await window.v2.saveReportTemplate({ name: 'X', form: FORM });
      await window.v2.createReportIssue({ courseId: CID, term: 1, students: [{ enrollmentId: ENR, html: 'x' }] });
      var res = await window.v2.listReportTemplates();
      expect(client.calls).toHaveLength(0);
      expect(res.data).toBeNull();
      delete globalThis.isDemoMode;
    });
  });
});

describe('data-reportconfig-prefs-teacher-v2-dispatch', () => {
  /**
   * v2 ReportConfig + TeacherPreference + teacher-lifecycle dispatch tests
   * shared/data.js (Phase 4.8)
   *
   * Covers window.v2 helpers:
   *   applyReportPreset       → apply_report_preset
   *   saveReportConfig        → save_report_config (nulls preset when omitted)
   *   toggleReportBlock       → toggle_report_block (boolean coerce)
   *   saveConfig              → save_teacher_preferences (local keys mapped to v2 patch)
   *   saveTeacherPreferences  → save_teacher_preferences (jsonb patch)
   *   softDeleteTeacher       → soft_delete_teacher
   *   restoreTeacher          → restore_teacher
   *   importRosterCsv         → import_roster_csv (v2-namespace alias)
   *   importJsonRestore       → import_json_restore
   */

  const CID = '11111111-1111-1111-1111-111111111111';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('v2 report-config / preferences / teacher-lifecycle dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('ReportConfig', () => {
      it('applyReportPreset calls apply_report_preset', async () => {
        await window.v2.applyReportPreset(CID, 'standard');
        expect(client.calls[0]).toEqual({
          name: 'apply_report_preset',
          payload: { p_course_id: CID, p_preset: 'standard' },
        });
      });

      it('saveReportConfig defaults preset to null (server→custom)', async () => {
        await window.v2.saveReportConfig(CID, { headerBlock: true });
        expect(client.calls[0]).toEqual({
          name: 'save_report_config',
          payload: { p_course_id: CID, p_blocks_config: { headerBlock: true }, p_preset: null },
        });
      });

      it('saveReportConfig passes explicit preset through', async () => {
        await window.v2.saveReportConfig(CID, {}, 'custom');
        expect(client.calls[0].payload.p_preset).toBe('custom');
      });

      it('toggleReportBlock coerces enabled to boolean', async () => {
        await window.v2.toggleReportBlock(CID, 'strengths', 1);
        expect(client.calls[0]).toEqual({
          name: 'toggle_report_block',
          payload: { p_course_id: CID, p_block_key: 'strengths', p_enabled: true },
        });
      });
    });

    describe('TeacherPreferences', () => {
      it('saveConfig maps local config keys to the v2 preference patch', () => {
        saveConfig({
          activeCourse: CID,
          viewMode: 'dashboard',
          mobileViewMode: 'cards',
          mobileSortMode: 'alpha',
          cardWidgetConfig: { order: ['hero'], disabled: [] },
          displayName: 'Ignored Locally',
        });

        expect(client.calls[0]).toEqual({
          name: 'save_teacher_preferences',
          payload: {
            p_patch: {
              active_course_id: CID,
              view_mode: 'dashboard',
              mobile_view_mode: 'cards',
              mobile_sort_mode: 'alpha',
              card_widget_config: { order: ['hero'], disabled: [] },
            },
          },
        });
      });

      it('passes jsonb patch to save_teacher_preferences', async () => {
        await window.v2.saveTeacherPreferences({ view_mode: 'classic', active_course_id: CID });
        expect(client.calls[0]).toEqual({
          name: 'save_teacher_preferences',
          payload: { p_patch: { view_mode: 'classic', active_course_id: CID } },
        });
      });

      it('coerces null/undefined patch to empty object', async () => {
        await window.v2.saveTeacherPreferences();
        expect(client.calls[0].payload.p_patch).toEqual({});
      });
    });

    describe('teacher-lifecycle', () => {
      it('softDeleteTeacher calls soft_delete_teacher with no params', async () => {
        await window.v2.softDeleteTeacher();
        expect(client.calls[0]).toEqual({ name: 'soft_delete_teacher', payload: {} });
      });

      it('restoreTeacher calls restore_teacher with no params', async () => {
        await window.v2.restoreTeacher();
        expect(client.calls[0]).toEqual({ name: 'restore_teacher', payload: {} });
      });
    });

    describe('imports (Phase 4.9 surface)', () => {
      it('v2.importRosterCsv calls import_roster_csv', async () => {
        await window.v2.importRosterCsv(CID, [{ first_name: 'A' }]);
        expect(client.calls[0]).toEqual({
          name: 'import_roster_csv',
          payload: { p_course_id: CID, p_rows: [{ first_name: 'A' }], p_idempotency_key: expect.any(String) },
        });
      });

      it('v2.importJsonRestore wraps payload in p_payload', async () => {
        var pl = { courses: [{ id: CID }] };
        await window.v2.importJsonRestore(pl);
        expect(client.calls[0]).toEqual({
          name: 'import_json_restore',
          payload: { p_payload: pl, p_idempotency_key: expect.any(String) },
        });
      });

      it('imports default to empty payload / rows when missing', async () => {
        await window.v2.importRosterCsv(CID);
        await window.v2.importJsonRestore();
        expect(client.calls[0].payload.p_rows).toEqual([]);
        expect(client.calls[1].payload.p_payload).toEqual({});
      });
    });
  });
});

describe('data-rubric-checks', () => {
  /**
   * Advanced Rubric checkboxes in the data layer (shared/data.js,
   * migrations/20261022_advanced_rubric_checks.sql).
   *
   *   rubric.style and criterion.checks in the rubric cache, from the bundle
   *   and from the table reads; the upsert_rubric payload; the ticks
   *   (getRubricCheckIds / setRubricCheck) and their set_rubric_check write;
   *   re-keying a checkbox created under a local id; copies carrying checks.
   */

  const CID = 'c0000000-0000-4000-8000-000000000001';
  const E1 = 'c0000000-0000-4000-8000-000000000021';
  const A1 = 'c0000000-0000-4000-8000-000000000031';
  const R1 = 'c0000000-0000-4000-8000-000000000071';
  const C1 = 'c0000000-0000-4000-8000-000000000072';
  const K1 = 'c0000000-0000-4000-8000-000000000081';
  const K2 = 'c0000000-0000-4000-8000-000000000082';
  const K3 = 'c0000000-0000-4000-8000-000000000083';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const rubricRow = { id: R1, name: 'Lab Skills', created_at: '2026-09-01T00:00:00Z', style: 'advanced' };
  const criterionRow = {
    id: C1,
    rubric_id: R1,
    name: 'Safety',
    level_4_descriptor: 'Leads',
    level_3_descriptor: 'Follows every step',
    level_2_descriptor: 'Needs reminders',
    level_1_descriptor: 'Needs many reminders',
    level_4_value: 4,
    level_3_value: 3,
    level_2_value: 2,
    level_1_value: 1,
    weight: 1,
    display_order: 0,
  };
  // Out of order on purpose: the cache sorts by display_order within a level.
  const checkRows = [
    { id: K2, criterion_id: C1, level: 3, label: 'Cleans the station', display_order: 1 },
    { id: K3, criterion_id: C1, level: 4, label: 'Reminds others', display_order: 0 },
    { id: K1, criterion_id: C1, level: 3, label: 'Goggles on', display_order: 0 },
  ];

  describe('rubric cache: style and checks', () => {
    it('reads checks per criterion in level display order and the rubric style', () => {
      var rubrics = _canonicalRubricRowsToCache([rubricRow], [criterionRow], [], checkRows);
      expect(rubrics).toHaveLength(1);
      expect(rubrics[0].style).toBe('advanced');
      expect(rubrics[0].criteria[0].checks).toEqual([
        { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
        { id: K3, level: 4, label: 'Reminds others', displayOrder: 0 },
        { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
      ]);
    });

    it('treats a rubric row without style, or with checks left out, as Standard with no checks', () => {
      var rubrics = _canonicalRubricRowsToCache(
        [{ id: R1, name: 'Old', created_at: '2026-09-01T00:00:00Z' }],
        [criterionRow],
        [],
      );
      expect(rubrics[0].style).toBe('standard');
      expect(rubrics[0].criteria[0].checks).toEqual([]);
      expect(rubricStyle({ style: 'advanced' })).toBe('advanced');
      expect(rubricStyle({ style: 'odd' })).toBe('standard');
      expect(rubricStyle(null)).toBe('standard');
    });

    it('sends checks with their order within the level, ids only when the server knows them', () => {
      var payload = _rubricCriteriaPayload({
        criteria: [
          {
            id: C1,
            name: 'Safety',
            levels: {},
            checks: [
              { id: K1, level: 3, label: 'Goggles on' },
              { id: 'ck-local1', level: 4, label: 'Reminds others' },
              { id: K2, level: 3, label: 'Cleans the station' },
              { id: 'ck-bad', level: 9, label: 'Dropped' },
            ],
          },
        ],
      });
      expect(payload[0].checks).toEqual([
        { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
        { level: 4, label: 'Reminds others', displayOrder: 0 },
        { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
      ]);
      // A Standard rubric sends an empty list.
      expect(_rubricCriteriaPayload({ criteria: [{ id: C1, name: 'Plain', levels: {} }] })[0].checks).toEqual([]);
    });

    it('counts a changed style or checkbox as a change to save', () => {
      var a = {
        id: R1,
        name: 'Lab',
        style: 'standard',
        criteria: [{ id: C1, name: 'Safety', levels: {}, checks: [] }],
      };
      var b = structuredClone(a);
      b.style = 'advanced';
      expect(_rubricSignature(a)).not.toBe(_rubricSignature(b));
      var c = structuredClone(a);
      c.criteria[0].checks = [{ id: K1, level: 3, label: 'Goggles on' }];
      expect(_rubricSignature(a)).not.toBe(_rubricSignature(c));
    });
  });

  describe('upsert_rubric payload', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('carries p_style and each criterion’s checks', async () => {
      await window.v2.upsertRubric({
        id: R1,
        courseId: CID,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: C1,
            name: 'Safety',
            linkedTagIds: [],
            checks: [
              { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
              { level: 3, label: 'Cleans the station', displayOrder: 1 },
            ],
          },
        ],
      });
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_rubric';
      });
      expect(call).toBeDefined();
      expect(call.payload.p_style).toBe('advanced');
      expect(call.payload.p_criteria[0].checks).toEqual([
        { id: K1, level: 3, label: 'Goggles on', display_order: 0 },
        { level: 3, label: 'Cleans the station', display_order: 1 },
      ]);
    });

    it('sends standard for a rubric with no style', async () => {
      await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Plain', criteria: [{ id: C1, name: 'One' }] });
      var call = client.calls[client.calls.length - 1];
      expect(call.payload.p_style).toBe('standard');
      expect(call.payload.p_criteria[0].checks).toEqual([]);
    });
  });

  describe('ticks: getRubricCheckIds / setRubricCheck', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      localStorage.clear();
      delete _cache.rubricChecks[CID];
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
      _useSupabase = true;
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      delete _cache.rubricChecks[CID];
    });

    function rpcCalls(name) {
      return client.calls.filter(function (c) {
        return c.name === name;
      });
    }

    it('ticks and clears one box, keeping the cache and localStorage in step', () => {
      expect(getRubricCheckIds(CID, E1, A1)).toEqual([]);
      setRubricCheck(CID, E1, A1, K1, true);
      setRubricCheck(CID, E1, A1, K2, true);
      expect(getRubricCheckIds(CID, E1, A1)).toEqual([K1, K2]);
      expect(isRubricCheckOn(CID, E1, A1, K1)).toBe(true);
      expect(JSON.parse(localStorage.getItem('gb-rubric-checks-' + CID))).toEqual({ [E1 + ':' + A1]: [K1, K2] });

      setRubricCheck(CID, E1, A1, K1, false);
      expect(getRubricCheckIds(CID, E1, A1)).toEqual([K2]);
      setRubricCheck(CID, E1, A1, K2, false);
      expect(getRubricCheckIds(CID, E1, A1)).toEqual([]);
      expect(JSON.parse(localStorage.getItem('gb-rubric-checks-' + CID))).toEqual({});
    });

    it('writes set_rubric_check for each change and nothing for a repeat', async () => {
      setRubricCheck(CID, E1, A1, K1, true);
      setRubricCheck(CID, E1, A1, K1, true); // already on
      setRubricCheck(CID, E1, A1, K1, false);
      await Promise.resolve();
      var calls = rpcCalls('set_rubric_check');
      expect(calls).toHaveLength(2);
      expect(calls[0].payload).toEqual({ p_enrollment_id: E1, p_assessment_id: A1, p_check_id: K1, p_on: true });
      expect(calls[1].payload).toEqual({ p_enrollment_id: E1, p_assessment_id: A1, p_check_id: K1, p_on: false });
      // No idempotency key: the write is idempotent by nature.
      expect(calls[0].payload.p_idempotency_key).toBeUndefined();
    });

    it('keeps a tick on a local id locally and sends nothing until the id is the server’s', () => {
      setRubricCheck(CID, E1, A1, 'ck-local', true);
      expect(getRubricCheckIds(CID, E1, A1)).toEqual(['ck-local']);
      expect(rpcCalls('set_rubric_check')).toHaveLength(0);
    });

    it('sends nothing in Demo Mode', () => {
      localStorage.setItem('gb-demo-mode', '1');
      setRubricCheck(CID, E1, A1, K1, true);
      expect(getRubricCheckIds(CID, E1, A1)).toEqual([K1]);
      expect(rpcCalls('set_rubric_check')).toHaveLength(0);
    });

    it('is echo-safe: a tick landing does not reload the class', () => {
      expect(_ECHO_SAFE_RPCS.set_rubric_check).toBe(true);
    });
  });

  describe('ticks from the class bundle', () => {
    it('rebuilds { sid:aid → [check ids] } from check_rows in index order', () => {
      var gb = {
        students: [{ enrollment_id: E1 }, { enrollment_id: 'e-other' }],
        assessments: [{ id: A1 }],
        check_index: [K1, K2, K3],
        check_rows: [
          [0, 0, 2],
          [1, 0, 0],
          [0, 0, 0],
          [0, 0, 0], // a duplicate row is one tick
          [0, 5, 1], // an assessment that is not in the list is skipped
        ],
      };
      expect(_bundleRubricChecks(gb)).toEqual({ [E1 + ':' + A1]: [K1, K3], ['e-other:' + A1]: [K1] });
      expect(_bundleRubricChecks({ students: [], assessments: [] })).toEqual({});
    });
  });

  describe('re-keying a checkbox', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.rubrics[CID] = [
        {
          id: R1,
          name: 'Lab Skills',
          style: 'advanced',
          criteria: [
            { id: C1, name: 'Safety', levels: {}, checks: [{ id: 'ck-local', level: 3, label: 'Goggles on' }] },
          ],
        },
      ];
      _cache.rubricChecks[CID] = { [E1 + ':' + A1]: ['ck-local', K2] };
    });
    afterEach(() => {
      delete _cache.rubrics[CID];
      delete _cache.rubricChecks[CID];
    });

    it('swaps the local id for the server’s in the rubric and in the ticks', () => {
      _rekey(CID, 'check', 'ck-local', K1);
      expect(_cache.rubrics[CID][0].criteria[0].checks[0].id).toBe(K1);
      expect(_cache.rubricChecks[CID][E1 + ':' + A1]).toEqual([K1, K2]);
    });

    it('finds a check by position within its criterion and level', () => {
      var crit = {
        checks: [
          { id: K2, level: 3, label: 'b', displayOrder: 1 },
          { id: K3, level: 4, label: 'c', displayOrder: 0 },
          { id: K1, level: 3, label: 'a', displayOrder: 0 },
        ],
      };
      // The cache is already in level display order; position is within the level.
      expect(_rubricCheckAt(crit, 3, 0).id).toBe(K2);
      expect(_rubricCheckAt(crit, 3, 1).id).toBe(K1);
      expect(_rubricCheckAt(crit, 4, 0).id).toBe(K3);
      expect(_rubricCheckAt(crit, 2, 0)).toBeNull();
    });
  });

  describe('a deleted assessment drops its ticks', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.scores[CID] = {};
      _cache.statuses[CID] = {};
      _cache.rubricChecks[CID] = { [E1 + ':' + A1]: [K1], [E1 + ':a-gone']: [K2] };
    });
    afterEach(() => {
      delete _cache.scores[CID];
      delete _cache.statuses[CID];
      delete _cache.rubricChecks[CID];
    });

    it('keeps ticks on assessments that remain', () => {
      _cleanOrphanedScores(CID, [{ id: A1 }]);
      expect(getRubricChecks(CID)).toEqual({ [E1 + ':' + A1]: [K1] });
    });
  });

  describe('Duplicate in the Rubric Bank carries the checks', () => {
    afterEach(() => {
      delete _cache.rubrics[CID];
    });

    it('copies style and checkboxes with new ids', () => {
      localStorage.clear();
      _cache.rubrics[CID] = [
        {
          id: R1,
          name: 'Lab Skills',
          style: 'advanced',
          criteria: [
            { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
          ],
        },
      ];
      var copy = RubricBank.duplicate(CID, R1);
      expect(copy.style).toBe('advanced');
      expect(copy.criteria[0].checks.map(k => k.label)).toEqual(['Goggles on']);
      expect(copy.criteria[0].checks[0].id).not.toBe(K1);
      // The source keeps its own ids.
      expect(getRubricById(CID, R1).criteria[0].checks[0].id).toBe(K1);
    });
  });

  describe('copies carry the checks', () => {
    it('gives a copied rubric new check ids and keeps the labels, levels and style', () => {
      var src = {
        id: R1,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: C1,
            name: 'Safety',
            tagIds: [],
            levels: {},
            checks: [
              { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
              { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
            ],
          },
        ],
      };
      var clone = RubricLibrary.cloneRubric(CID, 'c-other', src);
      expect(clone.style).toBe('advanced');
      var checks = clone.criteria[0].checks;
      expect(checks.map(k => k.label)).toEqual(['Goggles on', 'Cleans the station']);
      expect(checks.map(k => k.level)).toEqual([3, 3]);
      expect(checks.map(k => k.id)).not.toContain(K1);
      expect(checks.map(k => k.id)).not.toContain(K2);
      expect(new Set(checks.map(k => k.id)).size).toBe(2);
    });

    it('carries a checkbox edit onto a linked copy that still matched, with new ids', () => {
      var before = {
        id: R1,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
        ],
      };
      var after = structuredClone(before);
      after.criteria[0].checks.push({ id: 'ck-new', level: 3, label: 'Cleans the station' });
      var copy = {
        id: 'r-copy',
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: 'c-copy',
            name: 'Safety',
            tagIds: [],
            levels: {},
            checks: [{ id: 'k-copy', level: 3, label: 'Goggles on' }],
          },
        ],
      };
      var plan = RubricLibrary.planLinkedEdit(CID, before, after, 'c-other', copy);
      expect(plan.changed).toBe(true);
      expect(plan.lines).toContain('Checkboxes of “Safety” updated');
      var next = plan.next.criteria[0].checks;
      expect(next.map(k => k.label)).toEqual(['Goggles on', 'Cleans the station']);
      expect(next.map(k => k.id)).not.toContain(K1);
      expect(next.map(k => k.id)).not.toContain('ck-new');
    });

    it('leaves a copy’s own checkbox wording alone and follows a style change', () => {
      var before = {
        id: R1,
        name: 'Lab Skills',
        style: 'standard',
        criteria: [
          { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
        ],
      };
      var after = structuredClone(before);
      after.style = 'advanced';
      after.criteria[0].checks[0].label = 'Goggles on all lab';
      var copy = {
        id: 'r-copy',
        name: 'Lab Skills',
        criteria: [
          {
            id: 'c-copy',
            name: 'Safety',
            tagIds: [],
            levels: {},
            checks: [{ id: 'k-copy', level: 3, label: 'Own wording' }],
          },
        ],
      };
      var plan = RubricLibrary.planLinkedEdit(CID, before, after, 'c-other', copy);
      expect(plan.next.style).toBe('advanced');
      expect(plan.lines).toContain('Style → Advanced');
      expect(plan.skipped).toContain('the checkboxes of “Safety”');
      expect(plan.next.criteria[0].checks[0].label).toBe('Own wording');
    });
  });
});

describe('data-rubric-link-resend', () => {
  /**
   * A rubric saved while one of its competencies still had a local id reached
   * the server without that link: upsert_rubric only sends competency ids the
   * server knows. When the competency lands and is re-keyed, the class's
   * rubrics are sent again so the link is saved (shared/data.js, the 'tag'
   * re-key and _resendRubricLinks).
   */

  const CID = 'c0000000-0000-4000-8000-000000000101';
  const R1 = 'c0000000-0000-4000-8000-000000000171';
  const C1 = 'c0000000-0000-4000-8000-000000000172';
  const T1 = 'c0000000-0000-4000-8000-000000000181';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: name === 'upsert_rubric' ? R1 : null, error: null });
      },
    };
  }

  function rubric(tagId) {
    return {
      id: R1,
      name: 'Lab Skills',
      criteria: [{ id: C1, name: 'Inquiry', tagIds: [tagId], weight: 1, levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } }],
    };
  }

  const tick = () => new Promise(resolve => setTimeout(resolve, 5));

  describe('re-sending rubric links after a competency lands', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
      _cache.rubrics[CID] = [rubric('tag-local')];
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      delete _cache.rubrics[CID];
    });

    const upserts = () => client.calls.filter(c => c.name === 'upsert_rubric');

    it('sends the rubric again with the competency’s server id', async () => {
      _rekey(CID, 'tag', 'tag-local', T1);
      expect(getRubrics(CID)[0].criteria[0].tagIds).toEqual([T1]);
      await tick();
      await tick();
      expect(upserts().length).toBeGreaterThan(0);
      const last = upserts()[upserts().length - 1];
      expect(last.payload.p_criteria[0].linked_tag_ids).toEqual([T1]);
    });

    it('sends one save when several competencies land together', async () => {
      _cache.rubrics[CID] = [
        Object.assign(rubric('tag-a'), {
          criteria: [
            { id: C1, name: 'Inquiry', tagIds: ['tag-a', 'tag-b'], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } },
          ],
        }),
      ];
      _rekey(CID, 'tag', 'tag-a', T1);
      _rekey(CID, 'tag', 'tag-b', 'c0000000-0000-4000-8000-000000000182');
      await tick();
      await tick();
      expect(upserts()).toHaveLength(1);
    });

    it('does not re-send for a re-key another tab already sent', async () => {
      _rekey(CID, 'tag', 'tag-local', T1, { remote: true });
      await tick();
      await tick();
      expect(upserts()).toHaveLength(0);
    });

    it('does nothing when no rubric links the competency', async () => {
      _rekey(CID, 'tag', 'tag-unrelated', T1);
      await tick();
      expect(upserts()).toHaveLength(0);
    });
  });
});

describe('data-rubric-whole-tags', () => {
  /**
   * Whole-rubric competencies on the wire (rubric starts PR 6): the class
   * bundle's rubric_tags rows become rubric.tagIds, a save sends them as
   * upsert_rubric's p_linked_tag_ids (server ids only), a change to them is a
   * change to save, and a competency that lands re-keys them and sends the
   * rubric again.
   */

  const CID = 'c0000000-0000-4000-8000-000000000201';
  const R1 = 'c0000000-0000-4000-8000-000000000271';
  const C1 = 'c0000000-0000-4000-8000-000000000272';
  const T1 = 'c0000000-0000-4000-8000-000000000281';
  const T2 = 'c0000000-0000-4000-8000-000000000282';

  const tick = () => new Promise(resolve => setTimeout(resolve, 5));

  describe('rubric_tag rows', () => {
    it('become the rubric’s tagIds; a bundle without them gives none', () => {
      const rows = [{ id: R1, name: 'Lab', created_at: '2026-09-01', style: 'standard' }];
      const crit = [{ id: C1, rubric_id: R1, name: 'Inquiry', weight: 1, display_order: 0 }];
      const withTags = _canonicalRubricRowsToCache(
        rows,
        crit,
        [{ criterion_id: C1, tag_id: T1 }],
        [],
        [{ rubric_id: R1, tag_id: T2 }],
      );
      expect(withTags[0].tagIds).toEqual([T2]);
      expect(withTags[0].criteria[0].tagIds).toEqual([T1]);
      expect(_canonicalRubricRowsToCache(rows, crit, [], [])[0].tagIds).toEqual([]);
    });

    it('count in the save signature', () => {
      const r = { id: R1, name: 'Lab', criteria: [], tagIds: [] };
      expect(_rubricSignature(r)).not.toBe(_rubricSignature(Object.assign({}, r, { tagIds: [T1] })));
    });
  });

  describe('saving', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var calls;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();
      calls = [];
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          calls.push({ name: name, payload: payload || {} });
          return Promise.resolve({ data: name === 'upsert_rubric' ? R1 : null, error: null });
        },
      });
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      delete _cache.rubrics[CID];
    });
    const upserts = () => calls.filter(c => c.name === 'upsert_rubric');

    it('sends p_linked_tag_ids with server ids only', async () => {
      await window.v2.upsertRubric({
        id: R1,
        courseId: CID,
        name: 'Lab',
        criteria: [],
        linkedTagIds: [T1, 'tag-local'],
      });
      expect(upserts()[0].payload.p_linked_tag_ids).toEqual([T1]);
    });

    it('sends [] for a rubric with none, so removing the last one saves', async () => {
      await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Lab', criteria: [], linkedTagIds: [] });
      expect(upserts()[0].payload.p_linked_tag_ids).toEqual([]);
    });

    it('sends null when the rubric never loaded them, so the server keeps its own', async () => {
      await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Lab', criteria: [] });
      expect(upserts()[0].payload.p_linked_tag_ids).toBeNull();
    });

    it('re-keys a landed competency on the whole rubric and sends it again', async () => {
      _cache.rubrics[CID] = [
        {
          id: R1,
          name: 'Lab',
          tagIds: ['tag-local'],
          criteria: [{ id: C1, name: 'Inquiry', tagIds: [], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } }],
        },
      ];
      _rekey(CID, 'tag', 'tag-local', T1);
      expect(getRubrics(CID)[0].tagIds).toEqual([T1]);
      await tick();
      await tick();
      const last = upserts()[upserts().length - 1];
      expect(last.payload.p_linked_tag_ids).toEqual([T1]);
    });
  });
});

describe('data-rubrics', () => {
  /**
   * Rubric data layer tests — shared/data.js
   *
   * Local-cache CRUD only. Canonical-id patching + remote dispatch is in
   * data-rubrics-v2-sync.test.js. v2 create/update/delete dispatch is in
   * data-learning-map-v2-dispatch.test.js.
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.rubrics[CID] = undefined;
    _cache.rubrics['other'] = undefined;
    localStorage.clear();
  });

  describe('rubric CRUD', () => {
    it('getRubrics returns empty array when none saved', () => {
      expect(getRubrics(CID)).toEqual([]);
    });

    it('saveRubrics + getRubrics roundtrips full rubric shape (criteria, levels, tagIds)', () => {
      const rubric = {
        id: 'r1',
        title: 'Detailed Rubric',
        criteria: [
          {
            id: 'c1',
            label: 'Content',
            weight: 2,
            tagIds: ['t1', 't2'],
            levels: { 1: 'Beginning', 2: 'Developing', 3: 'Proficient', 4: 'Extending' },
          },
          { id: 'c2', label: 'Organization', weight: 1, tagIds: ['t3'] },
        ],
      };
      saveRubrics(CID, [rubric]);
      const loaded = getRubricById(CID, 'r1');
      expect(loaded.title).toBe('Detailed Rubric');
      expect(loaded.criteria).toHaveLength(2);
      expect(loaded.criteria[0].weight).toBe(2);
      expect(loaded.criteria[0].tagIds).toEqual(['t1', 't2']);
      expect(loaded.criteria[0].levels['3']).toBe('Proficient');
    });

    it('getRubricById returns undefined for nonexistent ID', () => {
      saveRubrics(CID, [{ id: 'r1', title: 'Rubric A' }]);
      expect(getRubricById(CID, 'nonexistent')).toBeUndefined();
    });

    it('saveRubrics replaces the previous set (no merge)', () => {
      saveRubrics(CID, [
        { id: 'r1', title: 'Old' },
        { id: 'r2', title: 'Old2' },
      ]);
      saveRubrics(CID, [{ id: 'r3', title: 'New' }]);
      const rubrics = getRubrics(CID);
      expect(rubrics).toHaveLength(1);
      expect(rubrics[0].id).toBe('r3');
    });
  });

  describe('rubric course isolation', () => {
    it('getRubrics keys on course id — rubrics do not leak across courses', () => {
      saveRubrics(CID, [{ id: 'r1', title: 'Test Rubric' }]);
      saveRubrics('other', [{ id: 'r2', title: 'Other Rubric' }]);
      expect(getRubrics(CID)).toHaveLength(1);
      expect(getRubrics(CID)[0].title).toBe('Test Rubric');
      expect(getRubrics('other')[0].title).toBe('Other Rubric');
    });
  });
});

describe('data-scores-write', () => {
  /**
   * Score write operations and rubric cascade tests — shared/data.js
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.scores[CID] = undefined;
    _cache.assessments[CID] = undefined;
    _cache.rubrics[CID] = undefined;
    localStorage.clear();
  });

  /* ── setPointsScore ───────────────────────────────────────── */
  describe('setPointsScore', () => {
    it('creates score entries for each tag in the assessment', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1', 't2'] }]);
      saveScores(CID, {});

      setPointsScore(CID, 'stu1', 'a1', 85);

      const scores = getScores(CID);
      const stu1Scores = scores['stu1'];
      expect(stu1Scores).toHaveLength(2);
      expect(stu1Scores[0].score).toBe(85);
      expect(stu1Scores[0].tagId).toBe('t1');
      expect(stu1Scores[1].tagId).toBe('t2');
    });

    it('updates existing score entries', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
      saveScores(CID, {
        stu1: [{ id: 'existing', assessmentId: 'a1', tagId: 't1', score: 50, date: '2025-01-15', type: 'summative' }],
      });

      setPointsScore(CID, 'stu1', 'a1', 90);

      const scores = getScores(CID);
      expect(scores['stu1']).toHaveLength(1);
      expect(scores['stu1'][0].score).toBe(90);
      expect(scores['stu1'][0].id).toBe('existing'); // same entry, updated
    });

    it('does nothing for nonexistent assessment', () => {
      saveAssessments(CID, []);
      saveScores(CID, {});

      setPointsScore(CID, 'stu1', 'nonexistent', 85);

      const scores = getScores(CID);
      expect(scores['stu1']).toBeUndefined();
    });

    it('does not create entries for score of 0', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
      saveScores(CID, {});

      setPointsScore(CID, 'stu1', 'a1', 0);

      const scores = getScores(CID);
      // Score 0 creates entries (rawScore >= 0) so teachers can record zero scores
      expect(scores['stu1']).toHaveLength(1);
      expect(scores['stu1'][0].score).toBe(0);
    });

    it('uses assessment date and type for new entries', () => {
      saveAssessments(CID, [
        { id: 'a1', title: 'Formative Quiz', date: '2025-03-20', type: 'formative', tagIds: ['t1'] },
      ]);
      saveScores(CID, {});

      setPointsScore(CID, 'stu1', 'a1', 75);

      const entry = getScores(CID)['stu1'][0];
      expect(entry.date).toBe('2025-03-20');
      expect(entry.type).toBe('formative');
    });
  });

  describe('upsertScore durability', () => {
    afterEach(() => {
      _useSupabase = false;
      _teacherId = null;
    });

    it('persists local backup data even when Supabase mode is enabled', () => {
      _useSupabase = true;
      _teacherId = 'teacher-1';
      saveScores(CID, {});

      upsertScore(CID, 'stu1', 'a1', 't1', 4, '2025-03-20', 'summative');

      const stored = JSON.parse(localStorage.getItem('gb-scores-' + CID));
      expect(stored.stu1).toHaveLength(1);
      expect(stored.stu1[0].assessmentId).toBe('a1');
      expect(stored.stu1[0].tagId).toBe('t1');
      expect(stored.stu1[0].score).toBe(4);
    });

    it('records the edit so a realtime refresh already in flight cannot overwrite it', () => {
      _useSupabase = true;
      _teacherId = 'teacher-1';
      var before = _localWriteCount(CID, 'scores');

      upsertScore(CID, 'stu1', 'a1', 't1', 4, '2025-03-20', 'summative');

      expect(_localWriteCount(CID, 'scores')).toBe(before + 1);
    });
  });

  /* ── deleteRubric ─────────────────────────────────────────── */
  describe('deleteRubric', () => {
    it('removes rubric from rubrics list', () => {
      saveRubrics(CID, [
        { id: 'r1', title: 'Rubric A' },
        { id: 'r2', title: 'Rubric B' },
      ]);
      saveAssessments(CID, []);

      deleteRubric(CID, 'r1');

      const rubrics = getRubrics(CID);
      expect(rubrics).toHaveLength(1);
      expect(rubrics[0].id).toBe('r2');
    });

    it('clears rubricId from assessments that reference it', () => {
      saveRubrics(CID, [{ id: 'r1', title: 'Rubric A' }]);
      saveAssessments(CID, [
        { id: 'a1', title: 'Uses rubric', rubricId: 'r1', tagIds: ['t1'] },
        { id: 'a2', title: 'No rubric', tagIds: ['t1'] },
        { id: 'a3', title: 'Also uses rubric', rubricId: 'r1', tagIds: ['t2'] },
      ]);

      deleteRubric(CID, 'r1');

      const assessments = getAssessments(CID);
      expect(assessments[0].rubricId).toBeUndefined();
      expect(assessments[1].rubricId).toBeUndefined(); // was already undefined
      expect(assessments[2].rubricId).toBeUndefined();
    });

    it('does not affect assessments with different rubricId', () => {
      saveRubrics(CID, [
        { id: 'r1', title: 'A' },
        { id: 'r2', title: 'B' },
      ]);
      saveAssessments(CID, [{ id: 'a1', title: 'Uses r2', rubricId: 'r2', tagIds: ['t1'] }]);

      deleteRubric(CID, 'r1');

      expect(getAssessments(CID)[0].rubricId).toBe('r2'); // preserved
    });

    it('handles no assessments referencing the rubric', () => {
      saveRubrics(CID, [{ id: 'r1', title: 'A' }]);
      saveAssessments(CID, [{ id: 'a1', title: 'No rubric', tagIds: ['t1'] }]);

      deleteRubric(CID, 'r1');

      expect(getRubrics(CID)).toHaveLength(0);
      expect(getAssessments(CID)).toHaveLength(1); // untouched
    });
  });
});

describe('data-seed-demo-only', () => {
  /**
   * Sample data is for Demo Mode only — shared/data.js loadSeedIfNeeded.
   *
   * A signed-in teacher with no classes must never get the Science 8 demo
   * class written into their account.
   */

  describe('loadSeedIfNeeded', () => {
    let originalIsDemoMode, originalSeed, seeded;

    beforeEach(() => {
      originalIsDemoMode = window.isDemoMode;
      originalSeed = globalThis.seedIfNeeded;
      seeded = 0;
      globalThis.seedIfNeeded = () => {
        seeded++;
      };
    });

    afterEach(() => {
      window.isDemoMode = originalIsDemoMode;
      globalThis.seedIfNeeded = originalSeed;
    });

    it('seeds in Demo Mode', async () => {
      window.isDemoMode = () => true;
      await window.loadSeedIfNeeded();
      expect(seeded).toBe(1);
    });

    it('does nothing for a signed-in teacher', async () => {
      window.isDemoMode = () => false;
      await window.loadSeedIfNeeded();
      expect(seeded).toBe(0);
    });
  });
});

describe('data-session-expired-guard', () => {
  describe('session-expired long-form guard', () => {
    var originalGetSupabase;
    var originalRefreshSupabaseSession;
    var originalShowSessionExpiredToast;
    var originalQueueSessionExpiredRetry;

    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      originalRefreshSupabaseSession = globalThis.refreshSupabaseSession;
      originalShowSessionExpiredToast = globalThis.showSessionExpiredToast;
      originalQueueSessionExpiredRetry = window.UI.queueSessionExpiredRetry;
      globalThis.showSessionExpiredToast = vi.fn();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      globalThis.refreshSupabaseSession = originalRefreshSupabaseSession;
      globalThis.showSessionExpiredToast = originalShowSessionExpiredToast;
      window.UI.queueSessionExpiredRetry = originalQueueSessionExpiredRetry;
      if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext();
      vi.restoreAllMocks();
    });

    it('silently refreshes and retries long-form saves before prompting again', async () => {
      var calls = 0;
      globalThis.getSupabase = function () {
        return {
          rpc() {
            calls++;
            if (calls === 1) return Promise.resolve({ data: null, error: { status: 401, message: 'JWT expired' } });
            return Promise.resolve({ data: { ok: true }, error: null });
          },
        };
      };
      globalThis.refreshSupabaseSession = vi.fn(async function () {
        return { session: { access_token: 'fresh-token' } };
      });
      window.UI.queueSessionExpiredRetry = vi.fn();
      setLongFormAuthContext({
        kind: 'term-rating',
        getDraftText() {
          return 'Draft';
        },
      });

      var res = await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, {
        narrativeHtml: '<p>Draft</p>',
      });

      expect(globalThis.refreshSupabaseSession).toHaveBeenCalledTimes(1);
      expect(window.UI.queueSessionExpiredRetry).not.toHaveBeenCalled();
      expect(calls).toBe(2);
      expect(res.error).toBeNull();
    });

    it('queues the retry behind the long-form modal when refresh fails', async () => {
      globalThis.getSupabase = function () {
        return {
          rpc() {
            return Promise.resolve({ data: null, error: { status: 401, message: 'refresh token expired' } });
          },
        };
      };
      globalThis.refreshSupabaseSession = vi.fn(async function () {
        throw new Error('refresh failed');
      });
      window.UI.queueSessionExpiredRetry = vi.fn();
      setLongFormAuthContext({
        kind: 'term-rating',
        getDraftText() {
          return 'Half written narrative';
        },
      });

      var res = await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, {
        narrativeHtml: '<p>Draft</p>',
      });

      expect(window.UI.queueSessionExpiredRetry).toHaveBeenCalledTimes(1);
      expect(window.UI.queueSessionExpiredRetry.mock.calls[0][0].key).toContain('save_term_rating');
      expect(res.error && res.error.handledSessionExpired).toBe(true);
    });

    it('uses the same long-form retry path when the draft session was already marked expired', async () => {
      var calls = 0;
      globalThis.getSupabase = function () {
        return {
          rpc() {
            calls++;
            return Promise.resolve({ data: { ok: true }, error: null });
          },
        };
      };
      globalThis.refreshSupabaseSession = vi.fn();
      window.UI.queueSessionExpiredRetry = vi.fn();
      setLongFormAuthContext({
        kind: 'observation-capture',
        getDraftText() {
          return 'Observation draft';
        },
      });
      markLongFormSessionExpired();

      var res = await window.createObservationRich({
        courseId: '11111111-1111-1111-1111-111111111111',
        body: 'Observation draft',
        enrollmentIds: ['22222222-2222-2222-2222-222222222222'],
      });

      expect(calls).toBe(0);
      expect(window.UI.queueSessionExpiredRetry).toHaveBeenCalledTimes(1);
      expect(res.error && res.error.handledSessionExpired).toBe(true);
    });
  });
});

describe('data-status-score-or-feedback', () => {
  /**
   * Missing and Excused never go on work with a score or feedback — shared/data.js
   * (hasScoreOrFeedback, canSetAssignmentStatus). Late always can, and a status
   * already on a cell can always be taken off.
   */

  const CID = 'test';
  const SID = 's1';

  function entry(aid, tagId, score, extra) {
    return Object.assign(
      { assessmentId: aid, tagId: tagId, score: score, type: 'summative', date: '2026-03-20' },
      extra || {},
    );
  }

  beforeEach(() => {
    ['assessments', 'scores', 'statuses', 'observations', 'dibels'].forEach(function (field) {
      _cache[field][CID] = undefined;
    });
    localStorage.clear();
    saveAssessments(CID, [
      { id: 'prof', title: 'Lab', date: '2026-03-20', type: 'summative', tagIds: ['t1', 't2'] },
      {
        id: 'pts',
        title: 'Quiz',
        date: '2026-03-20',
        type: 'summative',
        tagIds: [],
        scoreMode: 'points',
        maxPoints: 10,
      },
      { id: 'dib', title: 'DIBELS', date: '2026-03-20', type: 'summative', tagIds: [], scoreMode: 'dibels' },
    ]);
    saveScores(CID, {});
  });

  describe('canSetAssignmentStatus', () => {
    it('allows every status on work with nothing on it', () => {
      ['NS', 'EXC', 'LATE'].forEach(function (status) {
        expect(canSetAssignmentStatus(CID, SID, 'prof', status)).toBe(true);
      });
      setAssignmentStatus(CID, SID, 'prof', 'NS');
      expect(getAssignmentStatus(CID, SID, 'prof')).toBe('NS');
    });

    it('refuses Missing and Excused on a level, but allows Late', () => {
      saveScores(CID, { [SID]: [entry('prof', 't1', 3)] });
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'EXC')).toBe(false);
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'LATE')).toBe(true);
      setAssignmentStatus(CID, SID, 'prof', 'EXC');
      expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
    });

    it('treats a 0 level as no score, but a 0 in points as a score', () => {
      saveScores(CID, { [SID]: [entry('prof', 't1', 0), entry('pts', 'pts', 0)] });
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(true);
      expect(canSetAssignmentStatus(CID, SID, 'pts', 'NS')).toBe(false);
    });

    it('counts a criterion note with no level as feedback', () => {
      saveScores(CID, { [SID]: [entry('prof', 't1', null, { critNote: 'Check your units.' })] });
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
    });

    it('counts the Overall Comment as feedback', () => {
      saveScoreComment(CID, SID, 'prof', 'Well argued.');
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'EXC')).toBe(false);
      saveScoreComment(CID, SID, 'pts', 'Show your work.');
      expect(canSetAssignmentStatus(CID, SID, 'pts', 'NS')).toBe(false);
    });

    it('does not count an observation linked to the work as feedback', () => {
      addQuickOb(CID, SID, 'Talked about the missing lab.', [], 'neutral', null, { assessmentId: 'prof' });
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(true);
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'EXC')).toBe(true);
    });

    it('counts DIBELS numbers as a score', () => {
      saveDibelsScore(CID, SID, 'dib', 'boy', { orfWrc: 120 });
      expect(canSetAssignmentStatus(CID, SID, 'dib', 'NS')).toBe(false);
    });

    it('always lets a status already on the cell come off', () => {
      setAssignmentStatus(CID, SID, 'prof', 'NS');
      saveScoreComment(CID, SID, 'prof', 'Please hand this in.');
      expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(true);
      expect(canSetAssignmentStatus(CID, SID, 'prof', null)).toBe(true);
      setAssignmentStatus(CID, SID, 'prof', null);
      expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
    });
  });

  describe('applyAssignmentStatus', () => {
    it('leaves a scored student as they were when Missing is refused', () => {
      saveScores(CID, { [SID]: [entry('prof', 't1', 3), entry('prof', 't2', 2)] });
      expect(applyAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
      expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
      expect(getScores(CID)[SID].map(e => e.score)).toEqual([3, 2]);
    });
  });

  /* The other half: Missing or Excused work takes no score, whichever view or
   key writes it (Nov 3 bug sweep). The lock is in the shared score writers. */
  describe('score writers on Missing and Excused work', () => {
    it('refuse a level on Missing work, so the competency grade has no hidden score', () => {
      setAssignmentStatus(CID, SID, 'prof', 'NS');
      expect(upsertScore(CID, SID, 'prof', 't1', 3, '2026-03-20', 'summative', '')).toBe(false);
      expect((getScores(CID)[SID] || []).filter(e => e.score > 0)).toEqual([]);
      clearProfCache();
      expect(getTagScores(CID, SID, 't1')).toEqual([]);
      expect(hasScoreOrFeedback(CID, SID, 'prof')).toBe(false);
    });

    it('refuse points and Complete/Incomplete marks on Missing or Excused work', () => {
      saveAssessments(CID, [
        {
          id: 'pts',
          title: 'Quiz',
          date: '2026-03-20',
          type: 'summative',
          tagIds: [],
          scoreMode: 'points',
          maxPoints: 10,
        },
        { id: 'cmp', title: 'Check', date: '2026-03-20', type: 'summative', tagIds: [], scoreMode: 'complete' },
      ]);
      setAssignmentStatus(CID, SID, 'pts', 'NS');
      setAssignmentStatus(CID, SID, 'cmp', 'EXC');
      expect(setPointsScore(CID, SID, 'pts', 8)).toBe(false);
      expect(setPointsScore(CID, SID, 'pts', 0)).toBe(false);
      expect(setCompletionMark(CID, SID, 'cmp', 'complete')).toBe(false);
      expect(setCompletionMark(CID, SID, 'cmp', 'incomplete')).toBe(false);
      expect(getPointsScore(CID, SID, 'pts')).toBe(null);
      expect(getCompletionMark(CID, SID, 'cmp')).toBe(null);
    });

    it('still clear a score, and score Late work', () => {
      setAssignmentStatus(CID, SID, 'prof', 'LATE');
      upsertScore(CID, SID, 'prof', 't1', 3, '2026-03-20', 'summative', '');
      expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(3);
      saveAssignmentStatuses(CID, { [SID + ':prof']: 'NS' });
      upsertScore(CID, SID, 'prof', 't1', 0, '2026-03-20', 'summative', '');
      expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(0);
    });

    it('score the work again once Missing comes off', () => {
      setAssignmentStatus(CID, SID, 'prof', 'NS');
      setAssignmentStatus(CID, SID, 'prof', null);
      upsertScore(CID, SID, 'prof', 't1', 2, '2026-03-20', 'summative', '');
      expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(2);
    });
  });
});

describe('data-statuses-migration', () => {
  /**
   * One-time LocalStorage migration — assignment-status value format.
   *
   * Guards the fix for the three-way status-format bug (2026-04-23):
   *   • Desktop used to write 'notSubmitted' / 'excused' / 'late'.
   *   • Server CHECK constraint only accepts 'NS' / 'EXC' / 'LATE'.
   *   • calc.js now only recognizes the short form.
   *
   * _migrateAssignmentStatusFormat() walks every gb-statuses-<cid> key on
   * boot, converts long-form values in place, and backs up the pre-migration
   * JSON to gb-mig-bak-statuses-<cid>. It must be idempotent — already-short
   * data is a no-op, a second run adds no second backup.
   */

  describe('_migrateAssignmentStatusFormat', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('rewrites long-form values to short form in place', () => {
      localStorage.setItem(
        'gb-statuses-c1',
        JSON.stringify({
          's1:a1': 'notSubmitted',
          's1:a2': 'excused',
          's1:a3': 'late',
        }),
      );
      _migrateAssignmentStatusFormat();
      const after = JSON.parse(localStorage.getItem('gb-statuses-c1'));
      expect(after).toEqual({
        's1:a1': 'NS',
        's1:a2': 'EXC',
        's1:a3': 'LATE',
      });
    });

    it('creates a pre-migration backup on first rewrite', () => {
      const raw = JSON.stringify({ 's1:a1': 'excused' });
      localStorage.setItem('gb-statuses-c1', raw);
      _migrateAssignmentStatusFormat();
      const bak = JSON.parse(localStorage.getItem('gb-mig-bak-statuses-c1'));
      expect(bak).toBeDefined();
      expect(bak.data).toBe(raw);
      expect(typeof bak.ts).toBe('number');
    });

    it('leaves already-short-form values untouched AND writes no backup', () => {
      const already = JSON.stringify({
        's1:a1': 'NS',
        's1:a2': 'EXC',
        's1:a3': 'LATE',
      });
      localStorage.setItem('gb-statuses-c1', already);
      _migrateAssignmentStatusFormat();
      expect(localStorage.getItem('gb-statuses-c1')).toBe(already);
      expect(localStorage.getItem('gb-mig-bak-statuses-c1')).toBeNull();
    });

    it('is idempotent — a second run does not overwrite the first backup', () => {
      const raw = JSON.stringify({ 's1:a1': 'excused' });
      localStorage.setItem('gb-statuses-c1', raw);
      _migrateAssignmentStatusFormat();
      const bak1 = localStorage.getItem('gb-mig-bak-statuses-c1');
      // Wait a tick to ensure a second backup would have a different ts
      const tsBefore = JSON.parse(bak1).ts;
      // Second call — nothing to migrate now; no new backup.
      _migrateAssignmentStatusFormat();
      const bak2 = JSON.parse(localStorage.getItem('gb-mig-bak-statuses-c1'));
      expect(bak2.ts).toBe(tsBefore);
      // And the statuses key should still be the already-migrated form.
      expect(JSON.parse(localStorage.getItem('gb-statuses-c1'))).toEqual({
        's1:a1': 'EXC',
      });
    });

    it('migrates every gb-statuses-<cid> key independently', () => {
      localStorage.setItem('gb-statuses-c1', JSON.stringify({ 's1:a1': 'notSubmitted' }));
      localStorage.setItem('gb-statuses-c2', JSON.stringify({ 's2:a2': 'excused' }));
      localStorage.setItem('gb-statuses-c3', JSON.stringify({ 's3:a3': 'NS' })); // already short
      _migrateAssignmentStatusFormat();
      expect(JSON.parse(localStorage.getItem('gb-statuses-c1'))['s1:a1']).toBe('NS');
      expect(JSON.parse(localStorage.getItem('gb-statuses-c2'))['s2:a2']).toBe('EXC');
      expect(JSON.parse(localStorage.getItem('gb-statuses-c3'))['s3:a3']).toBe('NS');
      // Backup exists for the two that needed migration but NOT the short-form one.
      expect(localStorage.getItem('gb-mig-bak-statuses-c1')).not.toBeNull();
      expect(localStorage.getItem('gb-mig-bak-statuses-c2')).not.toBeNull();
      expect(localStorage.getItem('gb-mig-bak-statuses-c3')).toBeNull();
    });

    it('mixed long+short-form values in one key — only the long ones change', () => {
      localStorage.setItem(
        'gb-statuses-c1',
        JSON.stringify({
          's1:a1': 'NS', // already short
          's1:a2': 'excused', // long — migrate
          's1:a3': 'LATE', // already short
        }),
      );
      _migrateAssignmentStatusFormat();
      expect(JSON.parse(localStorage.getItem('gb-statuses-c1'))).toEqual({
        's1:a1': 'NS',
        's1:a2': 'EXC',
        's1:a3': 'LATE',
      });
    });

    it('silently skips keys with unparseable JSON', () => {
      localStorage.setItem('gb-statuses-broken', 'not-json-at-all');
      expect(() => _migrateAssignmentStatusFormat()).not.toThrow();
      // Key is left untouched — the migration refuses to guess.
      expect(localStorage.getItem('gb-statuses-broken')).toBe('not-json-at-all');
      expect(localStorage.getItem('gb-mig-bak-statuses-broken')).toBeNull();
    });

    it('ignores unrelated localStorage keys', () => {
      localStorage.setItem('gb-scores-c1', JSON.stringify({ foo: 'excused' }));
      _migrateAssignmentStatusFormat();
      // Unrelated key should still contain the original string.
      expect(JSON.parse(localStorage.getItem('gb-scores-c1'))).toEqual({ foo: 'excused' });
    });
  });
});

describe('data-statuses', () => {
  /**
   * setAssignmentStatus v2 dispatch — shared/data.js
   *
   * Local-cache status behavior is covered in data-scores.test.js.
   * window.setCellStatus (direct RPC wrapper) is covered in
   * data-scores-v2-dispatch.test.js. This file pins the wiring between
   * the page-level setAssignmentStatus entry point and the set_score_status
   * RPC, including the UUID guard that falls back to local-only.
   */

  // A real course id: statuses only sync for server courses.
  const CID = '33333333-3333-4333-8333-333333333333';
  let _origGetSupabase;
  let _origUseSupabase;

  beforeEach(() => {
    _cache.statuses[CID] = undefined;
    localStorage.clear();
    _origGetSupabase = getSupabase;
    _origUseSupabase = _useSupabase;
  });

  afterEach(() => {
    globalThis.getSupabase = _origGetSupabase;
    _useSupabase = _origUseSupabase;
  });

  describe('setAssignmentStatus v2 dispatch', () => {
    it('calls set_score_status when Supabase is enabled and ids are UUIDs', async () => {
      const ENR = '11111111-1111-1111-1111-111111111111';
      const AID = '22222222-2222-2222-2222-222222222222';
      const rpcCalls = [];
      _useSupabase = true;
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return Promise.resolve({ error: null });
        },
      });

      setAssignmentStatus(CID, ENR, AID, 'LATE');
      await Promise.resolve();

      const scoreStatusCall = rpcCalls.find(c => c.name === 'set_score_status');
      expect(scoreStatusCall).toBeDefined();
      expect(scoreStatusCall.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID,
        p_status: 'LATE',
      });
    });

    it('skips the RPC when ids are not UUIDs (legacy local-only path)', async () => {
      const rpcCalls = [];
      _useSupabase = true;
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return Promise.resolve({ error: null });
        },
      });

      setAssignmentStatus(CID, 'stu1', 'assess1', 'LATE');
      await Promise.resolve();

      expect(rpcCalls.find(c => c.name === 'set_score_status')).toBeUndefined();
    });
  });
});

describe('data-student-profile-v2-dispatch', () => {
  /**
   * v2 student-profile + student-records dispatch tests — shared/data.js (Phase 4.6)
   *
   * Covers window.v2 helpers:
   *   getStudentProfile     → get_student_profile
   *   addNote / deleteNote  → upsert_note / delete_note
   *   saveGoal              → upsert_goal
   *   saveReflection        → upsert_reflection
   *   saveSectionOverride   → upsert_section_override
   *   clearSectionOverride  → clear_section_override
   *   bulkAttendance        → bulk_attendance
   */

  const ENR1 = '11111111-1111-1111-1111-111111111111';
  const ENR2 = '22222222-2222-2222-2222-222222222222';
  const SEC = '33333333-3333-3333-3333-333333333333';
  const NOTE_ID = '44444444-4444-4444-4444-444444444444';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('v2 student-profile / student-records dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('getStudentProfile', () => {
      it('calls get_student_profile with enrollment id', async () => {
        await window.v2.getStudentProfile(ENR1);
        expect(client.calls[0]).toEqual({ name: 'get_student_profile', payload: { p_enrollment_id: ENR1 } });
      });
    });

    describe('listCourseStudentProfiles', () => {
      it('calls list_course_student_profiles with course id', async () => {
        await window.v2.listCourseStudentProfiles(ENR1);
        expect(client.calls[0]).toEqual({
          name: 'list_course_student_profiles',
          payload: { p_course_id: ENR1 },
        });
      });
    });

    describe('notes', () => {
      it('addNote calls upsert_note with enrollment_id + body', async () => {
        await window.v2.addNote(ENR1, 'Helpful note');
        expect(client.calls[0]).toEqual({
          name: 'upsert_note',
          payload: { p_enrollment_id: ENR1, p_body: 'Helpful note', p_idempotency_key: expect.any(String) },
        });
      });

      it('addNote coerces missing body to empty string', async () => {
        await window.v2.addNote(ENR1);
        expect(client.calls[0].payload.p_body).toBe('');
      });

      it('deleteNote calls delete_note', async () => {
        await window.v2.deleteNote(NOTE_ID);
        expect(client.calls[0]).toEqual({ name: 'delete_note', payload: { p_id: NOTE_ID } });
      });
    });

    describe('saveGoal', () => {
      it('calls upsert_goal with enrollment_id + section_id + body', async () => {
        await window.v2.saveGoal(ENR1, SEC, 'Ask better questions');
        expect(client.calls[0]).toEqual({
          name: 'upsert_goal',
          payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_body: 'Ask better questions' },
        });
      });
    });

    describe('saveReflection', () => {
      it('calls upsert_reflection with body + confidence as Number', async () => {
        await window.v2.saveReflection(ENR1, SEC, 'I got this', 4);
        expect(client.calls[0]).toEqual({
          name: 'upsert_reflection',
          payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_body: 'I got this', p_confidence: 4 },
        });
      });

      it('passes null confidence when undefined', async () => {
        await window.v2.saveReflection(ENR1, SEC, 'x');
        expect(client.calls[0].payload.p_confidence).toBeNull();
      });

      it('coerces string confidence to Number', async () => {
        await window.v2.saveReflection(ENR1, SEC, 'x', '3');
        expect(client.calls[0].payload.p_confidence).toBe(3);
      });
    });

    describe('section overrides', () => {
      it('saveSectionOverride calls upsert_section_override with numeric level + reason', async () => {
        await window.v2.saveSectionOverride(ENR1, SEC, 4, 'Conference evidence');
        expect(client.calls[0]).toEqual({
          name: 'upsert_section_override',
          payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_level: 4, p_reason: 'Conference evidence' },
        });
      });

      it('saveSectionOverride nulls empty reason', async () => {
        await window.v2.saveSectionOverride(ENR1, SEC, 3, '');
        expect(client.calls[0].payload.p_reason).toBeNull();
      });

      it('clearSectionOverride calls clear_section_override', async () => {
        await window.v2.clearSectionOverride(ENR1, SEC);
        expect(client.calls[0]).toEqual({
          name: 'clear_section_override',
          payload: { p_enrollment_id: ENR1, p_section_id: SEC },
        });
      });
    });

    describe('bulkAttendance', () => {
      it('calls bulk_attendance with filtered UUIDs + date + status', async () => {
        await window.v2.bulkAttendance([ENR1, 'junk', ENR2], '2026-04-20', 'Absent');
        expect(client.calls[0]).toEqual({
          name: 'bulk_attendance',
          payload: { p_enrollment_ids: [ENR1, ENR2], p_date: '2026-04-20', p_status: 'Absent' },
        });
      });

      it('coerces missing status to empty string', async () => {
        await window.v2.bulkAttendance([ENR1], '2026-04-20');
        expect(client.calls[0].payload.p_status).toBe('');
      });
    });
  });
});

describe('data-students-v2-dispatch', () => {
  /**
   * v2 student + enrollment CRUD dispatch tests — shared/data.js (Phase 4.1)
   *
   * Covers:
   *   _canonicalEnrollStudent        → create_student_and_enroll
   *   _canonicalUpdateStudent        → update_student
   *   _canonicalUpdateEnrollment     → update_enrollment
   *   _canonicalWithdrawEnrollment   → withdraw_student
   *   window.reorderRoster           → reorder_roster
   *   window.bulkApplyPronouns       → bulk_apply_pronouns
   *   window.importRosterCsv         → import_roster_csv
   *   window.setEnrollmentFlag       → update_enrollment (is_flagged patch)
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const ENR = '22222222-2222-2222-2222-222222222222';
  const STU = '33333333-3333-3333-3333-333333333333';

  function makeRecordingClient(responses) {
    var calls = [];
    responses = responses || {};
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        var r = responses[name];
        return Promise.resolve(r || { data: null, error: null });
      },
    };
  }

  describe('v2 student/enrollment CRUD dispatch', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      localStorage.clear();
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    describe('_canonicalEnrollStudent', () => {
      it('calls create_student_and_enroll with student fields mapped to snake_case', async () => {
        var s = {
          id: 'temp-local-id',
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferred: 'Ada',
          pronouns: 'she/her',
          studentNumber: '42',
          email: 'ada@example.com',
          dateOfBirth: '2012-05-01',
          designations: ['IEP'],
          personId: null,
        };
        await _canonicalEnrollStudent(client, CID, s, 3);
        var call = client.calls.find(function (c) {
          return c.name === 'create_student_and_enroll';
        });
        expect(call).toBeDefined();
        expect(call.payload).toEqual({
          p_course_id: CID,
          p_first_name: 'Ada',
          p_last_name: 'Lovelace',
          p_preferred_name: 'Ada',
          p_pronouns: 'she/her',
          p_student_number: '42',
          p_email: 'ada@example.com',
          p_date_of_birth: '2012-05-01',
          p_designations: ['IEP'],
          p_existing_student_id: null,
          p_idempotency_key: expect.any(String),
        });
      });

      it('passes existing personId when it is a UUID (re-enrollment path)', async () => {
        var s = { id: 'temp', firstName: 'X', personId: STU };
        await _canonicalEnrollStudent(client, CID, s, 0);
        var call = client.calls.find(function (c) {
          return c.name === 'create_student_and_enroll';
        });
        expect(call.payload.p_existing_student_id).toBe(STU);
      });

      it('nullifies non-UUID personId', async () => {
        var s = { id: 'temp', firstName: 'X', personId: 'legacy-string' };
        await _canonicalEnrollStudent(client, CID, s, 0);
        var call = client.calls.find(function (c) {
          return c.name === 'create_student_and_enroll';
        });
        expect(call.payload.p_existing_student_id).toBeNull();
      });

      it('patches the cached student id with the returned enrollment_id on success', async () => {
        var s = { id: 'temp-local-id', firstName: 'Ada', personId: null };
        _cache.students[CID] = [s];
        client = makeRecordingClient({
          create_student_and_enroll: { data: { enrollment_id: ENR, student_id: STU }, error: null },
        });
        globalThis.getSupabase = () => client;
        await _canonicalEnrollStudent(client, CID, s, 5);
        expect(s.id).toBe(ENR);
        expect(s.personId).toBe(STU);
        expect(s.rosterPosition).toBe(5);
      });
    });

    describe('_canonicalUpdateStudent', () => {
      it('calls update_student with a jsonb patch of snake_case keys', async () => {
        var s = {
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferred: 'Ada',
          pronouns: 'she/her',
          studentNumber: '42',
          email: 'a@b.com',
          dateOfBirth: '2012-05-01',
        };
        await _canonicalUpdateStudent(client, STU, s);
        var call = client.calls.find(function (c) {
          return c.name === 'update_student';
        });
        expect(call).toBeDefined();
        expect(call.payload).toEqual({
          p_id: STU,
          p_patch: {
            first_name: 'Ada',
            last_name: 'Lovelace',
            preferred_name: 'Ada',
            pronouns: 'she/her',
            student_number: '42',
            email: 'a@b.com',
            date_of_birth: '2012-05-01',
          },
        });
      });

      it('nullifies empty fields except first_name (which defaults to empty string)', async () => {
        await _canonicalUpdateStudent(client, STU, { firstName: '', lastName: '', preferred: '' });
        var call = client.calls.find(function (c) {
          return c.name === 'update_student';
        });
        expect(call.payload.p_patch.first_name).toBe('');
        expect(call.payload.p_patch.last_name).toBeNull();
        expect(call.payload.p_patch.preferred_name).toBeNull();
      });
    });

    describe('_canonicalUpdateEnrollment', () => {
      it('patches designations + roster_position', async () => {
        await _canonicalUpdateEnrollment(client, ENR, { designations: ['IEP', 'ELL'] }, 7);
        var call = client.calls.find(function (c) {
          return c.name === 'update_enrollment';
        });
        expect(call.payload.p_id).toBe(ENR);
        expect(call.payload.p_patch.designations).toEqual(['IEP', 'ELL']);
        expect(call.payload.p_patch.roster_position).toBe(7);
      });

      it('includes is_flagged only when isFlagged is a boolean', async () => {
        await _canonicalUpdateEnrollment(client, ENR, { isFlagged: true }, 0);
        var call1 = client.calls.find(function (c) {
          return c.name === 'update_enrollment';
        });
        expect(call1.payload.p_patch.is_flagged).toBe(true);

        client.calls.length = 0;
        await _canonicalUpdateEnrollment(client, ENR, {}, 0);
        var call2 = client.calls.find(function (c) {
          return c.name === 'update_enrollment';
        });
        expect(call2.payload.p_patch.is_flagged).toBeUndefined();
      });
    });

    describe('_canonicalWithdrawEnrollment', () => {
      it('calls withdraw_student with the enrollment id', async () => {
        await _canonicalWithdrawEnrollment(client, ENR);
        var call = client.calls.find(function (c) {
          return c.name === 'withdraw_student';
        });
        expect(call).toBeDefined();
        expect(call.payload.p_enrollment_id).toBe(ENR);
        expect(client.calls.find(c => c.name === 'withdraw_enrollment')).toBeUndefined();
      });
    });

    describe('window.reorderRoster', () => {
      it('calls reorder_roster with the filtered UUID list', async () => {
        await window.reorderRoster([ENR, 'not-a-uuid', STU]);
        var call = client.calls.find(function (c) {
          return c.name === 'reorder_roster';
        });
        expect(call).toBeDefined();
        expect(call.payload.p_ids).toEqual([ENR, STU]);
      });

      it('no-ops when the filtered list is empty', async () => {
        await window.reorderRoster(['not-a-uuid']);
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.bulkApplyPronouns', () => {
      it('calls bulk_apply_pronouns with filtered ids and pronoun string', async () => {
        await window.bulkApplyPronouns([STU, 'junk'], 'they/them');
        var call = client.calls.find(function (c) {
          return c.name === 'bulk_apply_pronouns';
        });
        expect(call.payload).toEqual({ p_student_ids: [STU], p_pronouns: 'they/them' });
      });

      it('passes null when pronouns is empty (clears)', async () => {
        await window.bulkApplyPronouns([STU], '');
        var call = client.calls.find(function (c) {
          return c.name === 'bulk_apply_pronouns';
        });
        expect(call.payload.p_pronouns).toBeNull();
      });
    });

    describe('window.importRosterCsv', () => {
      it('calls import_roster_csv with course id + row array', async () => {
        var rows = [{ first_name: 'Ada', last_name: 'Lovelace' }];
        await window.importRosterCsv(CID, rows);
        var call = client.calls.find(function (c) {
          return c.name === 'import_roster_csv';
        });
        expect(call.payload).toEqual({
          p_course_id: CID,
          p_rows: rows,
          p_idempotency_key: expect.any(String),
        });
      });

      it('skips dispatch when course id is not a UUID', async () => {
        await window.importRosterCsv('legacy-id', []);
        expect(client.calls).toHaveLength(0);
      });
    });

    describe('window.setEnrollmentFlag', () => {
      it('calls update_enrollment with an is_flagged patch', async () => {
        await window.setEnrollmentFlag(ENR, true);
        var call = client.calls.find(function (c) {
          return c.name === 'update_enrollment';
        });
        expect(call.payload).toEqual({
          p_id: ENR,
          p_patch: { is_flagged: true },
        });
      });

      it('coerces falsy flag to false', async () => {
        await window.setEnrollmentFlag(ENR, 0);
        var call = client.calls.find(function (c) {
          return c.name === 'update_enrollment';
        });
        expect(call.payload.p_patch.is_flagged).toBe(false);
      });

      it('skips dispatch on non-UUID enrollment id', async () => {
        await window.setEnrollmentFlag('junk', true);
        expect(client.calls).toHaveLength(0);
      });
    });
  });
});

describe('data-tags', () => {
  /**
   * Tag resolution and custom tag tests — shared/data.js
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.customTags[CID] = undefined;
    localStorage.clear();
  });

  describe('resolveTag', () => {
    it('resolves core competency with cc: prefix', () => {
      const result = resolveTag('cc:COM');
      expect(result.type).toBe('cc');
      expect(result.label).toBe('Communicating');
      expect(result.group).toBe('Communication');
    });

    it('handles unknown core competency gracefully', () => {
      const result = resolveTag('cc:UNKNOWN');
      expect(result.type).toBe('cc');
      expect(result.label).toBe('UNKNOWN');
    });

    it('resolves custom tag with tag: prefix', () => {
      const result = resolveTag('tag:Homework');
      expect(result.type).toBe('custom');
      expect(result.label).toBe('Homework');
      expect(result.group).toBe('Custom');
    });

    it('resolves observation dimension by key', () => {
      const result = resolveTag('engagement');
      expect(result.type).toBe('dim');
      expect(result.label).toBe('Engagement');
    });

    it('returns unknown for unrecognized tag', () => {
      const result = resolveTag('foobar');
      expect(result.type).toBe('unknown');
      expect(result.label).toBe('foobar');
    });
  });

  describe('addCustomTag', () => {
    it('adds a new tag', () => {
      saveCustomTags(CID, []);
      addCustomTag(CID, 'Homework');
      expect(getCustomTags(CID)).toContain('Homework');
    });

    it('trims whitespace', () => {
      saveCustomTags(CID, []);
      const result = addCustomTag(CID, '  Homework  ');
      expect(result).toBe('Homework');
      expect(getCustomTags(CID)).toContain('Homework');
    });

    it('rejects duplicates', () => {
      saveCustomTags(CID, ['Homework']);
      addCustomTag(CID, 'Homework');
      expect(getCustomTags(CID).filter(t => t === 'Homework')).toHaveLength(1);
    });

    it('sorts alphabetically after adding', () => {
      saveCustomTags(CID, ['Zzz']);
      addCustomTag(CID, 'Aaa');
      const tags = getCustomTags(CID);
      expect(tags[0]).toBe('Aaa');
      expect(tags[1]).toBe('Zzz');
    });
  });

  describe('removeCustomTag', () => {
    it('removes existing tag', () => {
      saveCustomTags(CID, ['Homework', 'Participation']);
      removeCustomTag(CID, 'Homework');
      expect(getCustomTags(CID)).toEqual(['Participation']);
    });

    it('no-op for non-existent tag', () => {
      saveCustomTags(CID, ['Homework']);
      removeCustomTag(CID, 'Nonexistent');
      expect(getCustomTags(CID)).toEqual(['Homework']);
    });
  });
});

describe('data-term-rating-v2-dispatch', () => {
  /**
   * v2 term-rating dispatch test — shared/data.js (Phase 4.7)
   *
   * Covers window.v2.saveTermRating camelCase → snake_case payload translation
   * for save_term_rating. Omitted keys must NOT appear in the wire payload so
   * the server leaves fields / sets alone. Empty [] for a set wipes it.
   */

  const ENR = '11111111-1111-1111-1111-111111111111';
  const SEC = '22222222-2222-2222-2222-222222222222';
  const TAG1 = '33333333-3333-3333-3333-333333333333';
  const TAG2 = '44444444-4444-4444-4444-444444444444';
  const AID = '55555555-5555-5555-5555-555555555555';
  const OB = '66666666-6666-4666-8666-666666666666';

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('v2 saveTermRating', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('translates full camelCase payload to snake_case wire payload', async () => {
      await window.v2.saveTermRating(ENR, 2, {
        narrativeHtml: '<p>Great</p>',
        workHabitsRating: 4,
        participationRating: 3,
        socialTraits: ['kind', 'curious'],
        dimensions: [
          { sectionId: SEC, rating: 4 },
          { sectionId: SEC, rating: '3' }, // coerce
        ],
        strengthTagIds: [TAG1, 'junk'],
        growthTagIds: [TAG2],
        mentionAssessmentIds: [AID],
        mentionObservationIds: [OB],
      });
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call.payload.p_enrollment_id).toBe(ENR);
      expect(call.payload.p_term).toBe(2);
      expect(call.payload.p_payload).toEqual({
        narrative_html: '<p>Great</p>',
        work_habits_rating: 4,
        participation_rating: 3,
        social_traits: ['kind', 'curious'],
        dimensions: [
          { section_id: SEC, rating: 4 },
          { section_id: SEC, rating: 3 },
        ],
        strength_tags: [TAG1],
        growth_tags: [TAG2],
        mention_assessments: [AID],
        mention_observations: [OB],
      });
    });

    it('omits keys that are not in the input payload (partial update)', async () => {
      await window.v2.saveTermRating(ENR, 1, { narrativeHtml: 'x' });
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(Object.keys(call.payload.p_payload)).toEqual(['narrative_html']);
    });

    it('preserves empty arrays (wipe signal) when explicitly passed', async () => {
      await window.v2.saveTermRating(ENR, 1, {
        strengthTagIds: [],
        growthTagIds: [],
        mentionAssessmentIds: [],
        mentionObservationIds: [],
      });
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call.payload.p_payload.strength_tags).toEqual([]);
      expect(call.payload.p_payload.growth_tags).toEqual([]);
      expect(call.payload.p_payload.mention_assessments).toEqual([]);
      expect(call.payload.p_payload.mention_observations).toEqual([]);
    });

    it('sends habits as a clean map and approved as a boolean', async () => {
      await window.v2.saveTermRating(ENR, 2, { habits: { completes: 4, ready: '2', part: 6, others: 0 }, approved: 1 });
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call.payload.p_payload).toEqual({ habits: { completes: 4, ready: 2 }, approved: true });
    });

    it('coerces term to Number', async () => {
      await window.v2.saveTermRating(ENR, '3', {});
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call.payload.p_term).toBe(3);
    });

    it('defaults socialTraits to [] when the key is present but value is falsy', async () => {
      await window.v2.saveTermRating(ENR, 1, { socialTraits: null });
      var call = client.calls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call.payload.p_payload.social_traits).toEqual([]);
    });
  });
});

describe('data-term-ratings', () => {
  /**
   * Term rating tests — shared/data.js
   */

  const CID = 'test';
  const CANONICAL_CID = '11111111-1111-1111-1111-111111111111';
  const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
  const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
  let _origGetSupabase;
  let _origUseSupabase;

  beforeEach(() => {
    _cache.termRatings[CID] = undefined;
    _cache.termRatings[CANONICAL_CID] = undefined;
    _cache.students[CANONICAL_CID] = undefined;
    localStorage.clear();
    _origGetSupabase = getSupabase;
    _origUseSupabase = _useSupabase;
    _useSupabase = false;
  });

  afterEach(() => {
    globalThis.getSupabase = _origGetSupabase;
    _useSupabase = _origUseSupabase;
  });

  describe('getStudentTermRating', () => {
    it('returns rating when it exists', () => {
      saveTermRatings(CID, {
        stu1: { term1: { dims: { engagement: 3 }, narrative: 'Good work' } },
      });
      const result = getStudentTermRating(CID, 'stu1', 'term1');
      expect(result.narrative).toBe('Good work');
      expect(result.dims.engagement).toBe(3);
    });

    it('returns null when student has no ratings', () => {
      saveTermRatings(CID, {});
      expect(getStudentTermRating(CID, 'stu1', 'term1')).toBeNull();
    });

    it('returns null when term not found', () => {
      saveTermRatings(CID, { stu1: { term1: { narrative: 'x' } } });
      expect(getStudentTermRating(CID, 'stu1', 'term2')).toBeNull();
    });
  });

  describe('upsertTermRating', () => {
    it('creates a new rating without the old nine dims', () => {
      saveTermRatings(CID, {});
      upsertTermRating(CID, 'stu1', 'term1', { narrative: 'First report' });
      const result = getStudentTermRating(CID, 'stu1', 'term1');
      expect(result.narrative).toBe('First report');
      expect(result.dims).toBeUndefined();
      expect(result.created).toBeDefined();
      expect(result.modified).toBeDefined();
    });

    it('merges data into existing rating', () => {
      saveTermRatings(CID, {
        stu1: { term1: { dims: { engagement: 2 }, narrative: 'Old', created: '2025-01-01', modified: '2025-01-01' } },
      });
      upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Updated' });
      const result = getStudentTermRating(CID, 'stu1', 'term1');
      expect(result.narrative).toBe('Updated');
      expect(result.dims.engagement).toBe(2); // preserved
    });

    it('sets modified timestamp on update', () => {
      saveTermRatings(CID, {
        stu1: { term1: { dims: {}, narrative: '', created: '2025-01-01T00:00:00Z', modified: '2025-01-01T00:00:00Z' } },
      });
      upsertTermRating(CID, 'stu1', 'term1', { narrative: 'New' });
      const result = getStudentTermRating(CID, 'stu1', 'term1');
      expect(result.modified).not.toBe('2025-01-01T00:00:00Z');
    });

    it('preserves existing dims when updating only narrative', () => {
      saveTermRatings(CID, {});
      upsertTermRating(CID, 'stu1', 'term1', { dims: { engagement: 4, collaboration: 3 } });
      upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Added narrative' });
      const result = getStudentTermRating(CID, 'stu1', 'term1');
      expect(result.dims.engagement).toBe(4);
      expect(result.narrative).toBe('Added narrative');
    });

    it('calls v2 save_term_rating via window.v2.saveTermRating when enrollment id is a UUID', async () => {
      const rpcCalls = [];
      _useSupabase = true;
      _cache.students[CANONICAL_CID] = [
        {
          id: ENROLLMENT_ID,
          personId: STUDENT_ID,
          firstName: 'Ada',
          lastName: 'Lovelace',
          designations: [],
          sortName: 'Lovelace Ada',
        },
      ];
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return Promise.resolve({ error: null });
        },
      });

      // `termId` must be a numeric 1..6 to pass the v2 guard; legacy 'term1'
      // no longer dispatches remotely.
      upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 1, { narrative: 'Canonical write' });
      await Promise.resolve();

      const call = rpcCalls.find(function (c) {
        return c.name === 'save_term_rating';
      });
      expect(call).toBeDefined();
      expect(call.payload.p_enrollment_id).toBe(ENROLLMENT_ID);
      expect(call.payload.p_term).toBe(1);
      expect(call.payload.p_payload.narrative_html).toBe('Canonical write');
    });

    it('an edited comment clears its approval; the same text keeps it', () => {
      saveTermRatings(CID, {});
      upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term.', approvedAt: '2026-10-28T10:00:00Z' });
      upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term.' });
      expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBe('2026-10-28T10:00:00Z');
      upsertTermRating(CID, 'stu1', 'term-2', { habits: { completes: 4 } });
      expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBe('2026-10-28T10:00:00Z');
      upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term. Edited.' });
      expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBeNull();
    });

    it('sends habits and approval to save_term_rating', async () => {
      const rpcCalls = [];
      _useSupabase = true;
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return Promise.resolve({ error: null });
        },
      });
      upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', {
        habits: { completes: 4, part: 2, ready: 0, kindness: 3 },
        approvedAt: '2026-10-28T10:00:00Z',
      });
      upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', { approvedAt: null });
      await Promise.resolve();
      const calls = rpcCalls.filter(c => c.name === 'save_term_rating');
      expect(calls[0].payload.p_term).toBe(2);
      expect(calls[0].payload.p_payload).toEqual({ habits: { completes: 4, part: 2 }, approved: true });
      expect(calls[1].payload.p_payload).toEqual({ approved: false });
    });

    it('never sends the old dims', async () => {
      const rpcCalls = [];
      _useSupabase = true;
      globalThis.getSupabase = () => ({
        rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return Promise.resolve({ error: null });
        },
      });
      upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', { dims: { engagement: 3 } });
      await Promise.resolve();
      expect(rpcCalls.filter(c => c.name === 'save_term_rating')).toHaveLength(0);
    });
  });

  describe('_applyBundleTermRatings', () => {
    it('reads habits and approved_at back from the bundle', () => {
      _applyBundleTermRatings(CANONICAL_CID, [
        {
          enrollment_id: ENROLLMENT_ID,
          term: 2,
          narrative_html: 'Steady term.',
          habits: { completes: 4, devices: 5 },
          approved_at: '2026-10-28T10:00:00Z',
        },
        { enrollment_id: STUDENT_ID, term: 1, narrative_html: '' },
      ]);
      const r = getStudentTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2');
      expect(r.habits).toEqual({ completes: 4, devices: 5 });
      expect(r.approvedAt).toBe('2026-10-28T10:00:00Z');
      const old = getStudentTermRating(CANONICAL_CID, STUDENT_ID, 'term-1');
      expect(old.habits).toEqual({});
      expect(old.approvedAt).toBeNull();
    });

    it('keeps the old dims this device has', () => {
      saveTermRatings(CANONICAL_CID, { [ENROLLMENT_ID]: { 'term-2': { dims: { engagement: 3 } } } });
      _applyBundleTermRatings(CANONICAL_CID, [{ enrollment_id: ENROLLMENT_ID, term: 2, narrative_html: 'x' }]);
      expect(getStudentTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2').dims).toEqual({ engagement: 3 });
    });
  });
});
