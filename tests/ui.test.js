/**
 * ui: the tests that were tests/ui-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

describe('ui-account-menu', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  describe('account menu', () => {
    it('has Sign Out and no Delete Account', () => {
      var html = renderDock('dashboard');
      expect(html).toContain('Sign Out');
      expect(html).not.toContain('Delete Account');
      expect(html).not.toContain('data-action="deleteAccount"');
    });

    it('shows Reset Demo Data only in Demo Mode', () => {
      var original = window.isDemoMode;
      try {
        window.isDemoMode = function () {
          return false;
        };
        expect(renderDock('dashboard')).not.toContain('data-action="resetDemoData"');
        window.isDemoMode = function () {
          return true;
        };
        expect(renderDock('dashboard')).toContain('data-action="resetDemoData"');
      } finally {
        window.isDemoMode = original;
      }
    });
  });

  describe('Assignments toolbar', () => {
    it('has a Rubrics button and no Advanced menu', () => {
      var src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf8');
      expect(src).toContain('data-action="openRubricBank">Rubrics</button>');
      expect(src).not.toContain('>Advanced</button>');
      expect(src).not.toContain('tb-advanced-panel');
      expect(src).not.toContain('data-action="deleteAccount"');
    });
  });
});

describe('ui-birthdays', () => {
  /**
   * Birthday calculation tests — teacher/ui.js :: getUpcomingBirthdays()
   */

  const CID = 'test';
  const origGetStudents = globalThis.getStudents;

  afterEach(() => {
    globalThis.getStudents = origGetStudents;
  });

  function mockStudents(students) {
    globalThis.getStudents = () => students;
  }

  // 'YYYY-MM-DD' for the given year and the month/day of a Date
  function ymd(year, d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return year + '-' + mm + '-' + dd;
  }

  describe('getUpcomingBirthdays', () => {
    it('returns students sorted by days until birthday', () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);

      mockStudents([
        { id: 's1', firstName: 'Far', dateOfBirth: ymd(2010, nextWeek) },
        { id: 's2', firstName: 'Near', dateOfBirth: ymd(2011, tomorrow) },
      ]);

      const result = getUpcomingBirthdays(CID);
      expect(result[0].student.firstName).toBe('Near');
      expect(result[0].daysUntil).toBeLessThan(result[1].daysUntil);
    });

    it('skips students without dateOfBirth', () => {
      mockStudents([
        { id: 's1', firstName: 'NoDob' },
        { id: 's2', firstName: 'HasDob', dateOfBirth: '2010-06-15' },
      ]);

      const result = getUpcomingBirthdays(CID);
      expect(result.every(r => r.student.firstName !== 'NoDob')).toBe(true);
    });

    it('handles birthday today (daysUntil = 0)', () => {
      mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: ymd(2010, new Date()) }]);

      const result = getUpcomingBirthdays(CID);
      expect(result).toHaveLength(1);
      expect(result[0].daysUntil).toBe(0);
    });

    it('wraps past birthdays to next year', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockStudents([{ id: 's1', firstName: 'Past', dateOfBirth: ymd(2010, yesterday) }]);

      const result = getUpcomingBirthdays(CID);
      expect(result).toHaveLength(1);
      expect(result[0].daysUntil).toBeGreaterThan(300); // next year
    });

    it('returns at most 3 students', () => {
      const students = Array.from({ length: 5 }, (_, i) => ({
        id: 's' + i,
        firstName: 'S' + i,
        dateOfBirth: '2010-' + String(((new Date().getMonth() + i + 1) % 12) + 1).padStart(2, '0') + '-15',
      }));

      mockStudents(students);
      expect(getUpcomingBirthdays(CID).length).toBeLessThanOrEqual(3);
    });

    it('returns empty when no students have birthdays', () => {
      mockStudents([{ id: 's1', firstName: 'NoDob' }]);
      expect(getUpcomingBirthdays(CID)).toEqual([]);
    });
  });

  describe('date-only birth dates in Pacific time', () => {
    // new Date('YYYY-MM-DD') parses as UTC midnight, which is the previous
    // evening in Vancouver. Node honours a runtime TZ change.
    const origTZ = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/Vancouver';
    });
    afterAll(() => {
      if (origTZ === undefined) delete process.env.TZ;
      else process.env.TZ = origTZ;
    });

    it('formatDate shows the stored day, not the day before', () => {
      const opts = { month: 'short', day: 'numeric', year: 'numeric' };
      expect(formatDate('2012-11-04')).toBe(new Date(2012, 10, 4).toLocaleDateString('en-CA', opts));
      expect(formatDate('2012-11-04')).toMatch(/Nov\.? 4, 2012/);
    });

    it('parseLocalDate keeps the calendar day for date-only strings', () => {
      const d = parseLocalDate('2012-11-04');
      expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2012, 10, 4]);
    });

    it('getUpcomingBirthdays counts a plain YYYY-MM-DD birthday today as 0 days', () => {
      const today = new Date();
      mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: ymd(2010, today) }]);
      const result = getUpcomingBirthdays(CID);
      expect(result[0].daysUntil).toBe(0);
      expect(result[0].nextBday.getDate()).toBe(today.getDate());
    });
  });
});

