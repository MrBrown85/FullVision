/**
 * Enter in the class manager's Add Student form saves the student, as the
 * Save button does. From the 2026-10-16 Demo Mode test, where Enter did
 * nothing.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-enter';

function keyEvent(key, target) {
  return {
    key,
    target,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function field(type = 'text', inForm = true) {
  return { tagName: 'INPUT', type, closest: sel => (inForm && sel === '#cm-add-student-form' ? {} : null) };
}

describe('Add Student form: Enter saves', () => {
  var originalGetElementById;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 9' } });
    _cache.students[CID] = [];
    originalGetElementById = document.getElementById;
    document.getElementById = id => {
      if (id === 'cm-add-first') return { value: 'Amara', style: {} };
      if (id === 'cm-add-last') return { value: 'Osei', style: {} };
      return originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    DashClassManager.resetState();
  });

  it('saves the student on Enter in a name field', () => {
    const e = keyEvent('Enter', field());
    expect(DashClassManager.handleKeydown(e)).toBe(true);
    expect(e.prevented).toBe(true);
    expect(getStudents(CID).map(s => [s.firstName, s.lastName])).toEqual([['Amara', 'Osei']]);
  });

  it('ignores other keys, checkboxes and fields outside the form', () => {
    expect(DashClassManager.handleKeydown(keyEvent('a', field()))).toBe(false);
    expect(DashClassManager.handleKeydown(keyEvent('Enter', field('checkbox')))).toBe(false);
    expect(DashClassManager.handleKeydown(keyEvent('Enter', field('text', false)))).toBe(false);
    expect(getStudents(CID)).toEqual([]);
  });
});
