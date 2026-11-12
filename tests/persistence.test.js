/**
 * persistence: the tests that were tests/persistence-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('persistence-assessment-delete-observations', () => {
  /**
   * Persistence: dispatch delete_observation when an assessment is deleted (P6.5).
   *
   * Background: observations reference assessments through a JSON
   * `assignmentContext` field (no FK), so DB-level cascade does not reach
   * them. Deleting an assessment used to call saveQuickObs(cid, obs) which
   * is bare LS-only — server rows survived with stale assessmentId and
   * reappeared on reload. This file pins the new helper that filters LS +
   * dispatches delete_observation per affected observation.
   */

  const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const AID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const OTHER_AID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const OB_1 = '11111111-1111-4111-8111-111111111111';
  const OB_2 = '22222222-2222-4222-8222-222222222222';
  const OB_OTHER = '33333333-3333-4333-8333-333333333333';

  function makeRpcRecorder() {
    var calls = [];
    return {
      calls: calls,
      rpc: function (name, payload) {
        calls.push({ name: name, payload: payload });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('Persistence: deleteAssessmentObservations (P6.5)', () => {
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      if (_cache.observations[CID] !== undefined) _cache.observations[CID] = undefined;
      localStorage.clear();
      globalThis.COURSES = {};
      globalThis.COURSES[CID] = { id: CID, name: 'A' };
      // Seed three observations: two linked to AID, one to OTHER_AID.
      saveQuickObs(CID, {
        's-1': [
          { id: OB_1, text: 'Linked to AID', assignmentContext: { assessmentId: AID } },
          { id: OB_OTHER, text: 'Linked to OTHER_AID', assignmentContext: { assessmentId: OTHER_AID } },
        ],
        's-2': [{ id: OB_2, text: 'Also AID', assignmentContext: { assessmentId: AID } }],
      });
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    it('removes only observations whose assignmentContext matches the deleted aid', () => {
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      var n = deleteAssessmentObservations(CID, AID);
      expect(n).toBe(2);

      var remaining = getQuickObs(CID);
      expect(remaining['s-1']).toHaveLength(1);
      expect(remaining['s-1'][0].id).toBe(OB_OTHER);
      expect(remaining['s-2']).toHaveLength(0);
    });

    it('dispatches delete_observation RPC for each removed observation with a UUID', () => {
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      deleteAssessmentObservations(CID, AID);

      var deletes = client.calls.filter(function (c) {
        return c.name === 'delete_observation';
      });
      expect(deletes).toHaveLength(2);
      var deletedIds = deletes
        .map(function (c) {
          return c.payload.p_id;
        })
        .sort();
      expect(deletedIds).toEqual([OB_1, OB_2].sort());
      // OTHER_AID's observation must NOT have been deleted.
      expect(deletedIds).not.toContain(OB_OTHER);
    });

    it('returns 0 and dispatches no RPCs when no observations match the aid', () => {
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      var n = deleteAssessmentObservations(CID, 'nonexistent-aid');
      expect(n).toBe(0);
      expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);
    });

    it('skips delete_observation RPC for observations with non-UUID ids', () => {
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;
      // Add an observation with a local string id (not yet synced).
      saveQuickObs(CID, {
        's-1': [
          { id: 'local-obs-abc', text: 'Local obs', assignmentContext: { assessmentId: AID } },
          { id: OB_1, text: 'Canonical obs', assignmentContext: { assessmentId: AID } },
        ],
      });

      var n = deleteAssessmentObservations(CID, AID);
      expect(n).toBe(2); // Both removed from LS.

      var deletes = client.calls.filter(function (c) {
        return c.name === 'delete_observation';
      });
      // Only the UUID one should hit the canonical store.
      expect(deletes).toHaveLength(1);
      expect(deletes[0].payload.p_id).toBe(OB_1);
    });

    it('does not dispatch RPCs in demo mode', () => {
      localStorage.setItem('gb-demo-mode', '1');
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      var n = deleteAssessmentObservations(CID, AID);
      expect(n).toBe(2); // LS still cleaned.
      expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);

      localStorage.removeItem('gb-demo-mode');
    });

    it('does not dispatch RPCs when _useSupabase is false', () => {
      _useSupabase = false;
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      var n = deleteAssessmentObservations(CID, AID);
      expect(n).toBe(2);
      expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);
    });

    it('returns 0 cleanly for falsy inputs', () => {
      expect(deleteAssessmentObservations('', AID)).toBe(0);
      expect(deleteAssessmentObservations(CID, '')).toBe(0);
      expect(deleteAssessmentObservations(null, AID)).toBe(0);
      expect(deleteAssessmentObservations(CID, null)).toBe(0);
    });

    it('integration: silent dataloss regression guard for assessment-delete cascade', () => {
      var client = makeRpcRecorder();
      globalThis.getSupabase = () => client;

      // Before delete: 3 observations across 2 students.
      expect(Object.keys(getQuickObs(CID))).toHaveLength(2);
      var totalBefore = Object.values(getQuickObs(CID)).reduce(function (a, arr) {
        return a + arr.length;
      }, 0);
      expect(totalBefore).toBe(3);

      // Simulate the assignment-delete cascade.
      deleteAssessmentObservations(CID, AID);

      // After delete: AID-linked observations gone from LS, RPCs fired.
      var after = getQuickObs(CID);
      var totalAfter = Object.values(after).reduce(function (a, arr) {
        return a + arr.length;
      }, 0);
      expect(totalAfter).toBe(1);
      expect(after['s-1'][0].id).toBe(OB_OTHER);
      expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(2);
    });
  });
});

