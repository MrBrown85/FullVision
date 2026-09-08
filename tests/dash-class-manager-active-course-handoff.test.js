/**
 * The class manager must hand a course switch back to the parent page.
 *
 * page-dashboard keeps its own activeCourse for rendering and re-injects it
 * into the manager on every configure(). The manager can change the active
 * course while it is open — finishing the create wizard, or archiving the class
 * that was active — but it only mutated its own copy, so the parent stayed on
 * the previous class and pushed that stale id back on the next configure().
 *
 * The switch is deferred to close rather than announced immediately: the parent
 * responds by resetting manager state, which would tear down the panel the
 * teacher is still working in.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const A = 'course-a';
const B = 'course-b';

function stubEl(dataset) {
  return { dataset: dataset };
}

describe('class manager — active course handoff', () => {
  var switched;
  var rendered;
  var originalGetElementById;
  var originalAlert;

  function configureWith(activeCourse) {
    DashClassManager.configure({
      activeCourse: activeCourse,
      onRender: function () {
        rendered += 1;
      },
      onCourseChange: function (cid) {
        switched.push(cid);
      },
    });
  }

  beforeEach(() => {
    localStorage.clear();
    ['students', 'courseConfigs', 'learningMaps'].forEach(function (field) {
      if (_cache[field]) _cache[field] = {};
    });
    _cache.config = {};
    saveCourses({
      [A]: { id: A, name: 'Course A' },
      [B]: { id: B, name: 'Course B' },
    });
    switched = [];
    rendered = 0;
    originalGetElementById = document.getElementById;
    originalAlert = globalThis.alert;
    globalThis.alert = function () {};

    configureWith(A);
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    globalThis.alert = originalAlert;
    DashClassManager.resetState();
  });

  it('closing with nothing changed renders in place, without a course switch', () => {
    DashClassManager.handleAction('closeClassManager', stubEl({}));

    expect(switched).toEqual([]);
    expect(rendered).toBe(1);
  });

  it('hands the newly created class to the parent on close', async () => {
    // Drive the real wizard: name the class, then finish it.
    DashClassManager.handleAction('cmStartCreate', stubEl({}));
    document.getElementById = function (id) {
      if (id === 'cm-new-name') return { value: 'Humanities 8' };
      return originalGetElementById(id);
    };
    DashClassManager.handleAction('cwGoToStep3', stubEl({}));
    document.getElementById = originalGetElementById;

    await DashClassManager.handleAction('cwFinishCreate', stubEl({}));

    var created = Object.keys(COURSES).find(function (cid) {
      return COURSES[cid].name === 'Humanities 8';
    });
    expect(created).toBeTruthy();

    DashClassManager.handleAction('closeClassManager', stubEl({}));

    expect(switched).toEqual([created]);
  });

  it('hands the next class to the parent when the active one is archived', () => {
    DashClassManager.handleAction('cmToggleArchive', stubEl({ cid: A }));

    DashClassManager.handleAction('closeClassManager', stubEl({}));

    expect(switched).toEqual([B]);
  });

  it('drops a pending handoff once the parent reports the same course itself', () => {
    DashClassManager.handleAction('cmToggleArchive', stubEl({ cid: A }));
    // The parent switched on its own and is telling us where it landed.
    configureWith(B);

    DashClassManager.handleAction('closeClassManager', stubEl({}));

    expect(switched).toEqual([]);
    expect(rendered).toBe(1);
  });
});
