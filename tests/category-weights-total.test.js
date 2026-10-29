/**
 * Category weights must total exactly 100 (docs/grading-compliance-plan.md
 * D1, as in Microsoft Teams). The old rule was "at most 100", so a class
 * could run at 80% and the letter grade renormalized without saying so.
 * Edits stay in the class manager until Save, which sends the whole list in
 * one save_categories call: a row-at-a-time save would pass through 110 or
 * 90 on the way from 50/50 to 60/40.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-weights';

describe('category weights must total 100', () => {
  var originalV2;
  var originalToast;
  var saves;
  var modes;
  var toasts;

  const act = (action, idx) =>
    DashClassManager.handleAction(action, { dataset: idx == null ? {} : { idx: String(idx) } });
  const type = (action, idx, value) =>
    DashClassManager.handleInput({ dataset: { actionInput: action, idx: String(idx) }, value: String(value) });
  const save = async () => {
    act('cmCatSave');
    await new Promise(r => setTimeout(r, 20));
  };

  beforeEach(async () => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 9', gradingSystem: 'letter' } });
    _cache.assessments[CID] = [];
    saves = [];
    modes = [];
    toasts = [];
    originalToast = globalThis.showSyncToast;
    globalThis.showSyncToast = message => toasts.push(message);
    originalV2 = { list: window.v2.listCategories, save: window.v2.saveCategories };
    window.v2.listCategories = () =>
      Promise.resolve({
        data: [
          { id: 'k1', name: 'Tests', weight: 60, display_order: 0 },
          { id: 'k2', name: 'Labs', weight: 40, display_order: 1 },
        ],
      });
    window.v2.saveCategories = (cid, rows) => {
      modes.push(rows.map(r => categoryCalcMode(r)));
      saves.push(rows.map(r => ({ id: r.id, name: r.name, weight: r.weight })));
      return Promise.resolve({ data: rows.map((r, i) => r.id || 'new-' + i), error: null });
    };

    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    _useSupabase = true;
    DashClassManager.openClassManager();
    await new Promise(r => setTimeout(r, 20));
    _useSupabase = false;
  });

  afterEach(() => {
    window.v2.listCategories = originalV2.list;
    window.v2.saveCategories = originalV2.save;
    globalThis.showSyncToast = originalToast;
    DashClassManager.resetState();
  });

  it('saves a re-weighting in one call once the total is 100', async () => {
    type('cmCatWeightLive', 0, 70);
    // 70 + 40 = 110: not saved.
    await save();
    expect(saves).toEqual([]);
    expect(toasts).toEqual(['Category weights must total 100% to save.']);

    type('cmCatWeightLive', 1, 30);
    await save();
    expect(saves).toEqual([
      [
        { id: 'k1', name: 'Tests', weight: 70 },
        { id: 'k2', name: 'Labs', weight: 30 },
      ],
    ]);
    expect(getCategories(CID).map(c => c.weight)).toEqual([70, 30]);
  });

  it('refuses a total under 100', async () => {
    type('cmCatWeightLive', 0, 50);
    await save();
    expect(saves).toEqual([]);
    // The letter grade still uses the saved weights.
    expect(getCategories(CID).map(c => c.weight)).toEqual([60, 40]);
  });

  it('adds a category with its name and gives it the server’s id', async () => {
    act('cmCatAdd');
    type('cmCatNameLive', 2, 'Homework');
    type('cmCatWeightLive', 0, 50);
    type('cmCatWeightLive', 1, 30);
    type('cmCatWeightLive', 2, 20);
    await save();

    expect(saves[0].map(r => r.name)).toEqual(['Tests', 'Labs', 'Homework']);
    expect(saves[0][2].id).toBe(null);
    expect(getCategories(CID).map(c => c.id)).toEqual(['k1', 'k2', 'new-2']);
  });

  it('needs every category to have a name', async () => {
    act('cmCatAdd');
    await save();
    expect(saves).toEqual([]);
  });

  it('allows a class with no categories', async () => {
    act('cmCatDelete', 0);
    act('cmCatDelete', 0);
    await save();
    expect(saves).toEqual([[]]);
    expect(getCategories(CID)).toEqual([]);
  });

  it("saves a category's Calculation and keeps it in the class", async () => {
    DashClassManager.handleChange({ dataset: { actionChange: 'cmCatMode', idx: '1' }, value: 'percent' });
    await save();
    expect(modes).toEqual([['points', 'percent']]);
    expect(getCategories(CID).map(c => categoryCalcMode(c))).toEqual(['points', 'percent']);
  });

  it('asks first when a Calculation change moves a term that has ended', async () => {
    _cache.courseConfigs[CID] = Object.assign({}, _cache.courseConfigs[CID], {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2020-09-01', ends_on: '2020-11-30' }],
    });
    var confirms = [];
    var originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = (title, message, ok, style, onOk) => confirms.push({ title, message, onOk });
    try {
      DashClassManager.handleChange({ dataset: { actionChange: 'cmCatMode', idx: '0' }, value: 'percent' });
      await save();
      expect(saves).toEqual([]);
      expect(confirms.map(c => c.title)).toEqual(['Change the Course %?']);
      expect(confirms[0].message).toContain('Term 1');
      confirms[0].onOk();
      await new Promise(r => setTimeout(r, 20));
      expect(modes).toEqual([['percent', 'points']]);
    } finally {
      globalThis.showConfirm = originalConfirm;
    }
  });

  it('sends nothing when nothing changed', async () => {
    await save();
    expect(saves).toEqual([]);
  });
});

describe('category weights in Demo Mode', () => {
  // Demo Mode has no Supabase client, so saveCategories sends nothing.
  var originalGetSupabase;
  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    globalThis.getSupabase = () => null;
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
  });

  it('starts from the class’s cached categories', async () => {
    localStorage.clear();
    const cid = 'course-demo-weights';
    saveCourses({ [cid]: { id: cid, name: 'Science 8', gradingSystem: 'letter' } });
    _cache.assessments[cid] = [];
    adoptCategoriesFromServer(cid, [
      { id: 'd1', name: 'Labs', weight: 60, displayOrder: 0 },
      { id: 'd2', name: 'Quizzes', weight: 40, displayOrder: 1 },
    ]);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await new Promise(r => setTimeout(r, 20));

    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '0' }, value: '70' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '1' }, value: '30' });
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await new Promise(r => setTimeout(r, 20));

    expect(getCategories(cid).map(c => [c.id, c.name, c.weight])).toEqual([
      ['d1', 'Labs', 70],
      ['d2', 'Quizzes', 30],
    ]);
    DashClassManager.resetState();
  });
});
