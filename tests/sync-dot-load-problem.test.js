/**
 * A class that couldn't load shows only on the sync dot (CLAUDE.md rule 5).
 * The sweep found a red "Couldn't load the latest data…" toast covering Edit
 * Student's Save and Cancel and the Undo toast, and staying across student
 * and class changes. The load now tries again on its own, and the dot goes
 * back to saved once it works.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';

function payload() {
  return {
    course: { id: CID },
    students: [{ enrollment_id: ENROLLMENT_ID, student_id: STUDENT_ID, first_name: 'Ada', last_name: 'Lovelace' }],
    assessments: [],
    categories: [],
    modules: [],
    cells: {},
  };
}

function useServer(fail) {
  globalThis.getSupabase = function () {
    return {
      rpc(name) {
        if (name === 'get_gradebook') {
          return Promise.resolve(
            fail()
              ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
              : { data: payload(), error: null },
          );
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  };
}

function dotStub() {
  var attrs = {};
  return {
    className: '',
    title: '',
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] || null;
    },
  };
}

describe('a class that could not load', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalGetElementById;
  var originalShowSyncToast;
  var originalQueue;
  var originalCourses;
  var toasts;
  var dot;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    originalGetElementById = document.getElementById;
    originalShowSyncToast = globalThis.showSyncToast;
    originalQueue = globalThis.v2Queue;
    originalCourses = COURSES;
    delete globalThis.v2Queue;
    _useSupabase = true;
    _loadError = {};
    if (typeof _loadRetryCount !== 'undefined') _loadRetryCount = 0;
    localStorage.clear();
    Object.keys(_DATA_KEYS).forEach(field => delete _cache[field][CID]);
    COURSES = { [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } };
    setActiveCourse(CID);
    dot = dotStub();
    document.getElementById = id => (id === 'sync-indicator-dot' ? dot : null);
    toasts = [];
    globalThis.showSyncToast = (msg, type) => toasts.push({ msg, type });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof _loadRetryTimer !== 'undefined' && _loadRetryTimer) clearTimeout(_loadRetryTimer);
    if (typeof _loadRetryTimer !== 'undefined') _loadRetryTimer = null;
    globalThis.getSupabase = originalGetSupabase;
    globalThis.showSyncToast = originalShowSyncToast;
    globalThis.v2Queue = originalQueue;
    COURSES = originalCourses;
    _useSupabase = originalUseSupabase;
    document.getElementById = originalGetElementById;
    _loadError = {};
  });

  it('turns the dot red with no toast, tries again on its own, and clears once it loads', async () => {
    var failing = true;
    useServer(() => failing);

    await initData(CID);

    expect(toasts).toEqual([]);
    expect(dot.className).toBe('tb-sync-dot error');
    expect(dot.title).toMatch(/^Couldn't load the latest data for this class\./);
    expect(dot.getAttribute('aria-label')).toBe(dot.title);

    failing = false;
    await vi.advanceTimersByTimeAsync(15000);
    await vi.waitFor(() => expect(courseLoadFailed(CID)).toBe(false));

    expect(toasts).toEqual([]);
    expect(dot.className).toBe('tb-sync-dot idle');
    expect(dot.title).toBe('All changes saved');
  });
});
