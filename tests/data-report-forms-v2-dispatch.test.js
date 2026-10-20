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
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    await window.v2.listReportTemplates();
    expect(client.calls).toHaveLength(0);
    delete globalThis.isDemoMode;
  });
});
