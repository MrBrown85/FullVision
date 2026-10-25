/**
 * Import Roster's review. Rows match the roster by student number, then by
 * name: a matched number with a new name is a name change (kept with their
 * scores), a new row is added, and a student the file leaves out is offered
 * for withdrawal, off unless the teacher ticks it. Nothing changes until
 * Import.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-0000000c1a55';

function student(id, first, last, num) {
  return { id, firstName: first, lastName: last, studentNumber: num, enrolledDate: '2026-09-01' };
}

function names() {
  return getStudents(CID)
    .map(function (s) {
      return fullName(s);
    })
    .sort();
}

describe('Import Roster review', () => {
  var main;
  var originalGetElementById;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    saveStudents(CID, [
      student('s1', 'Fatima', 'Hassan', 'STU-208'),
      student('s2', 'Tyler', 'Rowe', 'STU-215'),
      student('s3', 'Liam', 'Chen', ''),
    ]);
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'students' } });
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
  });

  function importRows(rows) {
    DashClassManager.cmShowImportPreview(rows, 'block-a.csv');
  }

  it('groups the file into new, renamed, missing and unchanged', () => {
    importRows([
      { firstName: 'Fatima', lastName: 'Hassan-Ali', studentNumber: 'STU-208' },
      { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
      { firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' },
    ]);
    var html = main.innerHTML;
    expect(html).toContain('Import Roster: Review Changes');
    expect(html).toContain('New to This Class');
    expect(html).toContain('Noor Al-Rashid');
    expect(html).toContain('Name Changed');
    expect(html).toContain('Fatima Hassan-Ali');
    expect(html).toContain('In Your Class, Not in This File');
    expect(html).toContain('Tyler Rowe');
    expect(html).toContain('Add 1, rename 1.');
    // Nothing has changed yet.
    expect(names()).toEqual(['Fatima Hassan', 'Liam Chen', 'Tyler Rowe']);
  });

  it('adds and renames on Import, and withdraws no one unless ticked', () => {
    importRows([
      { firstName: 'Fatima', lastName: 'Hassan-Ali', studentNumber: 'STU-208' },
      { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
      { firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' },
    ]);
    DashClassManager.handleAction('cmConfirmImport', { dataset: {} });
    expect(names()).toEqual(['Fatima Hassan-Ali', 'Liam Chen', 'Noor Al-Rashid', 'Tyler Rowe']);
    expect(getStudents(CID).find(s => s.studentNumber === 'STU-208').id).toBe('s1');
    expect(getWithdrawnStudents(CID)).toHaveLength(0);
  });

  it('withdraws a missing student the teacher ticks', () => {
    importRows([
      { firstName: 'Fatima', lastName: 'Hassan', studentNumber: 'STU-208' },
      { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
    ]);
    DashClassManager.handleChange({
      dataset: { actionChange: 'cmImportToggle', kind: 'missing', idx: '0' },
      checked: true,
    });
    DashClassManager.handleAction('cmConfirmImport', { dataset: {} });
    expect(names()).toEqual(['Fatima Hassan', 'Liam Chen']);
    expect(getWithdrawnStudents(CID).map(w => w.student.id)).toEqual(['s2']);
  });

  it('Cancel leaves the roster as it was', () => {
    importRows([{ firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' }]);
    DashClassManager.handleAction('cmCancelImport', { dataset: {} });
    expect(main.innerHTML).not.toContain('Review Changes');
    expect(names()).toEqual(['Fatima Hassan', 'Liam Chen', 'Tyler Rowe']);
  });
});

describe('Import Roster file reading', () => {
  it('reads columns by header in any order, with quoted commas', () => {
    var table = DashClassManager.rosterImportTable(
      'Student Number,Name,Usual First Name,Birth Date,Parent Email\n' +
        'STU-301,"Okafor, Cecilia",Cece,2012-05-15,n.okafor@example.com\n',
    );
    expect(table.map).toEqual(['studentNumber', 'fullName', 'preferred', 'dateOfBirth', 'parentEmail']);
    var read = DashClassManager.rosterRowsFromTable(table);
    expect(read.rows).toEqual([
      {
        studentNumber: 'STU-301',
        firstName: 'Cecilia',
        lastName: 'Okafor',
        preferred: 'Cece',
        dateOfBirth: '2012-05-15',
        parentEmails: ['n.okafor@example.com'],
      },
    ]);
  });

  it('handles CRLF, a BOM, "" inside quotes and tab-separated files', () => {
    expect(DashClassManager.parseRosterCsv('\uFEFFa,"b ""c"", d"\r\n1,2\r\n')).toEqual([
      ['a', 'b "c", d'],
      ['1', '2'],
    ]);
    expect(DashClassManager.parseRosterCsv('First Name\tLast Name\nAva\tLee\n')).toEqual([
      ['First Name', 'Last Name'],
      ['Ava', 'Lee'],
    ]);
  });

  it('falls back to the old fixed column order when no header is known', () => {
    var table = DashClassManager.rosterImportTable('Ava,Lee,,she/her,STU-9,2012-01-02,ava@school.ca\n');
    var read = DashClassManager.rosterRowsFromTable(table);
    expect(read.rows[0]).toMatchObject({
      firstName: 'Ava',
      lastName: 'Lee',
      pronouns: 'she/her',
      studentNumber: 'STU-9',
      dateOfBirth: '2012-01-02',
      email: 'ava@school.ca',
    });
  });

  it('keeps known designations and ELL, and counts what it could not read', () => {
    var table = DashClassManager.rosterImportTable(
      'First Name,Last Name,Designations,ELL,DOB,Email\nAva,Lee,Q; ZZ,yes,03/04/2012,not-an-email\n',
    );
    var read = DashClassManager.rosterRowsFromTable(table);
    expect(read.rows[0].designations).toEqual(['Q', 'ELL']);
    expect(read.rows[0].dateOfBirth).toBeUndefined();
    expect(read.skipped).toEqual({ dates: 1, emails: 1, codes: 1 });
  });
});

describe('Import Roster review: details and columns', () => {
  var main;
  var originalGetElementById;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    saveStudents(CID, [student('s1', 'Fatima', 'Hassan', 'STU-208')]);
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'students' } });
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
  });

  it('offers filled-in details for a matched student and applies them on Import', () => {
    var table = DashClassManager.rosterImportTable(
      'Student Number,First Name,Last Name,Pronouns,Date of Birth,Designations\nSTU-208,Fatima,Hassan,she/her,2013-07-09,G\n',
    );
    var read = DashClassManager.rosterRowsFromTable(table);
    DashClassManager.cmShowImportPreview(read.rows, 'myed.csv', table, read.skipped);
    expect(main.innerHTML).toContain('Details Updated');
    expect(main.innerHTML).toContain('Pronouns, Date of Birth, G');
    expect(main.innerHTML).toContain('Columns in This File');
    DashClassManager.handleAction('cmConfirmImport', { dataset: {} });
    var st = getStudents(CID)[0];
    expect(st.pronouns).toBe('she/her');
    expect(st.dateOfBirth).toBe('2013-07-09');
    expect(st.designations).toEqual(['G']);
  });

  it('re-reads the file when a column is matched to a different field', () => {
    var table = DashClassManager.rosterImportTable('First Name,Last Name,Code\nNoor,Al-Rashid,STU-202\n');
    var read = DashClassManager.rosterRowsFromTable(table);
    DashClassManager.cmShowImportPreview(read.rows, 'f.csv', table, read.skipped);
    DashClassManager.handleChange({ dataset: { actionChange: 'cmImportMap', col: '2' }, value: 'studentNumber' });
    DashClassManager.handleAction('cmConfirmImport', { dataset: {} });
    expect(getStudents(CID).find(s => s.firstName === 'Noor').studentNumber).toBe('STU-202');
  });
});
