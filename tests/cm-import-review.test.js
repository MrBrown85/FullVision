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
