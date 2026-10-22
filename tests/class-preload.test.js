/**
 * Every class is loaded at sign-in, not only the one the teacher opens with:
 * preloadClasses loads the rest one at a time, and loadClass shares one load
 * per class. Class Management shows a class's student count once it is in,
 * and a class picked before its data arrives shows "Loading this class…"
 * instead of an empty roster that could be edited.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const A = 'e0000000-0000-4000-8000-0000000000a1';
const B = 'e0000000-0000-4000-8000-0000000000b2';
const C = 'e0000000-0000-4000-8000-0000000000c3';

var originalInit;
var originalUse;
var calls;
var release;

beforeEach(() => {
  localStorage.clear();
  ['students', 'learningMaps', 'courseConfigs'].forEach(f => {
    [A, B, C].forEach(cid => delete _cache[f][cid]);
  });
  saveCourses({
    [A]: { id: A, name: 'Humanities 8', gradingSystem: 'proficiency' },
    [B]: { id: B, name: 'Social Studies 10', gradingSystem: 'letter' },
    [C]: { id: C, name: 'Philosophy 12', gradingSystem: 'letter', archived: true },
  });
  _classLoads = {};
  _classLoads[A] = true; // the class the page opened with
  calls = [];
  release = {};
  originalInit = globalThis.initData;
  originalUse = _useSupabase;
  _useSupabase = true;
  globalThis.initData = function (cid) {
    calls.push(cid);
    return new Promise(resolve => {
      release[cid] = function () {
        _cache.students[cid] = [{ id: 's-' + cid, firstName: 'Ana', lastName: 'Lee' }];
        resolve();
      };
    });
  };
});

afterEach(() => {
  globalThis.initData = originalInit;
  _useSupabase = originalUse;
});

const tick = () => new Promise(r => setTimeout(r, 0));

describe('loading every class', () => {
  it('preloads the classes not yet loaded, archived ones aside, one at a time', async () => {
    expect(isClassLoaded(A)).toBe(true);
    expect(isClassLoaded(B)).toBe(false);
    const run = preloadClasses();
    await tick();
    expect(calls).toEqual([B]);
    // Picking B while it loads waits for the same load.
    const picked = loadClass(B);
    release[B]();
    await picked;
    await run;
    expect(calls).toEqual([B]);
    expect(isClassLoaded(B)).toBe(true);
    expect(isClassLoaded(C)).toBe(false);
  });

  it('counts every class as loaded in Demo Mode and local-only use', () => {
    _useSupabase = false;
    expect(isClassLoaded(B)).toBe(true);
  });
});

describe('Class Management while classes load', () => {
  var main;
  var sidebar;
  var originalGetElementById;
  var originalQuery;
  beforeEach(() => {
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: A, onRender() {}, onCourseChange() {} });
  });
  afterEach(() => {
    document.getElementById = originalGetElementById;
  });

  it('shows Loading for a class not yet in, then its count; a picked class waits for its data', async () => {
    DashClassManager.openClassManager();
    expect(main.innerHTML).toContain('Letter · Loading…');
    DashClassManager.handleAction('cmSelectClass', { dataset: { cid: B } });
    expect(main.innerHTML).toContain('Loading this class…');
    expect(main.innerHTML).not.toContain('data-tab="students"');
    await tick();
    expect(calls).toEqual([B]);
    release[B]();
    await tick();
    await tick();
    expect(main.innerHTML).not.toContain('Loading this class');
    expect(main.innerHTML).toContain('1 Student');
    expect(main.innerHTML).toContain('data-tab="students"');
  });
});

describe('a background check leaves the page alone', () => {
  it('locks the page only for the class on screen', () => {
    const real = globalThis.initData;
    globalThis.initData = originalInit;
    const originalHandle = globalThis._handleExternalCourseUpdate;
    globalThis._handleExternalCourseUpdate = () => Promise.resolve();
    saveConfig(Object.assign({}, getConfig(), { activeCourse: A }));
    try {
      _pageLocks.checking = 0;
      _startClassCheck(B);
      expect(_pageLocks.checking).toBe(0);
      _startClassCheck(A);
      expect(_pageLocks.checking).toBe(1);
    } finally {
      globalThis._handleExternalCourseUpdate = originalHandle;
      globalThis.initData = real;
    }
  });
});
