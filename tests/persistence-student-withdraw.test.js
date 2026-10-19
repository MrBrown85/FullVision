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
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

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
