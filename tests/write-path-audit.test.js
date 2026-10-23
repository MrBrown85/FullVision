/**
 * Write-path audit, 2026-10-16 (docs/write-path-audit-2026-10.md).
 *
 * One test per finding. Each test is written the way it should pass once the
 * finding is fixed, and is marked `it.fails` so it passes (the assertion
 * fails) while the bug is there. The fix PR for a group flips its tests from
 * `it.fails` to `it`. A test marked `it.skip` could not be made to fail for
 * the reason the finding gives; the comment above it says why.
 *
 * Nothing here changes shared/, teacher/ or teacher-mobile/.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');

const CID = '11111111-1111-4111-8111-111111111111';
const ENR_Y = '22222222-2222-4222-8222-222222222222';
const STU_Y = '33333333-3333-4333-8333-333333333333';
const AID = '44444444-4444-4444-8444-444444444444';
const TAG1 = '77777777-7777-4777-8777-777777777777';
const NEW_CID = '55555555-5555-4555-8555-555555555555';
const ENR_Z = 'abababab-abab-4bab-8bab-abababababab';
const STU_Z = '99999999-9999-4999-8999-999999999999';

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return value;
    },
  });
}

// Every copy of the queue module loaded so far; each test starts by closing
// the tabs the last one opened.
var TABS = [];

/**
 * Loads shared/offline-queue.js again, as a reload does: the copy that was
 * current gives up the queue (its page is gone) and the new one takes it.
 * New in-memory state, the same localStorage. Leaves window.v2Queue pointing
 * at the new copy and returns it. The page is offline while the module loads
 * so its start-up flush stays quiet; the caller goes online when it is ready.
 */
function loadQueueModule() {
  setOnline(false);
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  TABS.push(window.v2Queue);
  return window.v2Queue;
}

/**
 * Loads shared/offline-queue.js as a second tab would: the current copy keeps
 * the queue and the new one waits behind it. Leaves window.v2Queue pointing
 * at the new copy (the page whose data layer the test drives) and returns it.
 */
function openTab() {
  // The module lets go of the copy it finds in window.v2Queue (a reload);
  // hide it so this copy loads beside it instead.
  window.v2Queue = undefined;
  return loadQueueModule();
}

// The copy every test file in this process shares; each test starts on it.
const ORIGINAL_QUEUE = loadQueueModule();

// Close the last test's tabs and give the queue back to the shared copy.
beforeEach(() => {
  TABS.forEach(tab => tab.release());
  TABS = [ORIGINAL_QUEUE];
  window.v2Queue = ORIGINAL_QUEUE;
  ORIGINAL_QUEUE.claim();
});

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

function studentY() {
  return { id: ENR_Y, personId: STU_Y, firstName: 'Yara', lastName: 'Young', designations: [], sortName: 'Young Yara' };
}

function clearCache() {
  Object.keys(_cache).forEach(function (field) {
    if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
      _cache[field] = {};
    }
  });
}

function resetSession() {
  clearCache();
  _studentSaveQueue = {};
  _assessmentSaveQueue = {};
  _learningMapSaveQueue = {};
  _learningMapIdRemap = {};
  _noteSaveQueue = {};
  _serverState = {};
  _idRekeys = {};
  _localWrites = {};
  _refreshState = {};
  _pendingSyncs = 0;
  _pendingLocalCids.clear();
  _idmapRaw = null;
  _idmapCache = null;
  // The next write configures whichever queue copy is current.
  _outboxConfigured = false;
}

/**
 * A page reload: everything the page held in memory is gone, localStorage
 * (the saved class copy and the outbox) stays, and the outbox module loads
 * again. Writes that were waiting on a promise in the old page are never
 * resumed. The new page is offline until the caller says otherwise.
 */
function reloadPage() {
  resetSession();
  var queue = loadQueueModule();
  _outbox();
  return queue;
}