describe('persistence-custom-tag-delete', () => {
  /**
   * Persistence custom-tag delete (P6.3) — tests the delete branch added to
   * _persistCustomTagsToCanonical, plus the label→uuid bookkeeping.
   *
   * Background: removeCustomTag was LS-only before this change because the
   * old _persistCustomTagsToCanonical only iterated additions. With the new
   * delete branch, removed labels dispatch delete_custom_tag(p_id) when the
   * uuid is cached, or delete_custom_tag_by_label(course, label) otherwise.
   */

  const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TAG_FOO_ID = '11111111-1111-4111-8111-111111111111';
  const TAG_BAR_ID = '22222222-2222-4222-8222-222222222222';

  function makeRpcRecorder(responses) {
    responses = responses || {};
    var calls = [];
    return {
      calls: calls,
      rpc: function (name, payload) {
        calls.push({ name: name, payload: payload });
        var resp = responses[name];
        if (typeof resp === 'function') return Promise.resolve(resp(payload));
        if (resp !== undefined) return Promise.resolve(resp);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  describe('Persistence custom-tag delete (P6.3)', () => {
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _supabaseDegraded = false;
      _pendingLocalCids.clear();
      Object.keys(_customTagIds).forEach(function (k) {
        delete _customTagIds[k];
      });
      if (_cache.customTags && _cache.customTags[CID] !== undefined) _cache.customTags[CID] = undefined;
      localStorage.clear();
      globalThis.COURSES = {};
      globalThis.COURSES[CID] = { id: CID, name: 'A', gradingSystem: 'proficiency' };
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      Object.keys(_customTagIds).forEach(function (k) {
        delete _customTagIds[k];
      });
    });

    describe('add path caches uuid in _customTagIds', () => {
      it('populates _customTagIds[cid][label] from create_custom_tag response', async () => {
        var client = makeRpcRecorder({
          create_custom_tag: function (payload) {
            return { data: payload.p_label === 'Foo' ? TAG_FOO_ID : TAG_BAR_ID, error: null };
          },
        });
        globalThis.getSupabase = () => client;

        saveCustomTags(CID, ['Foo']);
        // Drain the save queue (microtask fan-out).
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        expect(_customTagIds[CID]).toBeDefined();
        expect(_customTagIds[CID].Foo).toBe(TAG_FOO_ID);
        expect(client.calls).toHaveLength(1);
        expect(client.calls[0].name).toBe('create_custom_tag');
      });
    });

    describe('delete path with cached uuid', () => {
      it('dispatches delete_custom_tag(p_id) when uuid is cached', async () => {
        var client = makeRpcRecorder({
          create_custom_tag: { data: TAG_FOO_ID, error: null },
          delete_custom_tag: { data: null, error: null },
        });
        globalThis.getSupabase = () => client;

        saveCustomTags(CID, ['Foo']);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });
        expect(_customTagIds[CID].Foo).toBe(TAG_FOO_ID);

        // Now remove "Foo".
        saveCustomTags(CID, []);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        var deleteCall = client.calls.find(function (c) {
          return c.name === 'delete_custom_tag';
        });
        expect(deleteCall, 'delete_custom_tag should have been called').toBeDefined();
        expect(deleteCall.payload.p_id).toBe(TAG_FOO_ID);
        // No fallback should fire since uuid was cached.
        expect(client.calls.find(c => c.name === 'delete_custom_tag_by_label')).toBeUndefined();
        // Cache cleared after successful delete.
        expect(_customTagIds[CID].Foo).toBeUndefined();
      });

      it('only dispatches deletes for labels removed (not still-present labels)', async () => {
        var client = makeRpcRecorder({
          create_custom_tag: function (payload) {
            return { data: payload.p_label === 'Foo' ? TAG_FOO_ID : TAG_BAR_ID, error: null };
          },
          delete_custom_tag: { data: null, error: null },
        });
        globalThis.getSupabase = () => client;

        saveCustomTags(CID, ['Foo', 'Bar']);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        // Remove Foo, keep Bar.
        saveCustomTags(CID, ['Bar']);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        var deletes = client.calls.filter(function (c) {
          return c.name === 'delete_custom_tag';
        });
        expect(deletes).toHaveLength(1);
        expect(deletes[0].payload.p_id).toBe(TAG_FOO_ID);
      });
    });

    describe('delete path with no cached uuid (cross-session fallback)', () => {
      it('falls through to delete_custom_tag_by_label when uuid is unknown', async () => {
        var client = makeRpcRecorder({
          delete_custom_tag_by_label: { data: 1, error: null },
        });
        globalThis.getSupabase = () => client;

        // Simulate cross-session state: LS already has the tag but cache is empty.
        _safeLSSet('gb-custom-tags-' + CID, JSON.stringify(['Foo']));
        _cache.customTags[CID] = ['Foo']; // Simulate hydration.
        // _customTagIds[CID] is empty — no uuid known.

        // User removes "Foo".
        saveCustomTags(CID, []);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        var byLabel = client.calls.find(function (c) {
          return c.name === 'delete_custom_tag_by_label';
        });
        expect(byLabel, 'delete_custom_tag_by_label should fire as fallback').toBeDefined();
        expect(byLabel.payload.p_course_id).toBe(CID);
        expect(byLabel.payload.p_label).toBe('Foo');
        // No delete_custom_tag call since we don't have the uuid.
        expect(client.calls.find(c => c.name === 'delete_custom_tag')).toBeUndefined();
      });
    });

    describe('skip conditions', () => {
      it('does not dispatch any RPC when in demo mode', async () => {
        var client = makeRpcRecorder({});
        globalThis.getSupabase = () => client;
        localStorage.setItem('gb-demo-mode', '1');

        saveCustomTags(CID, ['Foo']);
        saveCustomTags(CID, []);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        expect(client.calls).toHaveLength(0);
        localStorage.removeItem('gb-demo-mode');
      });

      it('does not dispatch when _useSupabase is false', async () => {
        _useSupabase = false;
        var client = makeRpcRecorder({});
        globalThis.getSupabase = () => client;

        saveCustomTags(CID, ['Foo']);
        saveCustomTags(CID, []);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        expect(client.calls).toHaveLength(0);
      });

      it('does not dispatch when cid is not a UUID', async () => {
        var client = makeRpcRecorder({});
        globalThis.getSupabase = () => client;

        saveCustomTags('non-uuid', ['Foo']);
        saveCustomTags('non-uuid', []);
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        expect(client.calls).toHaveLength(0);
      });
    });

    describe('integration — remove-then-reload regression guard', () => {
      it('removed tag does not leave a canonical row behind (issued delete RPC)', async () => {
        var client = makeRpcRecorder({
          create_custom_tag: { data: TAG_FOO_ID, error: null },
          delete_custom_tag: { data: null, error: null },
        });
        globalThis.getSupabase = () => client;

        // 1. Add a tag → caches uuid.
        addCustomTag(CID, 'Foo');
        await new Promise(function (r) {
          setTimeout(r, 10);
        });
        expect(getCustomTags(CID)).toContain('Foo');

        // 2. Remove the tag → dispatches delete RPC.
        removeCustomTag(CID, 'Foo');
        await new Promise(function (r) {
          setTimeout(r, 10);
        });

        expect(getCustomTags(CID)).not.toContain('Foo');
        var deleted = client.calls.filter(function (c) {
          return c.name === 'delete_custom_tag';
        });
        expect(deleted, 'delete RPC must have fired so canonical row is removed').toHaveLength(1);
        expect(deleted[0].payload.p_id).toBe(TAG_FOO_ID);
      });
    });
  });
});

