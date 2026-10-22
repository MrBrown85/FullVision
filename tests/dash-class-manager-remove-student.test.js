/**
 * Class manager roster — the X button withdraws the student it is next to.
 *
 * The roster is rendered for cmSelectedCourse, but the remove action once
 * looked the student up in _activeCourse. Those diverge whenever the
 * manager's selection moves on its own (cmSelectClass), or when
 * page-dashboard re-injects its own activeCourse through CM.configure. The
 * lookup then searched the wrong course, found nothing, and returned — so the
 * X button silently did nothing.
 *
 * Removing a student withdraws them (docs/DECISIONS.md, "Students are
 * removed by withdrawal, not deletion"): the Withdrawn list under the roster
 * has Re-enrol and the permanent delete, the second step.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const A = 'course-a';
const B = 'course-b';

function student(id, first, last) {
  return { id: id, firstName: first, lastName: last, designations: [], sortName: last + ' ' + first };
}

function stubEl(dataset) {
  return { dataset: dataset };
}

function ids(cid) {
  return getStudents(cid).map(function (s) {
    return s.id;
  });
}

function withdrawnIds(cid) {
  return getWithdrawnStudents(cid).map(function (w) {
    return w.student.id;
  });
}

describe('class manager — remove student', () => {
  var originalConfirm;
  var originalToast;
  var confirms;
  var main;
  var originalGetElementById;

  // The page Class Management last rendered (the test document is a stub).
  function page() {
    return main.innerHTML;
  }

  beforeEach(() => {
    localStorage.clear();
    [
      'students',
      'scores',
      'goals',
      'reflections',
      'notes',
      'flags',
      'statuses',
      'observations',
      'termRatings',
      'overrides',
      'studentProfileSummaries',
      'withdrawn',
      'assessments',
    ].forEach(function (field) {
      if (_cache[field]) _cache[field] = {};
    });
    _cache.config = {};
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    saveCourses({
      [A]: { id: A, name: 'Course A' },
      [B]: { id: B, name: 'Course B' },
    });
    saveStudents(A, [student('a1', 'Amara', 'Osei'), student('a2', 'Bo', 'Tran')]);
    saveStudents(B, [student('b1', 'Cass', 'Lund'), student('b2', 'Dev', 'Rao')]);

    originalConfirm = globalThis.showConfirm;
    originalToast = globalThis.showUndoToast;
    confirms = [];
    // Auto-accept the confirm dialog and swallow the undo toast.
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title: title, message: message, okLabel: okLabel, okStyle: okStyle });
      onConfirm();
    };
    globalThis.showUndoToast = function () {};

    DashClassManager.configure({ activeCourse: A, onRender: function () {}, onCourseChange: function () {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    globalThis.showUndoToast = originalToast;
    DashClassManager.resetState();
    document.getElementById = originalGetElementById;
  });

  it('withdraws the student when the manager shows the dashboard active course', () => {
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(ids(A)).toEqual(['a2']);
    expect(withdrawnIds(A)).toEqual(['a1']);
  });

  it('withdraws from the selected class when it is not the active course', () => {
    // The manager's selection moves; _activeCourse stays on A. This is the
    // divergence that made the button a no-op.
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

    expect(ids(B)).toEqual(['b2']);
    expect(withdrawnIds(B)).toEqual(['b1']);
  });

  it('does not touch the active course when withdrawing from another class', () => {
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

    expect(ids(A)).toEqual(['a1', 'a2']);
    expect(withdrawnIds(A)).toEqual([]);
  });

  it('ignores a student id that is not in the selected class', () => {
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(ids(A)).toEqual(['a1', 'a2']);
    expect(ids(B)).toEqual(['b1', 'b2']);
  });

  it('says what withdrawing keeps, and never that it cannot be undone', () => {
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Withdraw student');
    expect(confirms[0].okLabel).toBe('Withdraw');
    expect(confirms[0].okStyle).not.toBe('danger');
    expect(confirms[0].message).toContain('kept');
    expect(confirms[0].message).toContain('re-enrol');
    expect(confirms[0].message).not.toMatch(/cannot be undone/i);
  });

  it('keeps every record out of the class while withdrawn', () => {
    _saveCourseField('scores', A, {
      a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }],
      a2: [{ id: 'sc2', assessmentId: 'x', tagId: 't', score: 4 }],
    });
    _saveCourseField('observations', A, { a1: [{ id: 'ob1', text: 'Helped a classmate' }] });
    _saveCourseField('statuses', A, { 'a1:x': 'LATE', 'a2:x': 'NS' });

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(Object.keys(getScores(A))).toEqual(['a2']);
    expect(getQuickObs(A).a1).toBeUndefined();
    expect(getAssignmentStatuses(A)).toEqual({ 'a2:x': 'NS' });
    var entry = getWithdrawnStudents(A)[0];
    expect(entry.records.scores).toHaveLength(1);
    expect(entry.records.observations).toHaveLength(1);
    expect(entry.records.statuses).toEqual({ 'a1:x': 'LATE' });
  });

  it('Undo re-enrols the student with every record', () => {
    var undo = null;
    globalThis.showUndoToast = function (message, undoFn) {
      undo = undoFn;
    };
    _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
    _saveCourseField('goals', A, { a1: { s1: 'Read more' } });
    _saveCourseField('reflections', A, { a1: { s1: { confidence: 3, text: '' } } });
    _saveCourseField('notes', A, { a1: 'Met with parent' });
    _saveCourseField('statuses', A, { 'a1:x': 'LATE' });
    _saveCourseField('observations', A, { a1: [{ id: 'ob1', text: 'Helped a classmate' }] });
    _saveCourseField('termRatings', A, { a1: { 1: { dims: {}, narrative: 'Term 1' } } });

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
    expect(ids(A)).toEqual(['a2']);

    undo();

    expect(ids(A)).toEqual(['a1', 'a2']);
    expect(withdrawnIds(A)).toEqual([]);
    expect(getScores(A).a1).toHaveLength(1);
    expect(getGoals(A).a1).toEqual({ s1: 'Read more' });
    expect(getReflections(A).a1).toBeDefined();
    expect(getNotes(A).a1).toBe('Met with parent');
    expect(getAssignmentStatuses(A)['a1:x']).toBe('LATE');
    expect(getQuickObs(A).a1).toHaveLength(1);
    expect(getTermRatings(A).a1).toBeDefined();
  });

  it('lists withdrawn students under the roster with Re-enrol and Delete permanently', () => {
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
    // The roster and the Withdrawn list live on the Students tab.
    DashClassManager.handleAction('cmSetTab', stubEl({ tab: 'students' }));

    var html = page();
    var section = html.slice(html.indexOf('id="cm-withdrawn"'));
    expect(html).toContain('id="cm-withdrawn"');
    expect(section).toContain('Withdrawn <span class="cm-section-count">(1)</span>');
    expect(section).toContain('data-withdrawn-sid="a1"');
    expect(section).toContain('Amara Osei');
    expect(section).toContain('data-action="cmReenrolStudent" data-sid="a1">Re-enrol</button>');
    expect(section).toContain('data-action="cmDeleteWithdrawn" data-sid="a1">Delete permanently</button>');
    // The roster no longer shows them.
    expect(html).not.toContain('data-action="cmRemoveStudent" data-sid="a1"');
    expect(html).toContain('data-action="cmRemoveStudent" data-sid="a2"');
  });

  it('shows no Withdrawn list when nobody is withdrawn', () => {
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: A }));
    expect(page()).not.toContain('id="cm-withdrawn"');
  });

  it('Re-enrol puts the student back on the roster where they were', () => {
    _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    DashClassManager.handleAction('cmReenrolStudent', stubEl({ sid: 'a1' }));

    expect(ids(A)).toEqual(['a1', 'a2']);
    expect(getScores(A).a1).toHaveLength(1);
    expect(page()).not.toContain('id="cm-withdrawn"');
  });

  it('Delete permanently asks first, warns it cannot be undone, and offers no Undo', () => {
    var toasts = 0;
    _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
    globalThis.showUndoToast = function () {
      toasts++;
    };

    DashClassManager.handleAction('cmDeleteWithdrawn', stubEl({ sid: 'a1' }));

    var c = confirms[confirms.length - 1];
    expect(c.title).toBe('Delete permanently');
    expect(c.okStyle).toBe('danger');
    expect(c.message).toMatch(/cannot be undone/);
    expect(toasts).toBe(0);
    expect(withdrawnIds(A)).toEqual([]);
    expect(ids(A)).toEqual(['a2']);
    expect(getScores(A).a1).toBeUndefined();
    expect(page()).not.toContain('id="cm-withdrawn"');
  });

  it('offers no permanent delete for a student still on the roster', () => {
    DashClassManager.handleAction('cmDeleteWithdrawn', stubEl({ sid: 'a1' }));

    expect(confirms).toHaveLength(0);
    expect(ids(A)).toEqual(['a1', 'a2']);
  });
});