describe('write-path audit: data layer', () => {
  var fake;
  var originalShowSyncToast;
  var originalDismissSyncToast;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    resetSession();
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    COURSES = {};
    originalShowSyncToast = globalThis.showSyncToast;
    originalDismissSyncToast = globalThis.dismissSyncToast;
    globalThis.showSyncToast = () => {};
    globalThis.dismissSyncToast = () => {};
    setOnline(true);
    window.v2Queue.clear();
  });

  afterEach(async () => {
    window.v2Queue.clear();
    window.v2Queue = ORIGINAL_QUEUE;
    window.v2Queue.clear();
    // Clearing the outbox fails the writes still waiting; let their handlers
    // run (they may show a sync toast) before the real toast is put back.
    await settle(5);
    globalThis.showSyncToast = originalShowSyncToast;
    globalThis.dismissSyncToast = originalDismissSyncToast;
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    setOnline(false);
  });

  // Finding 1 (fixed: fv-idmap-v1 + _rekey from the outbox's success event).
  // Offline, the create cannot resolve before a reload, so the test goes
  // offline instead of holding the request: a held request would still
  // resolve the old page's continuation when released, which a real reload
  // does not.
  it('sends scores entered on a new assessment even when the page reloads before the create resolves', async () => {
    seed('students', [studentY()]);
    seed('assessments', []);
    seed('scores', {});
    setOnline(false);

    var assessments = getAssessments(CID);
    assessments.push({ id: 'sLOCALASSESS1', title: 'Lab', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, assessments);
    var scores = getScores(CID);
    scores[ENR_Y] = [{ id: 'e1', assessmentId: 'sLOCALASSESS1', tagId: TAG1, score: 3, date: '2026-10-13' }];
    saveScores(CID, scores);
    await settle();
    expect(window.v2Queue.stats().queued).toBeGreaterThan(0);
    expect(fake.count('create_assessment')).toBe(0);

    var queue = reloadPage();
    setOnline(true);
    await queue.flush();
    await settle();

    expect(fake.committedCount('create_assessment')).toBe(1);
    var newId = getAssessments(CID)[0].id;
    expect(_isUuid(newId)).toBe(true);
    expect(
      fake.committedCount(
        'upsert_tag_score',
        p => p.p_assessment_id === newId && p.p_tag_id === TAG1 && p.p_value === 3,
      ),
    ).toBe(1);
  });

  // Finding 1, second half (fixed: every row is pushed before any is awaited;
  // a row under a parent with a local id waits in the outbox behind it).
  it('queues every learning-map row, not just the first, while offline', async () => {
    seed('learningMaps', { subjects: [], sections: [] });
    setOnline(false);

    saveLearningMap(CID, {
      subjects: [{ id: 'sub1', name: 'Science' }],
      sections: [{ id: 'sec1', subject: 'sub1', name: 'Questioning', tags: [{ id: 'tag1', label: 'Q1' }] }],
    });
    await settle();

    expect(window.v2Queue.stats().queued).toBe(3);
  });

  // Finding 14, second half: the server removes an assessment's scores and
  // statuses with the assessment, so deleting it sends one delete and no
  // per-student clears (they raced the delete and were dead-lettered).
  it('sends one delete_assessment and no per-cell clears when an assessment is deleted', async () => {
    seed('students', [studentY()]);
    seed('assessments', [{ id: AID, title: 'Lab', type: 'summative', tagIds: [TAG1] }]);
    seed('scores', {
      [ENR_Y]: [{ id: 'e1', assessmentId: AID, tagId: TAG1, score: 3, date: '2026-10-13' }],
    });
    seed('statuses', { [ENR_Y + ':' + AID]: 'NS' });
    _rememberServerState('assessments', CID, getAssessments(CID));
    _rememberServerState('scores', CID, getScores(CID));
    _rememberServerState('statuses', CID, getAssignmentStatuses(CID));

    saveAssessments(
      CID,
      getAssessments(CID).filter(a => a.id !== AID),
    );
    // What the delete handlers on the assignments and gradebook pages do next.
    var scores = getScores(CID);
    Object.keys(scores).forEach(sid => {
      scores[sid] = scores[sid].filter(s => s.assessmentId !== AID);
    });
    saveScores(CID, scores);
    var statuses = getAssignmentStatuses(CID);
    delete statuses[ENR_Y + ':' + AID];
    saveAssignmentStatuses(CID, statuses);
    await settle();

    expect(fake.committedCount('delete_assessment', p => p.p_id === AID)).toBe(1);
    expect(fake.calls.map(c => c.name)).toEqual(['delete_assessment']);
    expect(getScores(CID)[ENR_Y]).toEqual([]);
    expect(getAssignmentStatuses(CID)[ENR_Y + ':' + AID]).toBeUndefined();
  });

  it('sends no cell clears when the deleted assessment is a points assessment', async () => {
    seed('students', [studentY()]);
    seed('assessments', [
      { id: AID, title: 'Quiz', type: 'summative', scoreMode: 'points', maxPoints: 10, tagIds: [TAG1] },
    ]);
    seed('scores', {
      [ENR_Y]: [{ id: 'e1', assessmentId: AID, tagId: TAG1, score: 7, date: '2026-10-13' }],
    });
    _rememberServerState('assessments', CID, getAssessments(CID));
    _rememberServerState('scores', CID, getScores(CID));

    saveAssessments(CID, []);
    await settle();

    expect(fake.calls.map(c => c.name)).toEqual(['delete_assessment']);
  });

  // Finding 3 (fixed: a dead letter puts the baseline row back, so the next
  // save diffs it again).
  it('re-sends an assessment edit whose first write was rejected by the server', async () => {
    seed('students', [studentY()]);
    seed('assessments', [{ id: AID, title: 'Lab', type: 'summative', tagIds: [TAG1] }]);
    _rememberServerState('assessments', CID, getAssessments(CID));
    fake.on('update_assessment', (p, n) =>
      n === 1 ? { data: null, error: { code: 'P0001', message: 'rejected' } } : { data: null, error: null },
    );

    var a = getAssessments(CID);
    a[0].title = 'Lab 1';
    saveAssessments(CID, a);
    await settle();
    expect(window.v2Queue.stats().deadLettered).toBe(1);

    // The baseline must not claim the title landed.
    expect(_serverState.assessments[CID][0].title).toBe('Lab');
    // Any later save re-diffs it.
    a = getAssessments(CID);
    a[0].title = 'Lab 1';
    saveAssessments(CID, a);
    await settle();
    expect(fake.count('update_assessment', p => p.p_patch.title === 'Lab 1')).toBeGreaterThanOrEqual(2);
  });

  // Finding 4, replaced by withdrawal (docs/DECISIONS.md: "Students are
  // removed by withdrawal, not deletion"). Removing a student sends
  // withdraw_student and deletes nothing; Undo re-enrols, and the student
  // comes back with their records, locally and in the baselines.
  it('withdraws without deleting, and Undo re-enrols with everything back', async () => {
    var score = { id: 'sc1', assessmentId: AID, tagId: TAG1, score: 3, type: 'summative' };
    seed('students', [studentY()]);
    seed('scores', { [ENR_Y]: [score] });
    seed('statuses', { [ENR_Y + ':' + AID]: 'LATE' });
    seed('observations', { [ENR_Y]: [{ id: 'ob1', text: 'Asked a great question' }] });
    seed('termRatings', { [ENR_Y]: { 1: { dims: {}, narrative: 'Term 1' } } });
    _rememberServerState('students', CID, getStudents(CID));
    _rememberServerState('scores', CID, getScores(CID));
    _rememberServerState('statuses', CID, getAssignmentStatuses(CID));

    withdrawStudent(CID, ENR_Y);
    await settle();
    expect(getStudents(CID)).toEqual([]);
    expect(getScores(CID)[ENR_Y]).toBeUndefined();
    expect(_serverState.scores[CID][ENR_Y]).toBeUndefined();
    expect(fake.committedCount('withdraw_student', p => p.p_enrollment_id === ENR_Y)).toBe(1);

    expect(reenrolStudent(CID, ENR_Y)).toBe(true);
    await settle();

    expect(getStudents(CID).map(s => s.id)).toEqual([ENR_Y]);
    expect(getScores(CID)[ENR_Y]).toEqual([score]);
    expect(getAssignmentStatuses(CID)[ENR_Y + ':' + AID]).toBe('LATE');
    expect(getQuickObs(CID)[ENR_Y]).toHaveLength(1);
    expect(getTermRatings(CID)[ENR_Y]).toBeDefined();
    expect(getWithdrawnStudents(CID)).toEqual([]);
    expect(_serverState.students[CID].map(s => s.id)).toEqual([ENR_Y]);
    expect(_serverState.scores[CID][ENR_Y]).toEqual([score]);
    expect(fake.committedCount('reenrol_student', p => p.p_enrollment_id === ENR_Y)).toBe(1);
    // Nothing else: no delete, no re-created student, no re-sent scores.
    expect(fake.calls.map(c => c.name).sort()).toEqual(['reenrol_student', 'withdraw_student']);
  });

  // A roster save after a withdrawal must not withdraw the enrollment again
  // or clear the withdrawn student's scores on the server.
  it('does not re-send a withdrawal or clear scores on a later roster save', async () => {
    var other = {
      id: ENR_Z,
      personId: STU_Z,
      firstName: 'Zed',
      lastName: 'Zane',
      designations: [],
      sortName: 'Zane Zed',
    };
    seed('students', [studentY(), other]);
    seed('scores', { [ENR_Y]: [{ id: 'sc1', assessmentId: AID, tagId: TAG1, score: 3, type: 'summative' }] });
    _rememberServerState('students', CID, getStudents(CID));
    _rememberServerState('scores', CID, getScores(CID));

    withdrawStudent(CID, ENR_Y);
    await settle();
    var students = getStudents(CID);
    students[0] = Object.assign({}, students[0], { preferred: 'Z' });
    saveStudents(CID, students);
    saveScores(CID, getScores(CID));
    await settle();

    expect(fake.committedCount('withdraw_student')).toBe(1);
    expect(fake.count('withdraw_enrollment')).toBe(0);
    expect(fake.count('clear_score')).toBe(0);
    expect(fake.count('delete_student')).toBe(0);
  });

  // The page closes before the withdrawal is sent: it waits in the outbox
  // and the next page sends it.
  it('sends a queued withdrawal after a reload', async () => {
    seed('students', [studentY()]);
    _rememberServerState('students', CID, getStudents(CID));
    setOnline(false);
    withdrawStudent(CID, ENR_Y);
    await settle();
    expect(fake.count('withdraw_student')).toBe(0);

    var queue = reloadPage();
    setOnline(true);
    await queue.flush();
    await settle();

    expect(fake.committedCount('withdraw_student', p => p.p_enrollment_id === ENR_Y)).toBe(1);
    expect(getWithdrawnStudents(CID).map(w => w.student.id)).toEqual([ENR_Y]);
  });

  // A student added and withdrawn before their enrol reached the server:
  // the withdrawal waits behind the enrol, then goes out with the server id,
  // and the Withdrawn list follows the re-key.
  it('withdraws a student whose enrol is still queued once the enrol lands', async () => {
    seed('students', []);
    fake.hold();
    var students = getStudents(CID);
    students.push({ id: 'sLOCALSTUDENT', firstName: 'X', lastName: 'Y', designations: [], sortName: 'Y X' });
    saveStudents(CID, students);
    await settle();
    withdrawStudent(CID, 'sLOCALSTUDENT');
    await fake.release();
    await settle();
    await fake.release();
    await settle();

    var enr = getWithdrawnStudents(CID)[0].student.id;
    expect(_isUuid(enr)).toBe(true);
    expect(fake.committedCount('create_student_and_enroll')).toBe(1);
    expect(fake.committedCount('withdraw_student', p => p.p_enrollment_id === enr)).toBe(1);
    expect(getStudents(CID)).toEqual([]);
  });

  // The second step: only from the Withdrawn list, sent once, with no Undo.
  it('deletes a withdrawn student permanently with delete_withdrawn_student', async () => {
    seed('students', [studentY()]);
    _rememberServerState('students', CID, getStudents(CID));

    withdrawStudent(CID, ENR_Y);
    expect(deleteWithdrawnStudent(CID, ENR_Y)).toBe(true);
    await settle();

    expect(fake.committedCount('withdraw_student', p => p.p_enrollment_id === ENR_Y)).toBe(1);
    expect(fake.committedCount('delete_withdrawn_student', p => p.p_enrollment_id === ENR_Y)).toBe(1);
    expect(fake.count('delete_student')).toBe(0);
    expect(getWithdrawnStudents(CID)).toEqual([]);
    expect(reenrolStudent(CID, ENR_Y)).toBe(false);
  });

  // The client before withdrawal held a hard delete in the outbox until its
  // Undo toast closed. delete_student is gone from the server, so one left
  // there is dropped, not sent, and doesn't keep the outbox busy.
  it('drops a hard delete the previous client held for Undo', async () => {
    window.v2Queue.push('delete_student', { p_id: STU_Y }, { blockedOn: ['undo-window'] });
    await settle();
    expect(window.v2Queue.stats().queued).toBe(1);

    dropHeldStudentDeletes();
    await window.v2Queue.flush();
    await settle();
    expect(fake.count('delete_student')).toBe(0);
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(window.v2Queue.stats().deadLettered).toBe(0);
  });

  // Finding 5 (fixed: a refused push is refused at the data layer; nothing
  // is sent directly and the baseline stays put).
  it('does not pretend a write landed when the outbox is full', async () => {
    seed('students', [studentY()]);
    seed('assessments', [{ id: AID, tagIds: [TAG1], type: 'summative' }]);
    seed('scores', {});
    _rememberServerState('scores', CID, {});
    setOnline(false);
    for (var i = 0; i < window.v2Queue.MAX_ENTRIES; i++) window.v2Queue.enqueue('noop', { i: i });
    fake.failNext('upsert_tag_score', 1);

    var ok = upsertScore(CID, ENR_Y, AID, TAG1, 3, '2026-10-13', 'summative');
    await settle();

    expect(ok).toBe(false);
    expect(_serverState.scores[CID][ENR_Y]).toBeUndefined();
    // Said on the sync dot, not in a message.
    expect(getSaveProblem()).toMatch(/storage is full/);
  });

  // Finding 6, report sketch. Passes today: the second save reads the live cache, so the create is never sent.
  it.skip('does not resurrect an assessment deleted before its create resolved', async () => {
    seed('assessments', []);
    fake.hold();
    var a = getAssessments(CID);
    a.push({ id: 'sLOCAL', title: 'Oops', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, a);
    saveAssessments(CID, []);
    await fake.release();
    await settle();
    var created = fake.committedCount('create_assessment');
    var deleted = fake.committedCount('delete_assessment');
    expect(created === 0 || deleted === 1).toBe(true);
  });

  // Finding 6, reload variant (fixed: removing a row whose create is still
  // queued removes the create from the outbox).
  it('does not resurrect an assessment deleted offline before a reload', async () => {
    seed('assessments', []);
    setOnline(false);
    var a = getAssessments(CID);
    a.push({ id: 'sLOCAL', title: 'Oops', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, a);
    await settle();
    saveAssessments(CID, []);
    await settle();

    var queue = reloadPage();
    setOnline(true);
    await queue.flush();
    await settle();

    var created = fake.committedCount('create_assessment');
    var deleted = fake.committedCount('delete_assessment');
    expect(created === 0 || deleted === 1).toBe(true);
  });

  // Finding 7 (fixed: a write naming a pending local id waits in the outbox
  // behind the create and is re-keyed with it).
  it('sends an observation written before the student had a server id', async () => {
    seed('students', []);
    seed('observations', {});
    fake.hold();

    var students = getStudents(CID);
    students.push({ id: 'sLOCALSTUDENT', firstName: 'X', lastName: 'Y', designations: [], sortName: 'Y X' });
    saveStudents(CID, students);
    await settle();
    addQuickOb(CID, 'sLOCALSTUDENT', 'Great question today', []);
    await fake.release();
    await settle();

    var enr = getStudents(CID)[0].id;
    expect(_isUuid(enr)).toBe(true);
    expect(fake.committedCount('create_observation', p => p.p_enrollment_ids[0] === enr)).toBe(1);
  });

  // Finding 9, through the phone grader's NS button (fixed: teacher-mobile/
  // tab-grade.js and page-assignments.js zero only proficiency work).
  it('does not store a points score of 0 when a cell is marked NS', async () => {
    seed('students', [studentY()]);
    seed('assessments', [
      { id: AID, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [TAG1], type: 'summative' },
    ]);
    seed('scores', {});
    seed('statuses', {});

    MGrade.setStatus(CID, ENR_Y, AID, 'NS');
    await settle();

    expect(getAssignmentStatus(CID, ENR_Y, AID)).toBe('NS');
    expect(fake.committedCount('upsert_score', p => p.p_value === 0)).toBe(0);
    expect(getPointsScore(CID, ENR_Y, AID)).toBeNull();
  });

  // Finding 10 (fixed: patches hold only the fields that differ from the
  // server baseline, so a stale copy can't revert fields the teacher did not
  // touch).
  it('sends only the fields that changed when renaming an assessment', async () => {
    seed('assessments', [{ id: AID, title: 'Lab', dueDate: '2026-10-20', type: 'summative', tagIds: [TAG1] }]);
    _rememberServerState('assessments', CID, getAssessments(CID));

    var a = getAssessments(CID);
    a[0].title = 'Lab 1';
    saveAssessments(CID, a);
    await settle();

    var params = fake.committed.find(c => c.name === 'update_assessment').params;
    expect(Object.keys(params.p_patch)).toEqual(['title']);
    expect('p_tag_ids' in params).toBe(false);
    expect(fake.committedCount('save_collab')).toBe(0);
  });

  it('sends only the fields that changed when editing a student', async () => {
    seed('students', [studentY()]);
    _rememberServerState('students', CID, getStudents(CID));

    var students = getStudents(CID);
    students[0].firstName = 'Yasmin';
    saveStudents(CID, students);
    await settle();

    var call = fake.committed.find(c => c.name === 'update_student');
    expect(call.params).toEqual({ p_id: STU_Y, p_patch: { first_name: 'Yasmin' } });
    expect(fake.committedCount('update_enrollment')).toBe(0);
  });

  it('sends only the tag list when only the tags changed', async () => {
    var TAG2 = '88888888-8888-4888-8888-888888888888';
    seed('assessments', [{ id: AID, title: 'Lab', dueDate: '2026-10-20', type: 'summative', tagIds: [TAG1] }]);
    _rememberServerState('assessments', CID, getAssessments(CID));

    var a = getAssessments(CID);
    a[0].tagIds = [TAG1, TAG2];
    saveAssessments(CID, a);
    await settle();

    var call = fake.committed.find(c => c.name === 'update_assessment');
    expect(call.params).toEqual({ p_id: AID, p_patch: {}, p_tag_ids: [TAG1, TAG2] });
    expect(fake.committedCount('save_collab')).toBe(0);
  });

  it('sends only save_collab when only the collaboration changed', async () => {
    seed('assessments', [{ id: AID, title: 'Lab', dueDate: '2026-10-20', type: 'summative', tagIds: [TAG1] }]);
    _rememberServerState('assessments', CID, getAssessments(CID));

    var a = getAssessments(CID);
    a[0].collaboration = 'pair';
    a[0].pairs = [[ENR_Y, ENR_Z]];
    saveAssessments(CID, a);
    await settle();

    expect(fake.committedCount('update_assessment')).toBe(0);
    var call = fake.committed.find(c => c.name === 'save_collab');
    expect(call.params).toEqual({ p_id: AID, p_mode: 'pairs', p_config: { pairs: [[ENR_Y, ENR_Z]] } });
  });

  it('sends nothing for a row whose server fields did not change', async () => {
    seed('students', [studentY()]);
    seed('assessments', [{ id: AID, title: 'Lab', dueDate: '2026-10-20', type: 'summative', tagIds: [TAG1] }]);
    _rememberServerState('students', CID, getStudents(CID));
    _rememberServerState('assessments', CID, getAssessments(CID));

    // A field with no server column of its own.
    var students = getStudents(CID);
    students[0].enrolledDate = '2026-09-03';
    saveStudents(CID, students);
    saveAssessments(CID, getAssessments(CID));
    await settle();

    expect(fake.committed).toEqual([]);
  });

  // Finding 11 (fixed: the create_course record in fv-idmap-v1 outlives the
  // page, so the migration runs from the outbox's success event).
  it('replays wizard data after a reload once create_course lands', async () => {
    fake.on('create_course', () => ({ data: NEW_CID, error: null }));
    setOnline(false);

    var course = createCourse({ name: 'Science 8' });
    saveStudents(course.id, [
      { id: 'sLOCALADA', firstName: 'Ada', lastName: 'L', designations: [], sortName: 'L Ada' },
    ]);
    await settle();
    expect(fake.count('create_course')).toBe(0);

    // The server does not list the class yet, so the reloaded page has none.
    var queue = reloadPage();
    COURSES = {};
    _cache.courses = COURSES;
    setOnline(true);
    await queue.flush();
    await settle();

    expect(fake.count('create_course')).toBe(1);
    expect(fake.count('create_student_and_enroll', p => p.p_course_id === NEW_CID)).toBe(1);
  });

  // The flat learning map gives a new standard's section and tag the same
  // local id (cmAddStd). Each must get its own server id, with the goals
  // following the section and the scores following the tag.
  it('re-keys a section and a tag that share a local id to their own server ids', async () => {
    const SUBJ = '55555555-5555-4555-8555-555555555555';
    seed('students', [studentY()]);
    seed('assessments', []);
    seed('scores', {});
    seed('goals', {});
    seed('learningMaps', {
      subjects: [{ id: SUBJ, name: 'Science', color: '#6366f1' }],
      sections: [],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    });
    _rememberServerState('learningMaps', CID, getLearningMap(CID));
    var SEC_ID = '77777777-7777-4777-8777-777777777771';
    var TAG_ID = '77777777-7777-4777-8777-777777777772';
    fake.on('upsert_section', () => ({ data: SEC_ID, error: null }));
    fake.on('upsert_tag', () => ({ data: TAG_ID, error: null }));
    setOnline(false);

    var map = getLearningMap(CID);
    map.sections.push({
      id: 'SNEW1',
      subject: SUBJ,
      name: 'New Standard',
      shortName: 'New',
      tags: [{ id: 'SNEW1', label: 'New Standard', subject: SUBJ, name: 'New Standard', shortName: 'New' }],
    });
    saveLearningMap(CID, map);
    var goals = getGoals(CID);
    goals[ENR_Y] = { SNEW1: 'Ask better questions' };
    saveGoals(CID, goals);
    var assessments = getAssessments(CID);
    assessments.push({ id: AID, title: 'Lab', type: 'summative', tagIds: ['SNEW1'] });
    saveAssessments(CID, assessments);
    var scores = getScores(CID);
    scores[ENR_Y] = [{ id: 'e1', assessmentId: AID, tagId: 'SNEW1', score: 3, date: '2026-10-13' }];
    saveScores(CID, scores);
    await settle();
    expect(window.v2Queue.stats().queued).toBeGreaterThanOrEqual(3);

    var queue = reloadPage();
    setOnline(true);
    await queue.flush();
    await settle();

    var section = getLearningMap(CID).sections[0];
    expect(section.id).toBe(SEC_ID);
    expect(section.tags[0].id).toBe(TAG_ID);
    expect(getGoals(CID)[ENR_Y]).toEqual({ [SEC_ID]: 'Ask better questions' });
    expect(getScores(CID)[ENR_Y][0].tagId).toBe(TAG_ID);
    expect(fake.count('upsert_tag', p => p.p_section_id === SEC_ID)).toBe(1);
    expect(fake.committedCount('upsert_tag_score', p => p.p_tag_id === TAG_ID && p.p_value === 3)).toBe(1);
  });

  // Finding 6, in flight: the create was already sent when the row was
  // removed, so the delete goes out with the server id once it is known.
  it('deletes an assessment removed while its create was in flight', async () => {
    seed('assessments', []);
    fake.hold();
    var a = getAssessments(CID);
    a.push({ id: 'sLOCAL', title: 'Oops', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, a);
    await settle();
    saveAssessments(CID, []);
    await settle();
    await fake.release();
    await settle();

    var created = fake.committed.find(c => c.name === 'create_assessment');
    expect(created).toBeTruthy();
    var newId = fake.committedCount('delete_assessment', p => _isUuid(p.p_id));
    expect(newId).toBe(1);
  });

  // Finding 8: the tab that queued a create is not the one that sends it. The
  // sending tab's success event reaches this page's data layer, which
  // re-keys the new assessment and frees the score waiting on it.
  it('re-keys a create in the tab that queued it when another tab sends it', async () => {
    var tabA = loadQueueModule();
    var tabB = openTab();
    window.v2Queue = tabB;
    _outbox();
    tabA.configure({ send: (name, params) => fake.rpc(name, params) });
    await settle(1); // tab A holds the lock
    seed('students', [studentY()]);
    seed('assessments', []);
    seed('scores', {});
    setOnline(true);

    var assessments = getAssessments(CID);
    assessments.push({ id: 'sLOCALASSESS1', title: 'Lab', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, assessments);
    var scores = getScores(CID);
    scores[ENR_Y] = [{ id: 'e1', assessmentId: 'sLOCALASSESS1', tagId: TAG1, score: 3, date: '2026-10-13' }];
    saveScores(CID, scores);
    await settle();

    expect(fake.committedCount('create_assessment')).toBe(1);
    var newId = getAssessments(CID)[0].id;
    expect(newId).not.toBe('sLOCALASSESS1');
    expect(fake.committedCount('upsert_tag_score', p => p.p_assessment_id === newId && p.p_value === 3)).toBe(1);
    expect(tabB.stats().queued).toBe(0);
  });

  // Finding 8: a landed create tells the other tabs the new id, and a tab
  // told brings its own memory in line without touching the shared copy.
  it('tells other tabs the new id when a create lands', async () => {
    _initCrossTab();
    var heard = [];
    var other = new BroadcastChannel('td-data-sync');
    other.onmessage = e => heard.push(e.data);
    seed('assessments', [{ id: 'sLOCALASSESS1', title: 'Lab', type: 'summative', tagIds: [TAG1] }]);

    _rekey(CID, 'assessment', 'sLOCALASSESS1', AID);
    await settle(1);
    other.close();

    expect(heard).toContainEqual(
      expect.objectContaining({ type: 'rekey', cid: CID, kind: 'assessment', localId: 'sLOCALASSESS1', serverId: AID }),
    );
  });

  it('applies a new id announced by another tab', async () => {
    _initCrossTab();
    seed('assessments', [{ id: 'sLOCALASSESS1', title: 'Lab', type: 'summative', tagIds: [TAG1] }]);
    var scores = {};
    scores[ENR_Y] = [{ id: 'e1', assessmentId: 'sLOCALASSESS1', tagId: TAG1, score: 3, date: '2026-10-13' }];
    seed('scores', scores);
    var savedKey = 'gb-' + _DATA_KEYS.assessments + '-' + CID;
    var savedBefore = localStorage.getItem(savedKey);
    var other = new BroadcastChannel('td-data-sync');

    other.postMessage({ type: 'rekey', cid: CID, kind: 'assessment', localId: 'sLOCALASSESS1', serverId: AID });
    await settle(1);
    other.close();

    expect(getAssessments(CID)[0].id).toBe(AID);
    expect(getScores(CID)[ENR_Y][0].assessmentId).toBe(AID);
    expect(_idRekeys[CID]['sLOCALASSESS1']).toBe(AID);
    // The other tab wrote the shared copy; this one leaves it alone.
    expect(localStorage.getItem(savedKey)).toBe(savedBefore);
  });
});

describe('write-path audit: outbox', () => {
  var originalGetSupabase;
  var originalSetTimeout;
  var Q;

  beforeEach(() => {
    localStorage.clear();
    originalGetSupabase = globalThis.getSupabase;
    originalSetTimeout = globalThis.setTimeout;
    // Backoff timers never fire; the tests drive every attempt with flush().
    globalThis.setTimeout = function () {
      return 0;
    };
    // A fresh copy of the module with nothing in memory.
    Q = loadQueueModule();
    Q.clear();
  });

  afterEach(() => {
    Q.clear();
    window.v2Queue = ORIGINAL_QUEUE;
    globalThis.getSupabase = originalGetSupabase;
    globalThis.setTimeout = originalSetTimeout;
    setOnline(false);
  });

  // Finding 2 (fixed: no attempt cap for transient errors). The old cap was
  // 20 attempts, about 17 minutes of failing while online.
  it('keeps retrying a transient failure past the old attempt cap instead of dead-lettering', async () => {
    setOnline(true);
    Q.configure({ send: () => ({ data: null, error: { message: 'failed to fetch' } }) });
    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });

    for (var i = 0; i < 25; i++) await Q.flush();

    expect(Q.stats().deadLettered).toBe(0);
    expect(Q.stats().queued).toBe(1);
  });

  // Finding 8 (fixed: one tab owns the queue and sends; the others ask it
  // to). Two tabs share one localStorage queue but not _inFlight, so both
  // used to send the first entry and the stale copy could land after the
  // second.
  it('sends each entry from one tab only, in order per key', async () => {
    var tabA = loadQueueModule();
    var tabB = openTab();
    var sent = [];
    var rpc = (name, p) => {
      sent.push(p.p_value);
      return settle(3).then(() => ({ data: null, error: null }));
    };
    tabA.configure({ send: rpc });
    tabB.configure({ send: rpc });
    await settle(1); // tab A holds the lock
    setOnline(true);

    tabA.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    tabA.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 4 });
    await Promise.all([tabA.flush(), tabB.flush()]);
    await settle();

    expect(sent).toEqual([3, 4]);
  });

  // Finding 8: a write queued in a tab that doesn't send still resolves there
  // with the server's answer, relayed by the tab that sent it.
  it('resolves a write queued in one tab when another tab sends it', async () => {
    var tabA = loadQueueModule();
    var tabB = openTab();
    tabA.configure({ send: () => Promise.resolve({ data: { id: 'row-1' }, error: null }) });
    tabB.configure({
      send: () => {
        throw new Error('tab B must not send');
      },
    });
    await settle(1); // tab A holds the lock
    setOnline(true);

    var res = await tabB.push('upsert_note', { p_course_id: CID, p_body: 'x' });

    expect(res).toEqual({ data: { id: 'row-1' }, error: null });
    expect(tabA.stats().owner).toBe(true);
    expect(tabB.stats().owner).toBe(false);
    expect(tabB.stats().queued).toBe(0);
  });

  // Finding 8: when the sending tab closes, the next tab takes the queue
  // (the Web Lock passes to it) and sends what is waiting.
  it('hands the outbox to another tab when the owner closes', async () => {
    var tabA = loadQueueModule();
    var tabB = openTab();
    var sentBy = [];
    var rpcFor = tab => (name, p) => {
      sentBy.push(tab + ':' + p.p_value);
      return settle(3).then(() => ({ data: null, error: null }));
    };
    tabA.configure({ send: rpcFor('A') });
    tabB.configure({ send: rpcFor('B') });
    await settle(1);
    expect(tabA.stats().owner).toBe(true);
    expect(tabB.stats().owner).toBe(false);

    tabB.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    tabB.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'b', p_value: 4 });
    tabA.release();
    setOnline(true);
    await tabB.flush();
    await settle();

    expect(sentBy).toEqual(['B:3', 'B:4']);
    expect(tabB.stats().owner).toBe(true);
    expect(tabA.stats().queued).toBe(0);
    expect(tabB.stats().queued).toBe(0);
  });

  // Finding 8, without Web Locks: the owner keeps a lease in localStorage;
  // letting go of it hands the queue over the same way.
  it('hands the outbox over through the lease when Web Locks are missing', async () => {
    var locks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true, writable: true });
    try {
      var tabA = loadQueueModule();
      var tabB = openTab();
      var sentBy = [];
      var rpcFor = tab => (name, p) => {
        sentBy.push(tab + ':' + p.p_value);
        return settle(3).then(() => ({ data: null, error: null }));
      };
      tabA.configure({ send: rpcFor('A') });
      tabB.configure({ send: rpcFor('B') });
      expect(tabA.stats().owner).toBe(true);
      expect(tabB.stats().owner).toBe(false);

      tabB.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
      tabB.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'b', p_value: 4 });
      tabA.release();
      setOnline(true);
      await tabB.flush();
      await settle();

      expect(sentBy).toEqual(['B:3', 'B:4']);
      expect(tabB.stats().owner).toBe(true);
      expect(tabB.stats().queued).toBe(0);
    } finally {
      Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true });
    }
  });

  // Finding 12, no long-form editor open (fixed: a 401 the refresh could
  // not fix pauses the outbox until the teacher signs in again).
  it('keeps a write queued, not dead-lettered, when the session expired', async () => {
    setOnline(true);
    Q.configure({ send: () => ({ data: null, error: { status: 401, message: 'jwt expired' } }) });
    Q.push('create_observation', { p_course_id: 'c', p_body: 'x', p_enrollment_ids: ['e'] });

    for (var i = 0; i < 21; i++) await Q.flush();

    expect(Q.stats().queued).toBe(1);
    expect(Q.stats().deadLettered).toBe(0);
  });

  // Finding 12, long-form editor open (fixed: handledSessionExpired pauses
  // the outbox like any other expired session).
  it('keeps a write queued when the long-form editor took over a session expiry', async () => {
    setOnline(true);
    Q.configure({
      send: () => ({ data: null, error: { message: 'session_expired', status: 401, handledSessionExpired: true } }),
    });
    Q.push('create_observation', { p_course_id: 'c', p_body: 'x', p_enrollment_ids: ['e'] });

    await Q.flush();

    expect(Q.stats().queued).toBe(1);
    expect(Q.stats().deadLettered).toBe(0);
  });

  // Finding 14 (fixed: a column write is a barrier for its assessment). A
  // score typed after "Reset this column" must not start before the clear has
  // finished.
  it('runs a column clear and a later score on that column in order', async () => {
    var log = [];
    var finish = {};
    Q.configure({
      send: name => {
        log.push('start ' + name);
        return new Promise(resolve => {
          finish[name] = () => {
            log.push('end ' + name);
            resolve({ data: null, error: null });
          };
          if (name !== 'clear_column_scores') finish[name]();
        });
      },
    });
    setOnline(true);

    Q.push('clear_column_scores', { p_assessment_id: 'a' });
    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    await settle();
    finish.clear_column_scores();
    await Q.flush();
    await settle();

    expect(log).toEqual([
      'start clear_column_scores',
      'end clear_column_scores',
      'start upsert_score',
      'end upsert_score',
    ]);
  });

  it('still sends cell writes in one column at the same time', async () => {
    var started = [];
    var finish = [];
    Q.configure({
      send: (name, payload) => {
        started.push(payload.p_enrollment_id);
        return new Promise(resolve => finish.push(() => resolve({ data: null, error: null })));
      },
    });
    setOnline(true);

    Q.push('upsert_score', { p_enrollment_id: 'e1', p_assessment_id: 'a', p_value: 1 });
    Q.push('upsert_score', { p_enrollment_id: 'e2', p_assessment_id: 'a', p_value: 2 });
    Q.push('upsert_tag_score', { p_enrollment_id: 'e3', p_assessment_id: 'a', p_tag_id: 't', p_value: 3 });
    await settle();

    expect(started).toEqual(['e1', 'e2', 'e3']);
    finish.forEach(f => f());
    await Q.flush();
  });

  it('holds a column clear until the earlier scores on that column have finished', async () => {
    var log = [];
    var finish = {};
    Q.configure({
      send: (name, payload) => {
        var who = name + ' ' + (payload.p_enrollment_id || payload.p_assessment_id);
        log.push('start ' + who);
        return new Promise(resolve => {
          finish[who] = () => {
            log.push('end ' + who);
            resolve({ data: null, error: null });
          };
        });
      },
    });
    setOnline(true);

    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    Q.push('clear_column_scores', { p_assessment_id: 'a' });
    Q.push('upsert_score', { p_enrollment_id: 'other', p_assessment_id: 'b', p_value: 1 });
    await settle();
    // The other column is not held; this column's clear is.
    expect(log).toEqual(['start upsert_score e', 'start upsert_score other']);

    finish['upsert_score e']();
    await settle();
    expect(log).toContain('start clear_column_scores a');
    finish['upsert_score other']();
    finish['clear_column_scores a']();
    await Q.flush();
  });

  it('keeps a score typed after a column clear behind the clear, not merged into the score before it', async () => {
    var sent = [];
    Q.configure({
      send: (name, payload) => {
        sent.push(name + ':' + (payload.p_value === undefined ? '' : payload.p_value));
        return { data: null, error: null };
      },
    });
    setOnline(false);

    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 1 });
    Q.push('clear_column_scores', { p_assessment_id: 'a' });
    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    setOnline(true);
    await Q.flush();
    await Q.flush();

    expect(sent).toEqual(['upsert_score:1', 'clear_column_scores:', 'upsert_score:3']);
  });

  it('runs delete_assessment after the scores on that assessment, and later scores after it', async () => {
    var log = [];
    var finish = {};
    Q.configure({
      send: name => {
        log.push('start ' + name);
        return new Promise(resolve => {
          finish[name] = () => {
            log.push('end ' + name);
            resolve({ data: null, error: null });
          };
        });
      },
    });
    setOnline(true);

    Q.push('upsert_score', { p_enrollment_id: 'e', p_assessment_id: 'a', p_value: 3 });
    Q.push('delete_assessment', { p_id: 'a' });
    await settle();
    expect(log).toEqual(['start upsert_score']);

    finish.upsert_score();
    await settle();
    expect(log).toEqual(['start upsert_score', 'end upsert_score', 'start delete_assessment']);
    finish.delete_assessment();
    await Q.flush();
  });
});