describe('persistence-pending-cid-replay', () => {
  /**
   * Persistence pending-cid replay (P6.2) — tests the cid-UUID race fix.
   *
   * Background: createCourse mints a local id (e.g. "cabc123") synchronously
   * and fires create_course async. Any persist call against the local id
   * during the in-flight window writes to LS under the local id and short-
   * circuits at the !_isUuid(cid) gate. Without the migration helper, those
   * writes were stranded under "gb-{kind}-{localId}" and never reached the
   * canonical store after the canonical UUID arrived. This file pins the
   * migrate-and-replay contract.
   */

  const CANONICAL_CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function clearAllCacheBuckets() {
    Object.keys(_cache).forEach(function (field) {
      var bucket = _cache[field];
      if (bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
        Object.keys(bucket).forEach(function (k) {
          delete bucket[k];
        });
      }
    });
  }

  describe('Persistence pending-cid replay (P6.2)', () => {
    var originalUseSupabase;
    var originalShowSyncToast;
    var originalDismissSyncToast;

    beforeEach(() => {
      originalUseSupabase = _useSupabase;
      originalShowSyncToast = globalThis.showSyncToast;
      originalDismissSyncToast = globalThis.dismissSyncToast;
      globalThis.showSyncToast = function () {};
      globalThis.dismissSyncToast = function () {};
      _useSupabase = false; // Tests don't need real Supabase wiring; the migration helper is pure.
      _supabaseDegraded = false;
      _pendingLocalCids.clear();
      clearAllCacheBuckets();
      localStorage.clear();
      globalThis.COURSES = {};
    });

    afterEach(() => {
      _useSupabase = originalUseSupabase;
      globalThis.showSyncToast = originalShowSyncToast;
      globalThis.dismissSyncToast = originalDismissSyncToast;
      _pendingLocalCids.clear();
      clearAllCacheBuckets();
    });

    describe('hasPendingLocalCid', () => {
      it('returns true for a cid in the pending set', () => {
        _pendingLocalCids.add('cabc123');
        expect(window.GB.hasPendingLocalCid('cabc123')).toBe(true);
      });

      it('returns false for an id not in the set', () => {
        expect(window.GB.hasPendingLocalCid('cother')).toBe(false);
      });

      it('returns false for falsy input', () => {
        expect(window.GB.hasPendingLocalCid('')).toBe(false);
        expect(window.GB.hasPendingLocalCid(null)).toBe(false);
        expect(window.GB.hasPendingLocalCid(undefined)).toBe(false);
      });
    });

    describe('_migrateCourseDataLocalToCanonical', () => {
      it('moves LS keys from local id to canonical id', () => {
        var localId = 'cabc123';
        var students = [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }];
        _safeLSSet('gb-students-' + localId, JSON.stringify(students));

        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);

        expect(localStorage.getItem('gb-students-' + localId)).toBeNull();
        expect(localStorage.getItem('gb-students-' + CANONICAL_CID)).not.toBeNull();
        var migrated = JSON.parse(localStorage.getItem('gb-students-' + CANONICAL_CID));
        expect(migrated).toHaveLength(1);
        expect(migrated[0].id).toBe('s1');
      });

      it('migrates every per-course data kind', () => {
        var localId = 'cabc123';
        _safeLSSet('gb-students-' + localId, '[{"id":"s1"}]');
        _safeLSSet('gb-scores-' + localId, '{"s1":[]}');
        _safeLSSet('gb-assessments-' + localId, '[{"id":"a1"}]');
        _safeLSSet('gb-modules-' + localId, '[]');
        _safeLSSet('gb-rubrics-' + localId, '[]');
        _safeLSSet('gb-notes-' + localId, '{}');
        _safeLSSet('gb-custom-tags-' + localId, '[]');
        _safeLSSet('gb-statuses-' + localId, '{}');
        _safeLSSet('gb-categories-' + localId, '[]');
        _safeLSSet('gb-learningmap-' + localId, '{"subjects":[],"sections":[]}');

        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);

        [
          'gb-students-',
          'gb-scores-',
          'gb-assessments-',
          'gb-modules-',
          'gb-rubrics-',
          'gb-notes-',
          'gb-custom-tags-',
          'gb-statuses-',
          'gb-categories-',
          'gb-learningmap-',
        ].forEach(function (prefix) {
          expect(localStorage.getItem(prefix + localId), prefix + 'localId should be removed').toBeNull();
          expect(localStorage.getItem(prefix + CANONICAL_CID), prefix + 'canonicalId should exist').not.toBeNull();
        });
      });

      it('clears cache for both local and canonical ids before replay', () => {
        var localId = 'cabc123';
        _cache.students[localId] = [{ id: 's1' }];
        _cache.students[CANONICAL_CID] = [{ id: 'stale' }]; // simulate a stale canonical entry
        _safeLSSet('gb-students-' + localId, '[{"id":"s1","firstName":"A","lastName":"B","designations":[]}]');

        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);

        // The replay calls saveStudents which re-populates _cache.students[CANONICAL_CID]
        // from the migrated user-edits, so we should see s1 (not "stale").
        expect(_cache.students[CANONICAL_CID]).toHaveLength(1);
        expect(_cache.students[CANONICAL_CID][0].id).toBe('s1');
        expect(_cache.students[localId]).toBeUndefined();
      });

      it('is a no-op when localId === canonicalId', () => {
        var same = CANONICAL_CID;
        _safeLSSet('gb-students-' + same, '[{"id":"s1"}]');
        _migrateCourseDataLocalToCanonical(same, same);
        expect(localStorage.getItem('gb-students-' + same)).not.toBeNull();
      });

      it('is a no-op when either id is falsy', () => {
        _safeLSSet('gb-students-' + 'cabc123', '[{"id":"s1"}]');
        _migrateCourseDataLocalToCanonical('', CANONICAL_CID);
        _migrateCourseDataLocalToCanonical('cabc123', '');
        expect(localStorage.getItem('gb-students-cabc123')).not.toBeNull();
      });

      it('handles fields with no LS entry by falling back to cache', () => {
        var localId = 'cabc123';
        _cache.notes[localId] = { e1: 'A note' };
        // No LS entry for notes — only in cache.

        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);

        // saveNotes called from replay should write to LS+cache under canonical id.
        expect(_cache.notes[CANONICAL_CID]).toEqual({ e1: 'A note' });
        expect(_cache.notes[localId]).toBeUndefined();
      });
    });

    describe('integration — silent dataloss regression guard for createCourse race', () => {
      it('writes during the pending window land under canonical id after migration', () => {
        // Step 1: createCourse-like setup. Mint a local id, mark it pending.
        var localId = 'cabc123';
        _pendingLocalCids.add(localId);

        // Step 2: user adds a student under the local id. saveStudents writes
        // LS under localId; the !_isUuid(cid) gate prevents the canonical
        // dispatch (which is fine — that's why we have the migration).
        saveStudents(localId, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
        expect(localStorage.getItem('gb-students-' + localId)).not.toBeNull();
        expect(localStorage.getItem('gb-students-' + CANONICAL_CID)).toBeNull();

        // Step 3: create_course returns the canonical UUID — migration runs.
        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);
        _pendingLocalCids.delete(localId);

        // Step 4: data is reachable under canonical id, gone under local id.
        expect(getStudents(CANONICAL_CID)).toHaveLength(1);
        expect(getStudents(CANONICAL_CID)[0].firstName).toBe('Alice');
        expect(localStorage.getItem('gb-students-' + localId)).toBeNull();
      });

      it('preserves multiple entity kinds written during the pending window', () => {
        var localId = 'cabc123';
        _pendingLocalCids.add(localId);

        saveStudents(localId, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
        saveAssessments(localId, [{ id: 'a1', title: 'Quiz', date: '2026-05-01', type: 'summative' }]);
        saveModules(localId, [{ id: 'm1', name: 'Unit 1', color: '#ff0000' }]);
        saveCustomTags(localId, ['Homework']);

        _migrateCourseDataLocalToCanonical(localId, CANONICAL_CID);
        _pendingLocalCids.delete(localId);

        expect(getStudents(CANONICAL_CID)).toHaveLength(1);
        expect(getAssessments(CANONICAL_CID)).toHaveLength(1);
        expect(getModules(CANONICAL_CID)).toHaveLength(1);
        expect(getCustomTags(CANONICAL_CID)).toEqual(['Homework']);
      });
    });
  });
});

