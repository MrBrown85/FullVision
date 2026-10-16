/**
 * Write-path regressions — docs/write-path-plan.md, Phase 0.
 *
 * Each test reproduces one defect of the whole-array save model, where
 * saveX(cid, array) diffs the array against the localStorage copy taken when
 * the save was called. They are marked it.fails because they fail today; the
 * phase that fixes a defect flips its test to it().
 *
 *   Phase 1 (durable outbox)      — a failed write is retried; degraded-mode
 *                                   recovery re-sends what was saved locally
 *   Phase 2 (server-state diff)   — overlapping saves don't duplicate rows;
 *                                   editing an older note replaces it
 *   Phase 3 (one writer)          — re-linking curriculum inserts once; one
 *                                   write per status/points change; a sync
 *                                   doesn't revert edits made while it ran;
 *                                   class-manager edits write through
 *                                   saveLearningMap only
 *   Phase 4 (realtime)            — a refresh waits for in-flight writes and
 *                                   never overwrites an edit made during it
 *   Phase 5 (sends)               — only changed rubrics are sent; unchanged
 *                                   categories and their order aren't re-sent
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const ENR_Y = '22222222-2222-4222-8222-222222222222';
const STU_Y = '33333333-3333-4333-8333-333333333333';
const AID = '44444444-4444-4444-8444-444444444444';
const SUBJ = '55555555-5555-4555-8555-555555555555';
const SEC1 = '66666666-6666-4666-8666-666666666666';
const TAG1 = '77777777-7777-4777-8777-777777777777';
const TAG2 = '88888888-8888-4888-8888-888888888888';
const NOTE = '99999999-9999-4999-8999-999999999999';
const AID2 = 'abababab-abab-4bab-8bab-abababababab';
const CAT1 = 'dededede-dede-4ede-8ede-dededededed1';
const CAT2 = 'dededede-dede-4ede-8ede-dededededed2';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

function studentY() {
  return { id: ENR_Y, personId: STU_Y, firstName: 'Yara', lastName: 'Young', designations: [], sortName: 'Young Yara' };
}

describe('write-path regressions (Phase 0)', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    _studentSaveQueue = {};
    _assessmentSaveQueue = {};
    _learningMapSaveQueue = {};
    _learningMapIdRemap = {};
    _noteSaveQueue = {};
    _noteIds = {};
    _serverState = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
  });

  afterEach(() => {
    _REFRESH_QUIET_MS = 2000;
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _supabaseDegraded = false;
    window.v2Queue.clear();
  });

  // ── Phase 1 ────────────────────────────────────────────────────────────

  it('retries an assessment update that failed once', async () => {
    seed('assessments', [{ id: AID, title: 'Old title', type: 'summative', tagIds: [] }]);
    fake.failNext('update_assessment');

    var assessments = getAssessments(CID);
    assessments[0].title = 'New title';
    saveAssessments(CID, assessments);
    await settle();
    // Any later save of the same list, as the next edit in the app would do.
    saveAssessments(CID, getAssessments(CID));
    // Then the outbox's retry comes due.
    await window.v2Queue.flush();

    expect(fake.committedCount('update_assessment', p => p.p_patch && p.p_patch.title === 'New title')).toBe(1);
  });

  it('re-sends edits saved while cloud sync was paused once it recovers', async () => {
    seed('students', [studentY()]);
    _useSupabase = false;
    _supabaseDegraded = true;

    var students = getStudents(CID);
    students[0].firstName = 'Yasmin';
    saveStudents(CID, students);
    expect(fake.calls).toHaveLength(0);

    var originalDismiss = globalThis.dismissSyncToast;
    globalThis.dismissSyncToast = function () {};
    try {
      _exitDegradedMode(null);
      await window.v2Queue.flush();
    } finally {
      globalThis.dismissSyncToast = originalDismiss;
    }

    expect(fake.committedCount('update_student', p => p.p_patch && p.p_patch.first_name === 'Yasmin')).toBe(1);
  });

  // ── Phase 2 ────────────────────────────────────────────────────────────

  it('enrolls a new student once when a second save starts before the first finishes', async () => {
    seed('students', [studentY()]);
    fake.hold();

    var students = getStudents(CID);
    students.push({ id: 'local-x', firstName: 'Xavier', lastName: 'Xu', designations: [], sortName: 'Xu Xavier' });
    saveStudents(CID, students);
    // Before the enrollment comes back, edit another student.
    students[0].pronouns = 'she/her';
    saveStudents(CID, students);

    await fake.release();
    await settle();

    expect(fake.committedCount('create_student_and_enroll', p => p.p_first_name === 'Xavier')).toBe(1);
  });

  it('replaces an existing note instead of adding a second one', async () => {
    // A note loaded from the server, as get_student_profile returns it.
    _applyStudentProfileSummaries(CID, [
      {
        student: { id: STU_Y, first_name: 'Yara', last_name: 'Young' },
        enrollment: { id: ENR_Y },
        notes: [{ id: NOTE, enrollment_id: ENR_Y, body: 'Needs a seat near the front.' }],
      },
    ]);

    saveNotes(CID, { [ENR_Y]: 'Needs a seat near the front and large print.' });
    await settle();

    expect(fake.committedCount('delete_note', p => p.p_id === NOTE)).toBe(1);
    expect(fake.committedCount('upsert_note')).toBe(1);
  });

  it('creates a new assessment once when a second save starts before the first finishes', async () => {
    seed('assessments', [{ id: AID2, title: 'Quiz 1', type: 'summative', tagIds: [] }]);
    // Loaded from the server, so the baseline is the server's copy.
    _rememberServerState('assessments', CID, getAssessments(CID));
    fake.hold();

    var assessments = getAssessments(CID);
    assessments.push({ id: 'local-a', title: 'Lab report', type: 'summative', tagIds: [] });
    saveAssessments(CID, assessments);
    // Before the create comes back, rename the other assessment.
    assessments[0].title = 'Quiz 1 (retake)';
    saveAssessments(CID, assessments);

    await fake.release();
    await settle();

    expect(fake.committedCount('create_assessment', p => p.p_title === 'Lab report')).toBe(1);
    expect(fake.committedCount('update_assessment', p => p.p_patch && p.p_patch.title === 'Quiz 1 (retake)')).toBe(1);
  });

  // ── Phase 3 ────────────────────────────────────────────────────────────

  it('inserts a re-linked curriculum once', async () => {
    saveCourses({ [CID]: { id: CID, name: 'Science 8', curriculumTags: ['SCI8'] } });
    CURRICULUM_INDEX = {
      SCI8: {
        subject: 'Science',
        course_name: 'Science 8',
        categories: [
          {
            name: 'Questioning and predicting',
            competencies: [
              { tag: 'QAP', short_label: 'Questioning', raw: 'Demonstrate curiosity' },
              { tag: 'PI', short_label: 'Planning', raw: 'Plan an investigation' },
            ],
          },
        ],
      },
    };
    seed('learningMaps', { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 });
    var originalAlert = globalThis.alert;
    globalThis.alert = function () {};
    DashClassManager.configure({ activeCourse: CID, onRender: function () {}, onCourseChange: function () {} });
    DashClassManager.openClassManager();

    try {
      DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
      DashClassManager.handleAction('cmRelinkConfirm', { dataset: { mode: 'replace' } });
      await settle(60);
    } finally {
      DashClassManager.resetState();
      globalThis.alert = originalAlert;
      CURRICULUM_INDEX = null;
    }

    expect(fake.committedCount('upsert_subject', p => !p.p_id)).toBe(1);
    expect(fake.committedCount('upsert_section', p => !p.p_id)).toBe(2);
    expect(fake.committedCount('upsert_tag', p => !p.p_id)).toBe(2);
  });

  it('adds a subject and a standard in the class manager with one insert each', async () => {
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    seed('learningMaps', {
      subjects: [{ id: SUBJ, name: 'Science', color: '#6366f1' }],
      sections: [],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    });
    _rememberServerState('learningMaps', CID, getLearningMap(CID));
    DashClassManager.configure({ activeCourse: CID, onRender: function () {}, onCourseChange: function () {} });
    DashClassManager.openClassManager();
    // cmAddStd scrolls the new card into view; the DOM stub has no layout.
    var originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = function () {
      return 0;
    };
    try {
      DashClassManager.handleAction('cmSelectClass', { dataset: { cid: CID } });
      DashClassManager.handleAction('cmAddSubject', { dataset: {} });
      await settle(60);
      DashClassManager.handleAction('cmAddStd', { dataset: {} });
      await settle(60);
    } finally {
      DashClassManager.resetState();
      globalThis.requestAnimationFrame = originalRaf;
    }

    expect(fake.committedCount('upsert_subject', p => !p.p_id)).toBe(1);
    expect(fake.committedCount('upsert_section', p => !p.p_id)).toBe(1);
    expect(fake.committedCount('upsert_tag', p => !p.p_id)).toBe(1);
  });

  it('saves a rename typed into a standard rendered before its server id came back', async () => {
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    seed('learningMaps', {
      subjects: [{ id: SUBJ, name: 'Science', color: '#6366f1' }],
      sections: [],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    });
    _rememberServerState('learningMaps', CID, getLearningMap(CID));
    DashClassManager.configure({ activeCourse: CID, onRender: function () {}, onCourseChange: function () {} });
    DashClassManager.openClassManager();
    var originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = function () {
      return 0;
    };
    try {
      DashClassManager.handleAction('cmSelectClass', { dataset: { cid: CID } });
      DashClassManager.handleAction('cmAddStd', { dataset: {} });
      // The rendered input keeps this local id after the insert re-keys it.
      var localId = getLearningMap(CID).sections[0].id;
      await settle(60);
      expect(getLearningMap(CID).sections[0].id).not.toBe(localId);

      DashClassManager.handleBlur({ dataset: { actionBlur: 'cmStdName', secid: localId }, value: 'Questioning' });
      await settle(60);
    } finally {
      DashClassManager.resetState();
      globalThis.requestAnimationFrame = originalRaf;
    }

    expect(getLearningMap(CID).sections[0].name).toBe('Questioning');
    expect(fake.committedCount('upsert_section', p => !!p.p_id && p.p_name === 'Questioning')).toBe(1);
  });

  it('sends one write when a status is set', async () => {
    setAssignmentStatus(CID, ENR_Y, AID, 'LATE');
    await settle();

    expect(fake.count('set_score_status')).toBe(1);
  });

  it('sends one write when a points score is entered', async () => {
    seed('assessments', [{ id: AID, title: 'Lab', scoreMode: 'points', maxPoints: 10, tagIds: [TAG1, TAG2] }]);
    seed('scores', {});

    setPointsScore(CID, ENR_Y, AID, 7);
    await settle();

    expect(fake.count('upsert_score') + fake.count('upsert_tag_score')).toBe(1);
  });

  it('keeps a rename made while a learning-map sync is running', async () => {
    seed('learningMaps', {
      subjects: [{ id: SUBJ, name: 'Science' }],
      sections: [
        { id: SEC1, subject: SUBJ, name: 'Questioning', tags: [{ id: TAG1, label: 'Questioning' }] },
        { id: 'local-sec', subject: SUBJ, name: 'Planning', tags: [{ id: 'local-tag', label: 'Planning' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    });
    fake.hold();

    var map = getLearningMap(CID);
    saveLearningMap(CID, map); // inserts the new local section; ids come back later
    await settle();
    // While that sync waits on the server, the teacher renames the first section.
    map.sections[0].name = 'Questioning and predicting';
    saveLearningMap(CID, map);

    await fake.release();
    await settle(60);

    var section = getLearningMap(CID).sections.find(s => s.id === SEC1);
    expect(section.name).toBe('Questioning and predicting');
  });
  // ── Phase 4 ────────────────────────────────────────────────────────────

  function loadGradebookFixture() {
    _persistLoadedField(CID, 'students', [studentY()]);
    _persistLoadedField(CID, 'assessments', [
      { id: AID, title: 'Lab', type: 'summative', scoreMode: 'proficiency', tagIds: [TAG1] },
    ]);
    _persistLoadedField(CID, 'scores', {});
  }

  // What get_gradebook returns when the server doesn't have the edit yet.
  var staleGradebook = { data: { categories: [], students: [], assessments: [], cells: {} }, error: null };

  it('keeps a score entered while a realtime refresh is fetching', async () => {
    _REFRESH_QUIET_MS = 0;
    loadGradebookFixture();
    var finishFirstFetch;
    var laterFetches = [];
    fake.on('get_gradebook', function (params, n) {
      return new Promise(function (resolve) {
        var finish = function () {
          resolve(staleGradebook);
        };
        if (n === 1) finishFirstFetch = finish;
        else laterFetches.push(finish); // held until the assertions are done
      });
    });

    _handleExternalCourseUpdate(CID, 'gradebook');
    await settle();
    expect(fake.count('get_gradebook')).toBe(1);

    // The teacher enters a score while that fetch is out.
    upsertScore(CID, ENR_Y, AID, TAG1, 3, '2026-10-12', 'summative');
    await settle();
    finishFirstFetch();
    await settle(60);

    expect(getScores(CID)[ENR_Y]).toHaveLength(1);
    expect(getScores(CID)[ENR_Y][0].score).toBe(3);
    expect(fake.committedCount('upsert_tag_score', p => p.p_value === 3)).toBe(1);

    laterFetches.forEach(function (finish) {
      finish();
    });
    await settle(60);
  });

  it('waits for writes still in flight before refreshing', async () => {
    _REFRESH_QUIET_MS = 0;
    loadGradebookFixture();
    fake.on('get_gradebook', function () {
      return staleGradebook;
    });
    fake.hold();
    upsertScore(CID, ENR_Y, AID, TAG1, 2, '2026-10-12', 'summative');

    _handleExternalCourseUpdate(CID, 'gradebook');
    await settle();
    expect(fake.count('get_gradebook')).toBe(0);

    await fake.release();
    // The refresh polls for in-flight writes every 250 ms.
    await new Promise(r => setTimeout(r, 400));
    await settle(60);
    expect(fake.count('get_gradebook')).toBeGreaterThan(0);
  });

  it('applies server changes when nothing was edited', async () => {
    _REFRESH_QUIET_MS = 0;
    loadGradebookFixture();
    fake.on('get_gradebook', function () {
      return {
        data: {
          categories: [],
          students: [],
          assessments: [{ id: AID2, title: 'Added on another device', type: 'summative', tag_ids: [] }],
          cells: {},
        },
        error: null,
      };
    });

    await _handleExternalCourseUpdate(CID, 'gradebook');

    expect(getAssessments(CID).map(a => a.title)).toEqual(['Added on another device']);
  });
  // ── Phase 5 ────────────────────────────────────────────────────────────

  const RUB1 = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc1';
  const RUB2 = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc2';
  const CRIT1 = 'cececece-cece-4ece-8ece-cececececec1';
  const CRIT2 = 'cececece-cece-4ece-8ece-cececececec2';

  function rubric(id, critId, name) {
    return { id: id, name: name, criteria: [{ id: critId, name: 'Evidence', levels: { 4: 'Strong' }, tagIds: [] }] };
  }

  it('sends only the rubric that changed, without reloading', async () => {
    _persistLoadedField(CID, 'rubrics', [rubric(RUB1, CRIT1, 'Lab'), rubric(RUB2, CRIT2, 'Essay')]);
    var rubrics = structuredClone(getRubrics(CID));
    rubrics[1].name = 'Persuasive essay';

    await saveRubrics(CID, rubrics);

    expect(fake.count('upsert_rubric')).toBe(1);
    expect(fake.calls.find(c => c.name === 'upsert_rubric').params.p_id).toBe(RUB2);
  });

  it('does not re-send unchanged categories or their order', async () => {
    var rows = [
      { id: CAT1, name: 'Tests', weight: 60, displayOrder: 0 },
      { id: CAT2, name: 'Labs', weight: 40, displayOrder: 1 },
    ];
    _persistLoadedField(CID, 'categories', rows);

    saveCategories(CID, structuredClone(rows));
    await settle();
    expect(fake.calls).toHaveLength(0);

    var reordered = [structuredClone(rows[1]), structuredClone(rows[0])];
    saveCategories(CID, reordered);
    await settle();
    expect(fake.count('save_categories')).toBe(1);
    expect(fake.calls[0].params.p_categories.map(c => c.id)).toEqual([CAT2, CAT1]);
  });

  it('sends re-weighted categories as one list, so the total never leaves 100', async () => {
    var rows = [
      { id: CAT1, name: 'Tests', weight: 60, displayOrder: 0 },
      { id: CAT2, name: 'Labs', weight: 40, displayOrder: 1 },
    ];
    _persistLoadedField(CID, 'categories', rows);

    var next = structuredClone(rows);
    next[0].weight = 70;
    next[1].weight = 30;
    saveCategories(CID, next);
    await settle();

    expect(fake.calls.map(c => c.name)).toEqual(['save_categories']);
    expect(fake.calls[0].params).toEqual({
      p_course_id: CID,
      p_categories: [
        { id: CAT1, name: 'Tests', weight: 70 },
        { id: CAT2, name: 'Labs', weight: 30 },
      ],
    });
  });

  it('gives a new category its server id', async () => {
    _persistLoadedField(CID, 'categories', [{ id: CAT1, name: 'Tests', weight: 100, displayOrder: 0 }]);

    saveCategories(CID, [
      { id: CAT1, name: 'Tests', weight: 80, displayOrder: 0 },
      { id: 'local-cat', name: 'Labs', weight: 20, displayOrder: 1 },
    ]);
    await settle();

    expect(fake.calls[0].params.p_categories[1]).toEqual({ name: 'Labs', weight: 20 });
    expect(getCategories(CID)[1].id).toMatch(/^aaaaaaaa-/);
  });

  it('takes class-manager category rows into the cache without sending them again', async () => {
    var rows = [{ id: CAT1, name: 'Tests', weight: 100, displayOrder: 0 }];
    adoptCategoriesFromServer(CID, rows);
    saveCategories(CID, structuredClone(rows));
    await settle();

    expect(getCategories(CID)).toEqual(rows);
    expect(fake.calls).toHaveLength(0);
  });
});
