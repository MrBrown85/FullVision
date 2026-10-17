/**
 * The roster keeps its scroll position when the sidebar is drawn again
 * (teacher/ui.js). Clicking a student low in the list on Assignments redraws
 * the whole sidebar, and the new list used to start at the top.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('roster scroll position', () => {
  var originalGetElementById;
  var list;
  var select;

  function roster(course) {
    select = { value: course };
    list = {
      id: 'gb-roster-list',
      scrollTop: 0,
      // Like a real element, the list matches its own selector.
      closest: function (sel) {
        return sel === '#gb-roster-list' ? list : null;
      },
    };
  }
  function rowIn(theList) {
    return {
      closest: function (sel) {
        return sel === '#gb-roster-list' ? theList : null;
      },
    };
  }

  beforeEach(() => {
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      if (id === 'gb-roster-list') return list;
      if (id === 'gb-course-select') return select;
      return null;
    };
    _rosterScroll = { course: null, top: 0 };
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
  });

  it('puts the list back where it was when the same class is redrawn', () => {
    roster('class-a');
    list.scrollTop = 686;
    // The teacher clicks a student low in the list.
    _rememberRosterScroll({ target: rowIn(list) });
    // The page redraws the sidebar: a new list, at the top.
    roster('class-a');
    _restoreRosterScroll();
    expect(list.scrollTop).toBe(686);
  });

  it('remembers a scroll of the list itself', () => {
    roster('class-a');
    list.scrollTop = 240;
    _rememberRosterScroll({ target: list });
    roster('class-a');
    _restoreRosterScroll();
    expect(list.scrollTop).toBe(240);
  });

  it('starts at the top for a different class', () => {
    roster('class-a');
    list.scrollTop = 686;
    _rememberRosterScroll({ target: rowIn(list) });
    roster('class-b');
    _restoreRosterScroll();
    expect(list.scrollTop).toBe(0);
  });

  it('ignores clicks and scrolls outside the roster', () => {
    roster('class-a');
    list.scrollTop = 686;
    _rememberRosterScroll({ target: rowIn(null) });
    roster('class-a');
    _restoreRosterScroll();
    expect(list.scrollTop).toBe(0);
  });
});
