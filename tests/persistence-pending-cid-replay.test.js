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
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

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
