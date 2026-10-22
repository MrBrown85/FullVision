/**
 * Class Management's Grading tab. Each calculation method shows its result on
 * the same example scores, the % shows as the class rounds it, and switching
 * the method says how many students it moves before it changes anything.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000g7ab';
const TAG = 'tag-1';
const SEC = 'sec-1';
const EXAMPLE = [1, 2, 2, 3, 4];

function student(id, first, last) {
  return { id, firstName: first, lastName: last, enrolledDate: '2026-09-01' };
}

// Two students: Amara's scores move under Mean, Bo's (all 3s) don't.
function seedClass(config) {
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
  _cache.courseConfigs[CID] = config || {};
  saveStudents(CID, [student('s1', 'Amara', 'Osei'), student('s2', 'Bo', 'Tran')]);
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: SEC, name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = ['a', 'b', 'c'].map(function (id, i) {
    return {
      id,
      title: 'Lab ' + id,
      scoreMode: 'proficiency',
      tagIds: [TAG],
      type: 'summative',
      date: '2026-10-0' + (i + 1),
    };
  });
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'a', tagId: TAG, score: 1, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 2, date: '2026-10-02' },
      { assessmentId: 'c', tagId: TAG, score: 4, date: '2026-10-03' },
    ],
    s2: [
      { assessmentId: 'a', tagId: TAG, score: 3, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 3, date: '2026-10-02' },
    ],
  };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('calculation method examples', () => {
  it('gives each method its result on 1, 2, 2, 3, 4', () => {
    expect(calcMethodExample(EXAMPLE, 'mostRecent', 0.65)).toBe(4);
    expect(calcMethodExample(EXAMPLE, 'highest', 0.65)).toBe(4);
    expect(calcMethodExample(EXAMPLE, 'average', 0.65)).toBeCloseTo(2.4);
    expect(calcMethodExample(EXAMPLE, 'median', 0.65)).toBe(2);
    expect(calcMethodExample(EXAMPLE, 'mode', 0.65)).toBe(2);
    expect(calcMethodExample(EXAMPLE, 'decayingAvg', 0.65)).toBeCloseTo(3.51, 2);
  });
});

describe('course % as the class shows it', () => {
  beforeEach(() => seedClass());
  it('rounds to a whole number or one decimal', () => {
    _cache.courseConfigs[CID] = { roundPercent: true };
    expect(formatCoursePercent(CID, 85.94)).toBe('86%');
    _cache.courseConfigs[CID] = { roundPercent: false };
    expect(formatCoursePercent(CID, 85.94)).toBe('85.9%');
    expect(formatCoursePercent(CID, null)).toBe('—');
  });
});

describe('switching the calculation method', () => {
  var confirms;
  var originalConfirm;
  var originalGetElementById;
  var main;

  beforeEach(() => {
    localStorage.clear();
    seedClass();
    confirms = [];
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title, message, okLabel, run: onConfirm });
    };
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    document.getElementById = originalGetElementById;
  });

  it('previews how many students move without changing the saved method', () => {
    const preview = previewCalcMethodChange(CID, 'average');
    expect(preview).toMatchObject({ changed: 1, total: 2 });
    expect(preview.example).toEqual({ name: 'Amara Osei', before: '4.0', after: '2.3' });
    expect(getCourseConfig(CID).calcMethod).toBeUndefined();
    expect(getOverallProficiency(CID, 's1')).toBe(4);
  });

  it('asks first, then saves the method only when the teacher agrees', () => {
    DashClassManager.handleAction('cmSetCalcMethod', { dataset: { value: 'average' } });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Change Calculation Method to Mean?');
    expect(confirms[0].message).toContain('1 of your 2 students');
    expect(confirms[0].message).toContain('Amara Osei goes from 4.0 to 2.3');
    expect(COURSES[CID].calcMethod).toBe('mostRecent');

    confirms[0].run();
    expect(COURSES[CID].calcMethod).toBe('average');
    expect(getCourseConfig(CID).calcMethod).toBe('average');
  });

  it('changes at once when no student would move', () => {
    _cache.scores[CID] = {};
    clearProfCache();
    DashClassManager.handleAction('cmSetCalcMethod', { dataset: { value: 'highest' } });
    expect(confirms).toHaveLength(0);
    expect(COURSES[CID].calcMethod).toBe('highest');
  });

  it('draws the tab with the method rule and the student check', () => {
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('Exactly How Most Recent Score Works');
    expect(main.innerHTML).toContain('Check With a Student');
    expect(main.innerHTML).toContain('Not used in a Proficiency class');
  });
});
