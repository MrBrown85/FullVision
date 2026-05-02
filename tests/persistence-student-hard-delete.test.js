/**
 * Persistence: hard-delete student via window.v2.deleteStudent (P6.7).
 *
 * Background: today's deleteStudent in teacher/ui.js cleaned LS through
 * each entity's save function. saveStudents fires withdraw_enrollment via
 * the diff path — a soft-delete that preserves server data and silently
 * accumulates. xlsx row 73 says "Delete (full, cascade)" with the existing
 * (but unused) window.v2.deleteStudent RPC at shared/data.js. P6.7 wires
 * that RPC and switches LS cleanup to direct _saveCourseField calls so we
 * don't fire redundant withdraw_enrollment / save_score / save_term_rating
 * RPCs against rows that delete_student is about to cascade-delete.
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
  saveStudents(CID, [
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
  _saveCourseField('statuses', CID, {
    [SID + ':' + AID]: 'NS',
    [OTHER_SID + ':' + AID]: 'LATE',
  });
  _saveCourseField('observations', CID, {
    [SID]: [{ id: 'ob1', text: 'Observation A' }],
  });
  _saveCourseField('termRatings', CID, { [SID]: { 1: { dims: {}, narrative: 'Term 1' } } });
}

describe('Persistence: hard-delete student (P6.7)', () => {
  var originalGetSupabase;
  var originalUseSupabase;

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
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('fires window.v2.deleteStudent (delete_student RPC) with the right student id', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    var deleteCall = client.calls.find(function (c) {
      return c.name === 'delete_student';
    });
    expect(deleteCall, 'delete_student must fire').toBeDefined();
    expect(deleteCall.payload.p_id).toBe(SID);
  });

  it('does NOT fire withdraw_enrollment redundantly', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    var withdrawCalls = client.calls.filter(function (c) {
      return c.name === 'withdraw_enrollment';
    });
    expect(withdrawCalls).toHaveLength(0);
  });

  it('removes the student from every per-student LS field', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    expect(getStudents(CID).map(s => s.id)).not.toContain(SID);
    expect(getStudents(CID).map(s => s.id)).toContain(OTHER_SID);
    expect(getScores(CID)[SID]).toBeUndefined();
    expect(getScores(CID)[OTHER_SID]).toBeDefined(); // other student's data preserved
    expect(getGoals(CID)[SID]).toBeUndefined();
    expect(getGoals(CID)[OTHER_SID]).toBeDefined();
    expect(getReflections(CID)[SID]).toBeUndefined();
    expect(getNotes(CID)[SID]).toBeUndefined();
    expect(getFlags(CID)[SID]).toBeUndefined();
    expect(getQuickObs(CID)[SID]).toBeUndefined();
    expect(getTermRatings(CID)[SID]).toBeUndefined();
  });

  it("removes only this student's composite-key statuses, preserves others", () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    var statuses = getAssignmentStatuses(CID);
    expect(statuses[SID + ':' + AID]).toBeUndefined();
    expect(statuses[OTHER_SID + ':' + AID]).toBe('LATE');
  });

  it('returns a complete snapshot for undo', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    var snapshot = deleteStudent(CID, SID);

    expect(snapshot.student.id).toBe(SID);
    expect(snapshot.scores).toHaveLength(1);
    expect(snapshot.goals).toBeDefined();
    expect(snapshot.reflections).toBeDefined();
    expect(snapshot.notes).toBeDefined();
    expect(snapshot.flagged).toBe(true);
    expect(snapshot.statuses[SID + ':' + AID]).toBe('NS');
    expect(snapshot.quickObs).toBeDefined();
    expect(snapshot.termRatings).toBeDefined();
  });

  it('does NOT fire delete_student in demo mode (LS cleanup still happens)', () => {
    localStorage.setItem('gb-demo-mode', '1');
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    expect(client.calls.find(c => c.name === 'delete_student')).toBeUndefined();
    // LS still cleared
    expect(getStudents(CID).map(s => s.id)).not.toContain(SID);

    localStorage.removeItem('gb-demo-mode');
  });

  it('does NOT fire delete_student when _useSupabase is false', () => {
    _useSupabase = false;
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    expect(client.calls.find(c => c.name === 'delete_student')).toBeUndefined();
    expect(getStudents(CID).map(s => s.id)).not.toContain(SID);
  });

  it('integration — silent dataloss regression guard for full hard-delete', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    seedStudentData();

    deleteStudent(CID, SID);

    // Single canonical RPC fires (delete_student); the cascade chain handles
    // the rest server-side via FKs.
    var rpcNames = client.calls.map(function (c) {
      return c.name;
    });
    expect(rpcNames).toContain('delete_student');
    // No redundant per-entity RPCs against rows that are about to be cascade-deleted.
    expect(rpcNames).not.toContain('withdraw_enrollment');
    expect(rpcNames).not.toContain('save_term_rating');
    expect(rpcNames).not.toContain('delete_note');
  });
});