describe('ui-roster-scroll', () => {
  /**
   * The roster keeps its scroll position when the sidebar is drawn again
   * (teacher/ui.js). Clicking a student low in the list on Assignments redraws
   * the whole sidebar, and the new list used to start at the top.
   */

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
});

describe('ui-sync-status', () => {
  function createClassList() {
    var names = new Set();
    return {
      add(name) {
        names.add(name);
      },
      remove(name) {
        names.delete(name);
      },
      toggle(name, force) {
        if (typeof force === 'boolean') {
          if (force) names.add(name);
          else names.delete(name);
          return force;
        }
        if (names.has(name)) {
          names.delete(name);
          return false;
        }
        names.add(name);
        return true;
      },
      contains(name) {
        return names.has(name);
      },
    };
  }

  function createElementStub() {
    var attrs = {};
    return {
      hidden: true,
      textContent: '',
      innerHTML: '',
      title: '',
      className: '',
      classList: createClassList(),
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      getAttribute(name) {
        return attrs[name] || null;
      },
    };
  }

  describe('desktop sync status UI', () => {
    var originalGetElementById;
    var originalBody;
    var originalQueue;

    beforeEach(() => {
      originalGetElementById = document.getElementById;
      originalBody = document.body;
      originalQueue = window.v2Queue;
    });

    afterEach(() => {
      document.getElementById = originalGetElementById;
      document.body = originalBody;
      window.v2Queue = originalQueue;
      vi.restoreAllMocks();
    });

    // Sync shows only as the dot: a count next to the teacher's name confused people.
    it('renders the offline banner and the sync dot, with no count or popover', () => {
      var html = renderDock('dashboard');
      expect(html).toContain('offline-banner');
      expect(html).toContain('sync-indicator-dot');
      expect(html).not.toContain('tb-sync-badge');
      expect(html).not.toContain('tb-sync-popover');
    });

    it('shows queued and failed sync state from the offline queue', () => {
      var elements = {
        'offline-banner': createElementStub(),
        'sync-indicator-dot': createElementStub(),
      };
      document.getElementById = function (id) {
        return elements[id] || null;
      };
      document.body = { classList: createClassList() };
      window.v2Queue = {
        stats() {
          return {
            queued: 2,
            deadLettered: 1,
            lastFlushAt: '2026-04-21T19:58:00.000Z',
            online: false,
            flushing: false,
          };
        },
        deadLetter() {
          return [{ id: 'dead-1', endpoint: 'upsert_score', last_error: 'assessment not found' }];
        },
      };
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-21T20:00:00.000Z'));

      refreshSyncStatusUI();

      expect(elements['offline-banner'].hidden).toBe(false);
      expect(document.body.classList.contains('offline-active')).toBe(true);
      expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
    });

    it('turns the dot red while a write the server rejected remains', () => {
      var elements = {
        'offline-banner': createElementStub(),
        'sync-indicator-dot': createElementStub(),
      };
      document.getElementById = function (id) {
        return elements[id] || null;
      };
      document.body = { classList: createClassList() };
      window.v2Queue = {
        stats() {
          return { queued: 0, deadLettered: 1, lastFlushAt: null, online: true, flushing: false };
        },
        deadLetter() {
          return [{ id: 'dead-1', endpoint: 'update_assessment', last_error: 'assessment not found' }];
        },
      };

      refreshSyncStatusUI();

      expect(elements['offline-banner'].hidden).toBe(true);
      expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
      expect(elements['sync-indicator-dot'].title).toBe("Some changes couldn't be saved");
    });

    it('turns the dot red with the reason while this device cannot save', () => {
      var elements = {
        'offline-banner': createElementStub(),
        'sync-indicator-dot': createElementStub(),
      };
      document.getElementById = function (id) {
        return elements[id] || null;
      };
      document.body = { classList: createClassList() };
      window.v2Queue = {
        stats() {
          return { queued: 0, deadLettered: 0, lastFlushAt: null, online: true, flushing: false };
        },
        deadLetter() {
          return [];
        },
      };
      var originalProblem = globalThis.getSaveProblem;
      globalThis.getSaveProblem = () => "This device's storage is full, so recent changes may not be saved";
      try {
        refreshSyncStatusUI();
      } finally {
        globalThis.getSaveProblem = originalProblem;
      }

      expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
      expect(elements['sync-indicator-dot'].title).toBe(
        "This device's storage is full, so recent changes may not be saved",
      );
    });

    it('returns to the idle state when no sync work remains', () => {
      var elements = {
        'offline-banner': createElementStub(),
        'sync-indicator-dot': createElementStub(),
      };
      document.getElementById = function (id) {
        return elements[id] || null;
      };
      document.body = { classList: createClassList() };
      window.v2Queue = {
        stats() {
          return {
            queued: 0,
            deadLettered: 0,
            lastFlushAt: '2026-04-21T19:58:00.000Z',
            online: true,
            flushing: false,
          };
        },
        deadLetter() {
          return [];
        },
      };
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-21T20:00:00.000Z'));

      refreshSyncStatusUI();

      expect(elements['offline-banner'].hidden).toBe(true);
      expect(document.body.classList.contains('offline-active')).toBe(false);
      expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot idle');
      expect(elements['sync-indicator-dot'].title).toBe('All changes saved');
    });
  });
});
