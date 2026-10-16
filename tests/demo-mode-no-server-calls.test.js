/**
 * Demo Mode stays on this computer. The page still has the anon Supabase
 * client, so writes used to go out and fail ("permission denied", 401):
 * saved categories never reached the cache, "1 unsynced change" stuck, and
 * creating a class with a curriculum reported that its competencies failed
 * to sync. Now no RPC leaves the page in Demo Mode, and those saves apply
 * locally.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Demo Mode sends nothing to Supabase', () => {
  var calls;
  var alerts;
  var originals;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    calls = [];
    alerts = [];
    originals = {
      getSupabase: globalThis.getSupabase,
      isDemoMode: globalThis.isDemoMode,
      alert: globalThis.alert,
      index: CURRICULUM_INDEX,
    };
    // The anon client a Demo Mode page has: every call fails as anon.
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied', status: 401 } });
      },
      from(table) {
        calls.push('from:' + table);
        return { select: () => Promise.resolve({ data: [], error: null }) };
      },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    });
    globalThis.isDemoMode = () => true;
    globalThis.alert = message => alerts.push(message);
    _useSupabase = false;
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.alert = originals.alert;
    CURRICULUM_INDEX = originals.index;
    localStorage.clear();
    DashClassManager.resetState();
  });

  it('makes no RPC from the v2 write and read helpers', async () => {
    const save = await window.v2.saveCategories('course-demo', [{ name: 'Tests', weight: 100 }]);
    const list = await window.v2.listCategories('course-demo');
    const upsert = await window.v2.upsertSubject({ courseId: 'course-demo', name: 'Science' });
    expect(save).toEqual({ data: null, error: null });
    expect(list).toEqual({ data: null, error: null });
    expect(upsert).toEqual({ data: null, error: null });
    expect(calls).toEqual([]);
  });

  it('saves categories locally from the class manager', async () => {
    const cid = 'course-demo-cats';
    saveCourses({ [cid]: { id: cid, name: 'Science 8', gradingSystem: 'letter' } });
    _cache.assessments[cid] = [];
    adoptCategoriesFromServer(cid, [
      { id: 'd1', name: 'Labs', weight: 60, displayOrder: 0 },
      { id: 'd2', name: 'Quizzes', weight: 40, displayOrder: 1 },
    ]);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await tick();

    DashClassManager.handleAction('cmCatAdd', { dataset: {} });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatNameLive', idx: '2' }, value: 'Homework' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '0' }, value: '50' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '1' }, value: '30' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '2' }, value: '20' });
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await tick();

    const cats = getCategories(cid);
    expect(cats.map(c => [c.name, c.weight])).toEqual([
      ['Labs', 50],
      ['Quizzes', 30],
      ['Homework', 20],
    ]);
    expect(cats[2].id).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('creates a class with a curriculum without a sync warning', async () => {
    CURRICULUM_INDEX = {
      SCI9: {
        course_name: 'Science 9',
        subject: 'Science',
        categories: [
          {
            name: 'Questioning and Predicting',
            competencies: [{ tag: 'QAP1', short_label: 'Curiosity', raw: 'Demonstrate a sustained curiosity' }],
          },
        ],
      },
    };
    saveCourses({});
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartCreate', { dataset: {} });
    DashClassManager.handleAction('cwToggleCourse', { dataset: { tag: 'SCI9' } });
    DashClassManager.handleAction('cwGoToStep2', { dataset: {} });
    const originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'cm-new-name' ? { value: 'Science 9 Demo' } : originalGetElementById(id));
    DashClassManager.handleAction('cwGoToStep3', { dataset: {} });
    document.getElementById = originalGetElementById;
    DashClassManager.handleAction('cwFinishCreate', { dataset: {} });
    await tick(50);

    const cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Science 9 Demo');
    expect(cid).toBeTruthy();
    expect(getSections(cid).map(s => s.id)).toEqual(['QAP1']);
    expect(alerts).toEqual([]);
    expect(calls).toEqual([]);
  });
});
