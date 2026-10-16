/**
 * Class manager — delete an archived class.
 *
 * Delete is offered only on archived classes, so a class leaves every class
 * menu before it can go. delete_course soft-deletes it and the daily retention
 * job erases it 30 days later.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const A = 'course-a';
const B = 'course-b';

function stubEl(dataset) {
  return { dataset: dataset };
}

describe('class manager — delete archived class', () => {
  var originalConfirm;
  var confirmed;
  var switched;

  beforeEach(() => {
    localStorage.clear();
    _cache.config = {};
    saveCourses({
      [A]: { id: A, name: 'Course A' },
      [B]: { id: B, name: 'Course B', archived: true },
    });
    switched = [];
    confirmed = null;
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirmed = onConfirm;
    };

    DashClassManager.configure({
      activeCourse: A,
      onRender: function () {},
      onCourseChange: function (cid) {
        switched.push(cid);
      },
    });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    DashClassManager.resetState();
  });

  it('deletes an archived class once the teacher confirms', async () => {
    DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: B }));
    expect(COURSES[B]).toBeTruthy();

    await confirmed();

    expect(COURSES[B]).toBeUndefined();
    expect(COURSES[A]).toBeTruthy();
  });

  it('refuses to delete a class that is not archived', () => {
    DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: A }));

    expect(confirmed).toBeNull();
    expect(COURSES[A]).toBeTruthy();
  });

  it('leaves the active class alone when another class is deleted', async () => {
    DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: B }));
    await confirmed();

    DashClassManager.handleAction('closeClassManager', stubEl({}));

    expect(switched).toEqual([]);
  });
});
