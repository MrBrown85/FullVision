/**
 * v2 student + enrollment CRUD dispatch tests — shared/data.js (Phase 4.1)
 *
 * Covers:
 *   _canonicalEnrollStudent        → create_student_and_enroll
 *   _canonicalUpdateStudent        → update_student
 *   _canonicalUpdateEnrollment     → update_enrollment
 *   _canonicalWithdrawEnrollment   → withdraw_enrollment
 *   window.reorderRoster           → reorder_roster
 *   window.bulkApplyPronouns       → bulk_apply_pronouns
 *   window.importRosterCsv         → import_roster_csv
 *   window.setEnrollmentFlag       → update_enrollment (is_flagged patch)
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

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
      var call = client.calls.find(function (c) { return c.name === 'create_student_and_enroll'; });
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
      });
    });

    it('passes existing personId when it is a UUID (re-enrollment path)', async () => {
      var s = { id: 'temp', firstName: 'X', personId: STU };
      await _canonicalEnrollStudent(client, CID, s, 0);
      var call = client.calls.find(function (c) { return c.name === 'create_student_and_enroll'; });
      expect(call.payload.p_existing_student_id).toBe(STU);
    });

    it('nullifies non-UUID personId', async () => {
      var s = { id: 'temp', firstName: 'X', personId: 'legacy-string' };
      await _canonicalEnrollStudent(client, CID, s, 0);
      var call = client.calls.find(function (c) { return c.name === 'create_student_and_enroll'; });
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
        firstName: 'Ada', lastName: 'Lovelace', preferred: 'Ada',
        pronouns: 'she/her', studentNumber: '42',
        email: 'a@b.com', dateOfBirth: '2012-05-01',
      };
      await _canonicalUpdateStudent(client, STU, s);
      var call = client.calls.find(function (c) { return c.name === 'update_student'; });
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
      var call = client.calls.find(function (c) { return c.name === 'update_student'; });
      expect(call.payload.p_patch.first_name).toBe('');
      expect(call.payload.p_patch.last_name).toBeNull();
      expect(call.payload.p_patch.preferred_name).toBeNull();
    });
  });

  describe('_canonicalUpdateEnrollment', () => {
    it('patches designations + roster_position', async () => {
      await _canonicalUpdateEnrollment(client, ENR, { designations: ['IEP', 'ELL'] }, 7);
      var call = client.calls.find(function (c) { return c.name === 'update_enrollment'; });
      expect(call.payload.p_id).toBe(ENR);
      expect(call.payload.p_patch.designations).toEqual(['IEP', 'ELL']);
      expect(call.payload.p_patch.roster_position).toBe(7);
    });

    it('includes is_flagged only when isFlagged is a boolean', async () => {
      await _canonicalUpdateEnrollment(client, ENR, { isFlagged: true }, 0);
      var call1 = client.calls.find(function (c) { return c.name === 'update_enrollment'; });
      expect(call1.payload.p_patch.is_flagged).toBe(true);

      client.calls.length = 0;
      await _canonicalUpdateEnrollment(client, ENR, {}, 0);
      var call2 = client.calls.find(function (c) { return c.name === 'update_enrollment'; });
      expect(call2.payload.p_patch.is_flagged).toBeUndefined();
    });
  });

  describe('_canonicalWithdrawEnrollment', () => {
    it('calls withdraw_enrollment with the enrollment id', async () => {
      await _canonicalWithdrawEnrollment(client, ENR);
      var call = client.calls.find(function (c) { return c.name === 'withdraw_enrollment'; });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({ p_id: ENR });
    });
  });

  describe('window.reorderRoster', () => {
    it('calls reorder_roster with the filtered UUID list', async () => {
      await window.reorderRoster([ENR, 'not-a-uuid', STU]);
      var call = client.calls.find(function (c) { return c.name === 'reorder_roster'; });
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
      var call = client.calls.find(function (c) { return c.name === 'bulk_apply_pronouns'; });
      expect(call.payload).toEqual({ p_student_ids: [STU], p_pronouns: 'they/them' });
    });

    it('passes null when pronouns is empty (clears)', async () => {
      await window.bulkApplyPronouns([STU], '');
      var call = client.calls.find(function (c) { return c.name === 'bulk_apply_pronouns'; });
      expect(call.payload.p_pronouns).toBeNull();
    });
  });

  describe('window.importRosterCsv', () => {
    it('calls import_roster_csv with course id + row array', async () => {
      var rows = [{ first_name: 'Ada', last_name: 'Lovelace' }];
      await window.importRosterCsv(CID, rows);
      var call = client.calls.find(function (c) { return c.name === 'import_roster_csv'; });
      expect(call.payload).toEqual({ p_course_id: CID, p_rows: rows });
    });

    it('skips dispatch when course id is not a UUID', async () => {
      await window.importRosterCsv('legacy-id', []);
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.setEnrollmentFlag', () => {
    it('calls update_enrollment with an is_flagged patch', async () => {
      await window.setEnrollmentFlag(ENR, true);
      var call = client.calls.find(function (c) { return c.name === 'update_enrollment'; });
      expect(call.payload).toEqual({
        p_id: ENR,
        p_patch: { is_flagged: true },
      });
    });

    it('coerces falsy flag to false', async () => {
      await window.setEnrollmentFlag(ENR, 0);
      var call = client.calls.find(function (c) { return c.name === 'update_enrollment'; });
      expect(call.payload.p_patch.is_flagged).toBe(false);
    });

    it('skips dispatch on non-UUID enrollment id', async () => {
      await window.setEnrollmentFlag('junk', true);
      expect(client.calls).toHaveLength(0);
    });
  });
});
