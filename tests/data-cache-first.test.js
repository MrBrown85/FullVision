/**
 * Saved copy first (docs/class-loading-plan.md, Phase 4).
 *
 * A class this device has saved opens from that copy without waiting for
 * the server; a request carrying the copy's version then asks whether it
 * changed. The copy is only trusted for the teacher who saved it, within
 * 14 days, and only becomes the server baseline when it holds no local
 * edits.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