describe('persistence-student-withdraw', () => {
  /**
   * Persistence: removing a student withdraws them (2026-10-19).
   *
   * Background: the roster's remove button hard-deleted the student through
   * delete_student, taking every score, observation and report with them.
   * docs/DECISIONS.md: "Students are removed by withdrawal, not deletion;
   * hard delete stays behind a second step." withdrawStudent sends
   * withdraw_student and moves the student's records out of the class into
   * the Withdrawn list; reenrolStudent puts them back; deleteWithdrawnStudent
   * is the permanent delete and only takes a withdrawn student.
   */

  const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const SID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const OTHER_SID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const AID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  function makeRpcRecorder() {
    var calls = [];
    return {
      calls: calls,
      rpc: function (name, payload) {
        calls.push({ name: name, payload: payload });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function seedStudentData() {
    _saveCourseField('students', CID, [
      { id: SID, firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' },
      { id: OTHER_SID, firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' },
    ]);
    _saveCourseField('scores', CID, {
      [SID]: [{ id: 'sc1', assessmentId: AID, tagId: null, score: 3, type: 'summative' }],
      [OTHER_SID]: [{ id: 'sc2', assessmentId: AID, tagId: null, score: 4, type: 'summative' }],
    });
    _saveCourseField('goals', CID, { [SID]: { 'sec-1': 'Be more focused' }, [OTHER_SID]: { 'sec-1': 'Read more' } });
    _saveCourseField('reflections', CID, { [SID]: { 'sec-1': { confidence: 4, text: '' } } });
    _saveCourseField('notes', CID, { [SID]: 'Met with parent' });
    _saveCourseField('flags', CID, { [SID]: true });
    _saveCourseField('overrides', CID, { [SID]: { 'sec-1': { level: 2, reason: 'IEP' } } });
    _saveCourseField('statuses', CID, {
      [SID + ':' + AID]: 'NS',
      [OTHER_SID + ':' + AID]: 'LATE',
    });
    _saveCourseField('observations', CID, {
      [SID]: [{ id: 'ob1', text: 'Observation A' }],
    });
    _saveCourseField('termRatings', CID, { [SID]: { 1: { dims: {}, narrative: 'Term 1' } } });
  }

  async function tick() {
    for (var i = 0; i < 5; i++) await Promise.resolve();
  }

  describe('Persistence: withdraw a student', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _supabaseDegraded = false;
      Object.keys(_cache).forEach(function (k) {
        var bucket = _cache[k];
        if (bucket && typeof bucket === 'object' && !Array.isArray(bucket) && bucket[CID] !== undefined) {
          bucket[CID] = undefined;
        }
      });
      localStorage.clear();
      globalThis.COURSES = {};
      globalThis.COURSES[CID] = { id: CID, name: 'A', gradingSystem: 'proficiency' };
      client = makeRpcRecorder();
      globalThis.getSupabase = () => client;
      seedStudentData();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      localStorage.removeItem('gb-demo-mode');
    });

    function names() {
      return client.calls.map(c => c.name);
    }

    it('sends withdraw_student with the enrollment id and nothing that deletes', async () => {
      withdrawStudent(CID, SID);
      await tick();

      var call = client.calls.find(c => c.name === 'withdraw_student');
      expect(call, 'withdraw_student must fire').toBeDefined();
      expect(call.payload.p_enrollment_id).toBe(SID);
      expect(names()).not.toContain('delete_student');
      expect(names()).not.toContain('delete_withdrawn_student');
      expect(names()).not.toContain('withdraw_enrollment');
      expect(names()).not.toContain('clear_score');
      expect(names()).not.toContain('save_term_rating');
      expect(names()).not.toContain('delete_note');
    });

    it("moves the student's records out of the class and keeps them on the entry", () => {
      var entry = withdrawStudent(CID, SID);

      expect(getStudents(CID).map(s => s.id)).toEqual([OTHER_SID]);
      [getScores, getGoals, getReflections, getNotes, getFlags, getQuickObs, getTermRatings, getOverrides].forEach(
        function (get) {
          expect(get(CID)[SID]).toBeUndefined();
        },
      );
      expect(getScores(CID)[OTHER_SID]).toHaveLength(1);
      expect(getGoals(CID)[OTHER_SID]).toEqual({ 'sec-1': 'Read more' });
      expect(getAssignmentStatuses(CID)).toEqual({ [OTHER_SID + ':' + AID]: 'LATE' });

      expect(entry.student.id).toBe(SID);
      expect(entry.index).toBe(0);
      expect(entry.withdrawnAt).toBeTruthy();
      expect(entry.records.scores).toHaveLength(1);
      expect(entry.records.goals).toEqual({ 'sec-1': 'Be more focused' });
      expect(entry.records.notes).toBe('Met with parent');
      expect(entry.records.flags).toBe(true);
      expect(entry.records.overrides).toBeDefined();
      expect(entry.records.observations).toHaveLength(1);
      expect(entry.records.termRatings).toBeDefined();
      expect(entry.records.statuses).toEqual({ [SID + ':' + AID]: 'NS' });
      expect(getWithdrawnStudents(CID)).toEqual([entry]);
      // Saved, so it survives a reload.
      expect(JSON.parse(localStorage.getItem('gb-withdrawn-' + CID))[0].student.id).toBe(SID);
    });

    it('re-enrol sends reenrol_student and puts everything back where it was', async () => {
      withdrawStudent(CID, SID);
      expect(reenrolStudent(CID, SID)).toBe(true);
      await tick();

      expect(getStudents(CID).map(s => s.id)).toEqual([SID, OTHER_SID]);
      expect(getScores(CID)[SID]).toHaveLength(1);
      expect(getGoals(CID)[SID]).toEqual({ 'sec-1': 'Be more focused' });
      expect(getNotes(CID)[SID]).toBe('Met with parent');
      expect(getFlags(CID)[SID]).toBe(true);
      expect(getQuickObs(CID)[SID]).toHaveLength(1);
      expect(getTermRatings(CID)[SID]).toBeDefined();
      expect(getAssignmentStatuses(CID)[SID + ':' + AID]).toBe('NS');
      expect(getWithdrawnStudents(CID)).toEqual([]);
      var call = client.calls.find(c => c.name === 'reenrol_student');
      expect(call.payload.p_enrollment_id).toBe(SID);
      expect(names()).not.toContain('create_student_and_enroll');
    });

    it('deletes only a withdrawn student, with delete_withdrawn_student', async () => {
      expect(deleteWithdrawnStudent(CID, SID)).toBe(false);
      await tick();
      expect(names()).not.toContain('delete_withdrawn_student');

      withdrawStudent(CID, SID);
      expect(deleteWithdrawnStudent(CID, SID)).toBe(true);
      await tick();

      var call = client.calls.find(c => c.name === 'delete_withdrawn_student');
      expect(call.payload.p_enrollment_id).toBe(SID);
      expect(getWithdrawnStudents(CID)).toEqual([]);
      expect(getStudents(CID).map(s => s.id)).toEqual([OTHER_SID]);
      expect(getScores(CID)[SID]).toBeUndefined();
      expect(names()).not.toContain('delete_student');
    });

    it('takes a permanently deleted student out of pairs and groups', () => {
      _saveCourseField('assessments', CID, [
        { id: AID, title: 'Lab', type: 'summative', tagIds: [], pairs: [[SID, OTHER_SID]], excludedStudents: [SID] },
      ]);
      withdrawStudent(CID, SID);
      // Withdrawal leaves them in place, so re-enrol finds the pairs as they were.
      expect(getAssessments(CID)[0].pairs).toEqual([[SID, OTHER_SID]]);

      deleteWithdrawnStudent(CID, SID);

      expect(getAssessments(CID)[0].pairs).toEqual([[OTHER_SID]]);
      expect(getAssessments(CID)[0].excludedStudents).toBeUndefined();
    });

    it('sends nothing in Demo Mode, and the Withdrawn list still works', async () => {
      localStorage.setItem('gb-demo-mode', '1');

      withdrawStudent(CID, SID);
      expect(getWithdrawnStudents(CID).map(w => w.student.id)).toEqual([SID]);
      reenrolStudent(CID, SID);
      expect(getStudents(CID).map(s => s.id)).toEqual([SID, OTHER_SID]);
      withdrawStudent(CID, SID);
      deleteWithdrawnStudent(CID, SID);
      await tick();

      expect(getWithdrawnStudents(CID)).toEqual([]);
      expect(client.calls).toHaveLength(0);
    });

    it('sends nothing when _useSupabase is false', async () => {
      _useSupabase = false;

      withdrawStudent(CID, SID);
      await tick();

      expect(client.calls).toHaveLength(0);
      expect(getStudents(CID).map(s => s.id)).toEqual([OTHER_SID]);
    });

    it("re-keys a withdrawn student's records when an assessment gets its server id", () => {
      var NEW_AID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      _saveCourseField('scores', CID, {
        [SID]: [{ id: 'sc1', assessmentId: 'aLOCAL1', tagId: null, score: 3, type: 'summative' }],
      });
      _saveCourseField('statuses', CID, { [SID + ':aLOCAL1']: 'LATE' });
      withdrawStudent(CID, SID);

      _rekey(CID, 'assessment', 'aLOCAL1', NEW_AID);

      var records = getWithdrawnStudents(CID)[0].records;
      expect(records.scores[0].assessmentId).toBe(NEW_AID);
      expect(records.statuses).toEqual({ [SID + ':' + NEW_AID]: 'LATE' });
      reenrolStudent(CID, SID);
      expect(getScores(CID)[SID][0].assessmentId).toBe(NEW_AID);
    });

    it("does not change another student's grade or the class average", () => {
      var POINTS = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      var quiz = { id: POINTS, title: 'Quiz', type: 'summative', scoreMode: 'points', maxPoints: 10, tagIds: [] };
      _saveCourseField('assessments', CID, [quiz]);
      _saveCourseField('scores', CID, {
        [SID]: [{ id: 'p1', assessmentId: POINTS, tagId: null, score: 1, type: 'summative' }],
        [OTHER_SID]: [{ id: 'p2', assessmentId: POINTS, tagId: null, score: 9, type: 'summative' }],
      });
      var otherBefore = getCourseLetterData(CID, OTHER_SID);
      expect(getClassPointsAverage(CID, getStudents(CID), quiz).pct).toBe(50);

      withdrawStudent(CID, SID);

      expect(getClassPointsAverage(CID, getStudents(CID), quiz).pct).toBe(90);
      expect(getCourseLetterData(CID, OTHER_SID)).toEqual(otherBefore);
    });
  });

  describe('Withdrawn students from the class bundle', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.withdrawn[CID] = undefined;
      _cache.observations[CID] = undefined;
      _cache.termRatings[CID] = undefined;
    });

    it('lists the server rows, newest first, and keeps records this device saved', () => {
      _saveCourseField('withdrawn', CID, [
        { student: { id: SID, firstName: 'Alice' }, withdrawnAt: 'x', index: 3, records: { notes: 'kept' } },
      ]);

      _applyBundleWithdrawn(CID, [
        { enrollment_id: OTHER_SID, student_id: 'p2', first_name: 'Bob', withdrawn_at: '2026-10-18T10:00:00Z' },
        { enrollment_id: SID, student_id: 'p1', first_name: 'Alice', withdrawn_at: '2026-10-19T10:00:00Z' },
      ]);

      var list = getWithdrawnStudents(CID);
      expect(list.map(w => w.student.id)).toEqual([SID, OTHER_SID]);
      expect(list[0].records).toEqual({ notes: 'kept' });
      expect(list[0].index).toBe(3);
      expect(list[0].student.personId).toBe('p1');
      expect(list[1].records).toBeUndefined();
    });

    it('drops an entry the server no longer lists (re-enrolled or deleted elsewhere)', () => {
      _saveCourseField('withdrawn', CID, [{ student: { id: SID, firstName: 'Alice' }, withdrawnAt: 'x' }]);

      _applyBundleWithdrawn(CID, []);

      expect(getWithdrawnStudents(CID)).toEqual([]);
    });

    it('keeps a student withdrawn before they ever reached the server', () => {
      _saveCourseField('withdrawn', CID, [{ student: { id: 'sLOCAL1', firstName: 'Lo' }, withdrawnAt: 'x' }]);

      _applyBundleWithdrawn(CID, []);

      expect(getWithdrawnStudents(CID).map(w => w.student.id)).toEqual(['sLOCAL1']);
    });

    it("leaves a withdrawn student's observations and term ratings out of the class", () => {
      _saveCourseField('withdrawn', CID, [{ student: { id: SID }, withdrawnAt: 'x' }]);

      var blob = _observationsPayloadToBlob(
        {
          observations: [
            { id: 'o1', body: 'Both', enrollment_ids: [SID, OTHER_SID], created_at: '2026-10-01T12:00:00Z' },
            { id: 'o2', body: 'Only Alice', enrollment_ids: [SID], created_at: '2026-10-02T12:00:00Z' },
          ],
        },
        CID,
      );
      expect(Object.keys(blob)).toEqual([OTHER_SID]);
      expect(blob[OTHER_SID].map(o => o.id)).toEqual(['o1']);

      _applyBundleTermRatings(CID, [
        { enrollment_id: SID, term: 1, narrative_html: 'A' },
        { enrollment_id: OTHER_SID, term: 1, narrative_html: 'B' },
      ]);
      expect(Object.keys(getTermRatings(CID))).toEqual([OTHER_SID]);
    });
  });
});
