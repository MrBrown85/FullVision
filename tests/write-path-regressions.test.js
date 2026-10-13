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
 *                                   doesn't revert edits made while it ran
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

  it.fails('enrolls a new student once when a second save starts before the first finishes', async () => {
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

  it.fails('replaces an existing note instead of adding a second one', async () => {
    // A note loaded from the server in an earlier session.
    seed('notes', { [ENR_Y]: 'Needs a seat near the front.' });

    saveNotes(CID, { [ENR_Y]: 'Needs a seat near the front and large print.' });
    await settle();

    expect(fake.committedCount('upsert_note')).toBe(1);
    expect(fake.committedCount('delete_note')).toBe(1);
  });

  // ── Phase 3 ────────────────────────────────────────────────────────────

  it.fails('inserts a re-linked curriculum once', async () => {
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

  it.fails('sends one write when a status is set', async () => {
    setAssignmentStatus(CID, ENR_Y, AID, 'LATE');
    await settle();

    expect(fake.count('set_score_status')).toBe(1);
  });

  it.fails('sends one write when a points score is entered', async () => {
    seed('assessments', [{ id: AID, title: 'Lab', scoreMode: 'points', maxPoints: 10, tagIds: [TAG1, TAG2] }]);
    seed('scores', {});

    setPointsScore(CID, ENR_Y, AID, 7);
    await settle();

    expect(fake.count('upsert_score') + fake.count('upsert_tag_score')).toBe(1);
  });

  it.fails('keeps a rename made while a learning-map sync is running', async () => {
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
});
