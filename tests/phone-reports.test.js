/**
 * Reports on students' phones (docs/STUDENT-VOICE-PLAN.md, PR 9):
 * teacher/phone-reports.js builds each student's copy with the app's own
 * grade helpers and runs Sent to Phones; shared/phone-report-view.js draws
 * the copy the same way on the phone and in the teacher's preview; the v2
 * wrappers send the RPCs from migrations/20261025_phone_reports.sql.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'course-pr';
const doc = () => parseHTML('<!doctype html><html><body></body></html>').document;
const mount = html => {
  const box = doc().createElement('div');
  box.innerHTML = html;
  return box;
};

describe('PhoneReports.snapshot', () => {
  const saved = {};
  const stub = (name, fn) => {
    saved[name] = globalThis[name];
    globalThis[name] = fn;
  };
  let mode;

  beforeEach(() => {
    localStorage.clear();
    mode = 'proficiency';
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
    stub('courseGradeMode', () => mode);
    stub('getOverallProficiency', () => 2.9);
    stub('getCourseLetterData', () => ({ S: 'B', R: 76 }));
    stub('getSections', () => [
      {
        id: 's1',
        name: 'Questioning and Predicting',
        shortName: 'Questioning',
        tags: [{ i_can_statements: ['I can ask questions I can test.'] }],
      },
      { id: 's2', name: 'Communicating', tags: [] },
    ]);
    stub('getSectionProficiency', (cid, sid, sec) => (sec === 's1' ? 3.2 : 0));
    stub('getStudentTermRating', () => ({
      narrative: '<p>Cece is <b>curious</b>.</p><p>Next: labs on time.</p><img src=x onerror="window.__ran=1">',
    }));
    stub('getTermAttendance', () => ({ absences: 3, lates: 0 }));
    stub('getReportingTerms', () => []);
    stub('getCoreSelf', () => ({ e1: { '': { PAR: { level: 2, text: 'I forget to check.', date: '2026-11-06' } } } }));
  });
  afterEach(() => {
    Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
  });

  const st = { id: 'e1', firstName: 'Cecilia', preferred: 'Cece', lastName: 'Okafor' };

  it('takes every grade from the app, as the class shows it', () => {
    const d = PhoneReports.snapshot(CID, st, { termId: 'term-1', termLabel: 'Report 1' });
    expect(d).toMatchObject({ name: 'Cece Okafor', first: 'Cece', course: 'Science 8', report: 'Report 1' });
    expect(d.overall).toEqual({ mode: 'proficiency', text: '2.9', level: 3, word: 'Proficient' });
    expect(d.skills).toEqual([
      { name: 'Questioning', line: 'I can ask questions I can test.', text: '3.2', word: 'Proficient', level: 3 },
      { name: 'Communicating', line: '', text: '', word: '', level: 0 },
    ]);
    expect(d.attendance).toEqual({ absent: 3, late: 0 });
    expect(d.self).toEqual({
      at: '2026-11-06',
      items: [{ name: 'Personal Awareness & Responsibility', step: 2, why: 'I forget to check.' }],
    });
  });

  it('a Letter class shows the letter and percent, never a proficiency word', () => {
    mode = 'letter';
    const d = PhoneReports.snapshot(CID, st, { termId: 'term-1', termLabel: 'Report 1' });
    expect(d.overall.mode).toBe('letter');
    expect(d.overall.word).toBe('');
    expect(d.overall.text).toBe('B 76%');
    expect(d.skills[0].word).toBe('');
    expect(d.skills[0].text).toBe('80%');
  });

  it("the teacher's comment becomes plain paragraphs, and nothing in it runs", () => {
    const d = PhoneReports.snapshot(CID, st, { termId: 'term-1', termLabel: 'Report 1' });
    expect(d.comment).toEqual(['Cece is curious.', 'Next: labs on time.']);
    expect(globalThis.window.__ran).toBeUndefined();
  });
});

describe('PhoneReportView', () => {
  const data = {
    name: 'Cece Okafor',
    initials: 'CO',
    first: 'Cece',
    course: 'Science 8',
    report: 'Report 1',
    issued: '2026-11-21T18:00:00Z',
    overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
    skills: [{ name: 'Questioning', line: 'Asking <b>questions</b>', word: 'Proficient', level: 3 }],
    comment: ['Cece is curious.'],
    goal: { text: 'Hand in labs on time.', status: 'Working On It', at: '2026-11-06T18:00:00Z' },
    self: {
      at: '2026-11-06T18:00:00Z',
      items: [{ name: 'Personal Awareness & Responsibility', step: 2, why: 'I forget.' }],
    },
    attendance: { absent: 7, late: 7 },
  };

  it('draws each card the copy has, escaped', () => {
    const box = mount(PhoneReportView.html(data));
    expect(box.querySelector('.pr-name').textContent).toBe('Cece Okafor');
    expect(box.querySelector('.pr-meta').textContent).toBe('Science 8 · Report 1 · Issued Nov 21, 2026');
    expect(box.querySelector('.pr-big').textContent).toBe('Proficient');
    expect(box.querySelector('.pr-scale .on')).toBeTruthy();
    expect(box.querySelector('.pr-rsub').textContent).toBe('Asking <b>questions</b>');
    expect([...box.querySelectorAll('.pr-h')].map(h => h.textContent)).toEqual([
      'Overall',
      'Your Skills in Science 8',
      'From Your Teacher',
      'Your Goal',
      'How You Rated Yourself · Nov 6',
      'Attendance This Year',
    ]);
    expect(box.querySelector('.pr-said').textContent).toBe('You said: Working On It · Nov 6');
    expect(box.querySelector('.pr-fine').textContent).toContain('Your official report card is in MyEd.');
  });

  it('leaves out what the copy lacks; a Letter class gets no four-step scale', () => {
    const box = mount(PhoneReportView.html({ first: 'Sam', overall: { mode: 'letter', text: 'B 76%', level: 3 } }));
    expect([...box.querySelectorAll('.pr-h')].map(h => h.textContent)).toEqual(['Overall']);
    expect(box.querySelector('.pr-big').textContent).toBe('B 76%');
    expect(box.querySelector('.pr-scale')).toBeNull();
  });
});

describe('phone report v2 dispatch', () => {
  let calls;
  let originals;
  const RID = '22222222-2222-4222-8222-222222222222';
  const COURSE = '11111111-1111-4111-8111-111111111111';
  const ENR = '33333333-3333-4333-8333-333333333333';
  beforeEach(() => {
    localStorage.clear();
    calls = [];
    originals = { getSupabase, useSb: _useSupabase };
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload });
        return Promise.resolve({
          data: name === 'issue_report_codes' ? [{ enrollment_id: ENR, code: 'K7M-4QX' }] : { id: RID },
          error: null,
        });
      },
    });
  });
  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    _useSupabase = originals.useSb;
  });

  it('every write carries a key, only server ids go, and nothing is queued', async () => {
    await window.v2.createPhoneReport(COURSE, 1, 'Report 1', '2027-01-31', [
      { enrollment_id: ENR, data: { v: 1 } },
      { enrollment_id: 'local-id', data: {} },
    ]);
    await window.v2.updatePhoneReport(RID, [{ enrollment_id: ENR, data: { v: 1 } }]);
    await window.v2.closePhoneReport(RID);
    const codes = await window.v2.issueReportCodes(RID, [ENR, 'local-id']);
    expect(calls.map(c => c.name)).toEqual([
      'create_phone_report',
      'update_phone_report',
      'close_phone_report',
      'issue_report_codes',
    ]);
    expect(calls[0].payload).toMatchObject({
      p_course_id: COURSE,
      p_term: 1,
      p_term_label: 'Report 1',
      p_expires_on: '2027-01-31',
      p_students: [{ enrollment_id: ENR, data: { v: 1 } }],
    });
    expect(calls[3].payload.p_enrollment_ids).toEqual([ENR]);
    calls.forEach(c => expect(c.payload.p_idempotency_key).toBeTruthy());
    expect(codes.data).toEqual([{ enrollment_id: ENR, code: 'K7M-4QX' }]);
    expect(localStorage.getItem('fv-outbox') || '').not.toContain('phone_report');
  });

  it('a local id goes nowhere', async () => {
    await window.v2.createPhoneReport('c-local', 1, 'R', '2027-01-31', []);
    await window.v2.closePhoneReport('local');
    expect(calls).toHaveLength(0);
  });
});

describe('Sent to Phones in Demo Mode', () => {
  let originals;
  let root;
  beforeEach(() => {
    localStorage.clear();
    originals = {
      isDemoMode: globalThis.isDemoMode,
      print: QrSlips.print,
      document: globalThis.document,
    };
    globalThis.isDemoMode = () => true;
    globalThis.document = doc();
    PhoneReports._reset();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
    saveStudents(CID, [
      { id: 'e1', firstName: 'Cece', lastName: 'Okafor', dateOfBirth: '2012-05-15' },
      { id: 'e2', firstName: 'Sam', lastName: 'Lee' },
    ]);
    root = globalThis.document.createElement('div');
  });
  afterEach(() => {
    globalThis.isDemoMode = originals.isDemoMode;
    QrSlips.print = originals.print;
    globalThis.document = originals.document;
  });

  it('before sending: the last day, and who has no birthday on file', () => {
    root.innerHTML = PhoneReports.panelHtml(CID, { termId: 'term-1', termLabel: 'Report 1' });
    expect(root.querySelector('.pp-title').textContent).toBe('Send Report 1 to Students’ Phones');
    expect(root.querySelector('#pp-until').getAttribute('value')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(root.querySelector('.pp-warn').textContent).toContain('1 student has no birthday on file');
    expect(root.querySelector('.pp-warn').textContent).toContain('Sam Lee');
  });

  it('Send keeps a copy per student, prints a slip each, and the panel counts who opened', async () => {
    const printed = [];
    QrSlips.print = (cid, q, codes) => printed.push({ q, codes });
    await PhoneReports.send(CID, { termId: 'term-1', termLabel: 'Report 1' }, '2027-01-31');
    const rep = PhoneReports.forTerm(CID, 1);
    expect(rep.students.map(s => s.enrollment_id).sort()).toEqual(['e1', 'e2']);
    expect(rep.students[0].data.report).toBe('Report 1');
    expect(printed[0].codes).toHaveLength(2);
    expect(printed[0].q).toMatchObject({ title: 'Report 1', closes_on: '2027-01-31' });
    expect(printed[0].q.slipNote).toContain('like a password');
    root.innerHTML = PhoneReports.panelHtml(CID, { termId: 'term-1', termLabel: 'Report 1' });
    expect(root.querySelector('.pp-title').textContent).toBe('Report 1 on Students’ Phones');
    expect(root.querySelector('.pp-stats').textContent).toContain('0 of 2Opened');
    expect(root.querySelectorAll('[data-action="ppNewSlip"]')).toHaveLength(2);
    await PhoneReports.close(CID, rep);
    root.innerHTML = PhoneReports.panelHtml(CID, { termId: 'term-1', termLabel: 'Report 1' });
    expect(root.querySelector('.pp-sub').textContent).toContain('Links closed');
    expect(root.querySelector('[data-action="ppPrint"]')).toBeNull();
  });
});
