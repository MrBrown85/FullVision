/**
 * Approve and Next on the Term Questionnaire (teacher/report-questionnaire.js,
 * fullvision-generate-plan PR 11a/11c): after an approval it opens the next
 * student not yet approved, round to the top of the roster; once every
 * comment is approved it stays on the student, never handing over to
 * Progress Reports. The roster and ↑ ↓ (tqNextStudent) still move without
 * approving and hand over after the last student.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const CID = 'course-approve-next';
const TERM = 'term-1';
const STUDENTS = [
  { id: 'stu-hopper', firstName: 'Grace', lastName: 'Hopper', pronouns: 'she/her' },
  { id: 'stu-lovelace', firstName: 'Ada', lastName: 'Lovelace', pronouns: 'she/her' },
  { id: 'stu-turing', firstName: 'Alan', lastName: 'Turing', pronouns: 'he/him' },
];
const TEXT = 'A short comment for the report.';

function seed() {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = STUDENTS.map(s => Object.assign({}, s, { designations: [] }));
  _cache.learningMaps[CID] = {
    sections: [{ id: 'sec-1', name: 'Evidence', shortName: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 4 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: ['t1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  _cache.scores[CID] = {};
  STUDENTS.forEach(s => {
    _cache.scores[CID][s.id] = Array.from({ length: 4 }, (_, i) => ({
      assessmentId: 'a' + i,
      tagId: 't1',
      score: 3,
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    }));
  });
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  clearProfCache();
  STUDENTS.forEach(s => upsertTermRating(CID, s.id, TERM, { narrative: TEXT }));
}

describe('Approve and Next', () => {
  let hadDoc, oldDoc, oldBank, onLast, renders;
  const current = () => RQ.getTqStudents()[RQ.tqStudentIndex];
  const approved = id => !!(getStudentTermRating(CID, id, TERM) || {}).approvedAt;
  const indexOf = id => RQ.getTqStudents().findIndex(s => s.id === id);

  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    oldBank = window.PersonalBank;
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    window.PersonalBank = oldBank;
  });
  beforeEach(() => {
    localStorage.clear();
    seed();
    // "Suggested for Your Bank" is its own sheet, out of this test's way.
    window.PersonalBank = undefined;
    onLast = 0;
    renders = 0;
    const box = {
      value: TEXT,
      dataset: {
        cid: CID,
        term: TERM,
        get sid() {
          return current().id;
        },
      },
      style: {},
      scrollHeight: 0,
      focus() {},
      select() {},
    };
    globalThis.document = {
      getElementById: id => (id === 'tq-narrative' ? box : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    };
    RQ.configure({
      activeCourse: CID,
      renderReports: () => {
        renders++;
      },
      onLastStudent: () => {
        onLast++;
      },
    });
    RQ.tqStudentIndex = 0;
  });
  afterEach(() => {
    delete COURSES[CID];
    clearProfCache();
  });

  it('sorts the roster by last name and starts with nothing approved', () => {
    expect(RQ.getTqStudents().map(s => s.id)).toEqual(['stu-hopper', 'stu-lovelace', 'stu-turing']);
    expect(RQ.approveBlockers(current())).toEqual([]);
    expect(STUDENTS.some(s => approved(s.id))).toBe(false);
  });

  it('opens the next student down the roster, as before', () => {
    RQ.tqStudentIndex = indexOf('stu-lovelace');
    RQ.tqApproveNext();
    expect(approved('stu-lovelace')).toBe(true);
    expect(current().id).toBe('stu-turing');
    expect(onLast).toBe(0);
  });

  it('on the last student, with others unapproved, goes round to the top: never to Progress Reports', () => {
    RQ.tqStudentIndex = indexOf('stu-lovelace');
    RQ.tqApproveNext();
    expect(current().id).toBe('stu-turing');
    RQ.tqApproveNext();
    expect(approved('stu-turing')).toBe(true);
    expect(current().id).toBe('stu-hopper');
    expect(onLast).toBe(0);
  });

  it('skips approved students between this one and the next unapproved', () => {
    upsertTermRating(CID, 'stu-lovelace', TERM, { approvedAt: '2026-10-30T10:00:00.000Z' });
    RQ.tqStudentIndex = indexOf('stu-hopper');
    RQ.tqApproveNext();
    expect(current().id).toBe('stu-turing');
    expect(onLast).toBe(0);
  });

  it('stays put, drawn again, once every comment is approved', () => {
    upsertTermRating(CID, 'stu-hopper', TERM, { approvedAt: '2026-10-30T10:00:00.000Z' });
    upsertTermRating(CID, 'stu-turing', TERM, { approvedAt: '2026-10-30T10:00:00.000Z' });
    RQ.tqStudentIndex = indexOf('stu-lovelace');
    renders = 0;
    RQ.tqApproveNext();
    expect(approved('stu-lovelace')).toBe(true);
    expect(current().id).toBe('stu-lovelace');
    expect(renders).toBe(1);
    expect(onLast).toBe(0);
  });

  it('does nothing while a check keeps Approve and Next off', () => {
    _cache.statuses[CID] = { 'stu-hopper:a0': 'NS' };
    clearProfCache();
    RQ.tqStudentIndex = indexOf('stu-hopper');
    expect(RQ.approveBlockers(current())).toContain('missing');
    RQ.tqApproveNext();
    expect(approved('stu-hopper')).toBe(false);
    expect(current().id).toBe('stu-hopper');
  });

  it('the roster’s next (↓) still moves without approving and hands over after the last student', () => {
    RQ.tqStudentIndex = indexOf('stu-lovelace');
    RQ.tqNextStudent();
    expect(current().id).toBe('stu-turing');
    expect(STUDENTS.some(s => approved(s.id))).toBe(false);
    RQ.tqNextStudent();
    expect(current().id).toBe('stu-turing');
    expect(onLast).toBe(1);
  });
});

describe('⌘ Return on an earlier report’s tab (live run: it approved and moved on)', () => {
  let hadDoc, oldDoc, oldBank;
  const current = () => RQ.getTqStudents()[RQ.tqStudentIndex];
  const press = () => {
    let stopped = false;
    RQ.handleKey({
      key: 'Enter',
      metaKey: true,
      target: { id: 'tq-generate', dataset: {}, closest: () => null },
      preventDefault: () => (stopped = true),
    });
    return stopped;
  };
  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    oldBank = window.PersonalBank;
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    window.PersonalBank = oldBank;
  });
  beforeEach(() => {
    localStorage.clear();
    seed();
    window.PersonalBank = undefined;
    // Report 2, with Report 1's comment as the earlier tab.
    STUDENTS.forEach(s => upsertTermRating(CID, s.id, 'term-2', { narrative: TEXT }));
    const period = { value: 'Report 2', selectedIndex: 0, options: [{ value: 'Report 2', text: 'Report 2' }] };
    globalThis.document = {
      getElementById: id => (id === 'report-period' ? period : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    };
    RQ.configure({ activeCourse: CID, renderReports: () => {}, onLastStudent: () => {} });
    RQ.tqStudentIndex = 0;
  });
  afterEach(() => {
    delete COURSES[CID];
    clearProfCache();
  });

  it('does nothing while the Term 1 tab is open', () => {
    expect(ReportBlocks.getTermId()).toBe('term-2');
    RQ.tqCommentTab('term-1');
    expect(press()).toBe(true);
    expect(current().id).toBe('stu-hopper');
    expect(getStudentTermRating(CID, 'stu-hopper', 'term-2').approvedAt).toBeFalsy();
    expect(getStudentTermRating(CID, 'stu-hopper', 'term-1').approvedAt).toBeFalsy();
  });

  it('still approves and moves on from This Report', () => {
    RQ.tqCommentTab('this');
    press();
    expect(getStudentTermRating(CID, 'stu-hopper', 'term-2').approvedAt).toBeTruthy();
    expect(current().id).toBe('stu-lovelace');
  });
});