describe('write-path audit: class load', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalQuiet;

  const ENROLLMENT_ID = '66666666-6666-4666-8666-666666666666';
  const ASSESSMENT_ID = '55555555-5555-4555-8555-555555555556';
  const TAG_ID = '88888888-8888-4888-8888-888888888888';

  function gradebookPayload(cell) {
    return {
      course: { id: CID },
      students: [
        {
          enrollment_id: ENROLLMENT_ID,
          student_id: STU_Y,
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
      cells: { [ENROLLMENT_ID]: { [ASSESSMENT_ID]: cell } },
    };
  }

  function useServer(payloads) {
    var n = 0;
    globalThis.getSupabase = function () {
      return {
        rpc(name) {
          if (name !== 'get_gradebook') return Promise.resolve({ data: null, error: null });
          var payload = payloads[Math.min(n, payloads.length - 1)];
          n += 1;
          return Promise.resolve({ data: payload, error: null });
        },
      };
    };
  }

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    originalQuiet = _REFRESH_QUIET_MS;
    _REFRESH_QUIET_MS = 0;
    _useSupabase = true;
    localStorage.clear();
    resetSession();
    _loadError = {};
    window.v2Queue = ORIGINAL_QUEUE;
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _REFRESH_QUIET_MS = originalQuiet;
  });

  // Finding 13. Passes today: _v2GradebookToCache rebuilds scores and statuses from the get_gradebook cells first.
  it.skip('drops a score and a status removed on another device', async () => {
    var graded = {
      score: { value: 3, status: 'LATE', comment: '' },
      tag_scores: [{ tag_id: TAG_ID, value: 3 }],
      rubric_scores: [],
    };
    var cleared = { score: { value: null, status: null, comment: '' }, tag_scores: [], rubric_scores: [] };
    useServer([gradebookPayload(graded), gradebookPayload(cleared)]);

    await initData(CID);
    expect(getAssignmentStatus(CID, ENROLLMENT_ID, ASSESSMENT_ID)).toBe('LATE');
    expect((getScores(CID)[ENROLLMENT_ID] || []).length).toBe(1);

    await initData(CID);
    expect(getAssignmentStatus(CID, ENROLLMENT_ID, ASSESSMENT_ID)).toBeNull();
    expect((getScores(CID)[ENROLLMENT_ID] || []).length).toBe(0);
  });
});
