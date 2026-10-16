/**
 * Class manager roster — the X button must delete the student it is next to.
 *
 * The roster is rendered for cmSelectedCourse, but deleteStudentUI looked the
 * student up in _activeCourse. Those diverge whenever the manager's selection
 * moves on its own (cmSelectClass), or when page-dashboard re-injects its own
 * activeCourse through CM.configure. The lookup then searched the wrong course,
 * found nothing, and returned — so the X button silently did nothing.
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

describe('class manager — remove student', () => {
  var originalConfirm;
  var originalToast;

  beforeEach(() => {
    localStorage.clear();
    ['students', 'scores', 'goals', 'reflections', 'notes', 'flags', 'statuses'].forEach(function (field) {
      if (_cache[field]) _cache[field] = {};
    });
    _cache.config = {};
    saveCourses({
      [A]: { id: A, name: 'Course A' },
      [B]: { id: B, name: 'Course B' },
    });
    saveStudents(A, [student('a1', 'Amara', 'Osei'), student('a2', 'Bo', 'Tran')]);
    saveStudents(B, [student('b1', 'Cass', 'Lund'), student('b2', 'Dev', 'Rao')]);

    originalConfirm = globalThis.showConfirm;
    originalToast = globalThis.showUndoToast;
    // Auto-accept the confirm dialog and swallow the undo toast.
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
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
  });

  it('deletes the student when the manager shows the dashboard active course', () => {
    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(ids(A)).toEqual(['a2']);
  });

  it('deletes from the selected class when it is not the active course', () => {
    // The manager's selection moves; _activeCourse stays on A. This is the
    // divergence that made the button a no-op.
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

    expect(ids(B)).toEqual(['b2']);
  });

  it('does not touch the active course when deleting from another class', () => {
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

    expect(ids(A)).toEqual(['a1', 'a2']);
  });

  it('ignores a student id that is not in the selected class', () => {
    DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

    DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

    expect(ids(A)).toEqual(['a1', 'a2']);
    expect(ids(B)).toEqual(['b1', 'b2']);
  });
  it('Undo puts back the student and every record the delete removed', () => {
    var undo = null;
    var commit = null;
    globalThis.showUndoToast = function (message, undoFn, commitFn) {
      undo = undoFn;
      commit = commitFn;
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
    expect(typeof commit).toBe('function');

    undo();

    expect(ids(A).sort()).toEqual(['a1', 'a2']);
    expect(getScores(A).a1).toHaveLength(1);
    expect(getGoals(A).a1).toEqual({ s1: 'Read more' });
    expect(getReflections(A).a1).toBeDefined();
    expect(getNotes(A).a1).toBe('Met with parent');
    expect(getAssignmentStatuses(A)['a1:x']).toBe('LATE');
    expect(getQuickObs(A).a1).toHaveLength(1);
    expect(getTermRatings(A).a1).toBeDefined();
  });
});
