/**
 * The reporting terms editor in Class Management (docs/DECISIONS.md,
 * "Reporting periods"). Presets fill the rows, edits stay local until Save,
 * Save is refused while rows overlap or are incomplete, and Demo Mode saves
 * without a server call.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-terms-cm';

describe('reporting terms editor', () => {
  var originalToast;
  var toasts;
  var rpcCalls;
  var originals;

  const act = (action, dataset) => DashClassManager.handleAction(action, { dataset: dataset || {} });
  const type = (idx, field, value) =>
    DashClassManager.handleInput({
      dataset: { actionInput: 'cmTermLive', idx: String(idx), field: field },
      value: String(value),
    });
  const draft = () => DashClassManager.reportingTermsDraft(CID);
  const save = async () => {
    act('cmTermSave');
    await new Promise(r => setTimeout(r, 20));
  };

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    rpcCalls = [];
    toasts = [];
    originalToast = globalThis.showSyncToast;
    globalThis.showSyncToast = message => toasts.push(message);
    originals = { getSupabase: globalThis.getSupabase, isDemoMode: globalThis.isDemoMode };
    globalThis.isDemoMode = () => true;
    globalThis.getSupabase = () => ({
      rpc(name) {
        rpcCalls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied' } });
      },
    });
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mean' } });
    _cache.assessments[CID] = [];
    _cache.courseConfigs[CID] = {};
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await new Promise(r => setTimeout(r, 20));
  });

  afterEach(() => {
    globalThis.showSyncToast = originalToast;
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    setActiveTerm(CID, null);
    DashClassManager.resetState();
  });

  it('starts empty and clean', () => {
    expect(getReportingTerms(CID)).toEqual([]);
    expect(draft()).toMatchObject({ rows: [], dirty: false, error: null });
  });

  it('the Quarters preset fills four dated rows that save without a server call', async () => {
    act('cmTermPreset', { value: 'quarters' });
    expect(draft().rows).toHaveLength(4);
    expect(draft().dirty).toBe(true);
    expect(draft().error).toBeNull();
    await save();
    var terms = getReportingTerms(CID);
    expect(terms).toHaveLength(4);
    expect(terms.map(t => t.ordinal)).toEqual([1, 2, 3, 4]);
    expect(terms[0].label).toBe('Term 1');
    expect(terms[0].starts_on).toMatch(/^\d{4}-09-01$/);
    expect(terms[3].ends_on).toMatch(/^\d{4}-06-30$/);
    // Consecutive, no gaps or overlap.
    for (var i = 1; i < terms.length; i++) expect(terms[i].starts_on > terms[i - 1].ends_on).toBe(true);
    expect(rpcCalls).toEqual([]);
    expect(draft().dirty).toBe(false);
  });

  it('refuses to save overlapping or incomplete rows', async () => {
    act('cmTermPreset', { value: 'semesters' });
    type(1, 'starts_on', draft().rows[0].ends_on);
    expect(draft().error).toMatch(/overlap/);
    await save();
    expect(getReportingTerms(CID)).toEqual([]);

    act('cmTermPreset', { value: 'semesters' });
    type(0, 'label', '');
    expect(draft().error).toMatch(/needs a name/);
    await save();
    expect(getReportingTerms(CID)).toEqual([]);

    act('cmTermPreset', { value: 'semesters' });
    type(0, 'ends_on', '');
    expect(draft().error).toMatch(/end date/);
    await save();
    expect(getReportingTerms(CID)).toEqual([]);
  });

  it('adds a term starting the day after the last one, up to six', async () => {
    act('cmTermPreset', { value: 'trimesters' });
    act('cmTermAdd');
    var rows = draft().rows;
    expect(rows).toHaveLength(4);
    expect(rows[3].label).toBe('Term 4');
    expect(rows[3].starts_on > rows[2].ends_on).toBe(true);
    act('cmTermAdd');
    act('cmTermAdd');
    act('cmTermAdd');
    expect(draft().rows).toHaveLength(6);
  });

  it('a removed term falls back to all time on every page', async () => {
    act('cmTermPreset', { value: 'semesters' });
    await save();
    setSelectedTermOrdinal(CID, 2);
    expect(getActiveTerm(CID).ordinal).toBe(2);
    act('cmTermDelete', { idx: '1' });
    await save();
    expect(getReportingTerms(CID)).toHaveLength(1);
    expect(getSelectedTermOrdinal(CID)).toBeNull();
    expect(activateSavedTerm(CID)).toBeNull();
  });
});
