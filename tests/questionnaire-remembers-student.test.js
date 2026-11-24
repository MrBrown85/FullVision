/**
 * The Term Questionnaire remembers its student per class (page-reports.js,
 * _tqOpen / _tqRemember): leave Reports for another page, come back, and the
 * same student is open. A student in the address wins; a remembered student
 * no longer in the class opens the first. The key starts gb-, so signing out
 * wipes it.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

// setup.js stubs PageReports for the router; this loads the real page.
runInThisContext(readFileSync('teacher/page-reports.js', 'utf-8'), { filename: 'teacher/page-reports.js' });

const { tqOpen, tqRemember } = PageReports._helpers;
const RQ = ReportQuestionnaire;
const CID = 'course-remember';
const OTHER = 'course-remember-2';
const STUDENTS = [
  { id: 'stu-hopper', firstName: 'Grace', lastName: 'Hopper' },
  { id: 'stu-lovelace', firstName: 'Ada', lastName: 'Lovelace' },
  { id: 'stu-turing', firstName: 'Alan', lastName: 'Turing' },
];
const current = () => RQ.getTqStudents()[RQ.tqStudentIndex].id;

describe('the questionnaire remembers its student', () => {
  beforeEach(() => {
    localStorage.clear();
    [CID, OTHER].forEach(cid => {
      _cache.students[cid] = STUDENTS.map(s => Object.assign({}, s, { designations: [] }));
    });
    RQ.configure({ activeCourse: CID });
    RQ.tqStudentIndex = 0;
  });

  it('opens the student remembered for the class', () => {
    tqRemember(CID, 'stu-turing');
    tqOpen(CID);
    expect(current()).toBe('stu-turing');
  });

  it('opens the student in the address over the remembered one', () => {
    tqRemember(CID, 'stu-turing');
    tqOpen(CID, 'stu-lovelace');
    expect(current()).toBe('stu-lovelace');
  });

  it('remembers each class apart', () => {
    tqRemember(CID, 'stu-turing');
    tqRemember(OTHER, 'stu-lovelace');
    expect(tqRemember(CID)).toBe('stu-turing');
    expect(tqRemember(OTHER)).toBe('stu-lovelace');
  });

  it('opens the first student with nothing remembered, or a student who has left', () => {
    tqOpen(CID);
    expect(current()).toBe('stu-hopper');
    tqRemember(CID, 'stu-gone');
    RQ.tqStudentIndex = 2;
    tqOpen(CID);
    expect(current()).toBe('stu-hopper');
  });

  it('keeps it under a gb- key, which signing out wipes', () => {
    tqRemember(CID, 'stu-turing');
    expect(localStorage.getItem('gb-tq-student-' + CID)).toBe('stu-turing');
  });
});
