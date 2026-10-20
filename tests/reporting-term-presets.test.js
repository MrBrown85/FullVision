/**
 * Surrey secondary schools' reporting periods as presets
 * (shared/reporting-term-presets.js; docs/DECISIONS.md "Reporting periods").
 * Grandview Heights is the default: a new class starts with its terms, and
 * the Class Management editor fills rows from any listed school.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const IN_YEAR = '2026-10-17';

describe('report names for the Term Questionnaire picker', () => {
  it("names each report in the school's words when a class uses that school's terms", () => {
    const rows = reportingTermPreset('grandviewheights', IN_YEAR);
    expect(reportingTermReportNames(rows)).toEqual([
      'Nov Report Card',
      'Feb Report Card',
      'Apr Report Card',
      'Jun Report Card',
    ]);
  });

  it('leaves a term with no published report blank', () => {
    const rows = reportingTermPreset('earlmarriott', IN_YEAR);
    expect(reportingTermReportNames(rows)).toEqual([
      'Nov Learning Update',
      '',
      'Apr Learning Update',
      'Jun Learning Update',
    ]);
  });

  it('every report name starts with its month and the month is when the term ends or just after', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    REPORTING_TERM_PRESETS.schools.forEach(school => {
      school.terms.forEach(t => {
        if (!t.report) return;
        const m = months.indexOf(t.report.slice(0, 3));
        const end = Number(t.ends_on.slice(5, 7)) - 1;
        expect([end, (end + 1) % 12], school.id + ' ' + t.report).toContain(m);
      });
    });
  });

  it('returns null for terms that match no school', () => {
    const rows = reportingTermPreset('grandviewheights', IN_YEAR);
    rows[0] = Object.assign({}, rows[0], { ends_on: '2026-10-30' });
    expect(reportingTermReportNames(rows)).toBeNull();
    expect(reportingTermReportNames([])).toBeNull();
  });
});

describe('the preset data', () => {
  it('covers 2026-2027 with Grandview Heights first and as the default', () => {
    expect(REPORTING_TERM_PRESETS.schoolYear).toBe('2026-2027');
    expect(REPORTING_TERM_PRESETS.defaultSchool).toBe('grandviewheights');
    const schools = reportingTermSchools();
    expect(schools[0].id).toBe('grandviewheights');
    expect(schools.length).toBeGreaterThanOrEqual(5);
    const names = schools.slice(1).map(s => s.name);
    expect(names).toEqual(names.slice().sort());
  });

  it('every school has four valid, non-overlapping terms inside the school year', () => {
    REPORTING_TERM_PRESETS.schools.forEach(school => {
      const rows = reportingTermPreset(school.id, IN_YEAR);
      expect(rows, school.id).toHaveLength(4);
      expect(reportingTermsError(rows), school.id).toBeNull();
      expect(rows.map(r => r.ordinal)).toEqual([1, 2, 3, 4]);
      expect(rows[0].starts_on).toBe(REPORTING_TERM_PRESETS.firstDay);
      expect(rows[3].ends_on >= REPORTING_TERM_PRESETS.lastDay).toBe(true);
      for (let i = 1; i < rows.length; i++) {
        // Consecutive: each term starts the day after the previous one ends.
        const prev = new Date(rows[i - 1].ends_on + 'T12:00:00Z');
        prev.setUTCDate(prev.getUTCDate() + 1);
        expect(rows[i].starts_on, school.id + ' term ' + (i + 1)).toBe(prev.toISOString().slice(0, 10));
      }
    });
  });

  it('Grandview Heights ends Term 1 on Nov 27 and starts Semester 2 on Jan 27', () => {
    const rows = reportingTermPreset('grandviewheights', IN_YEAR);
    expect(rows.map(r => [r.starts_on, r.ends_on])).toEqual([
      ['2026-09-08', '2026-11-27'],
      ['2026-11-28', '2027-01-26'],
      ['2027-01-27', '2027-04-23'],
      ['2027-04-24', '2027-06-24'],
    ]);
  });

  it('knows the school year a date falls in and refuses other years', () => {
    expect(reportingSchoolYear('2026-08-01')).toBe('2026-2027');
    expect(reportingSchoolYear('2027-06-30')).toBe('2026-2027');
    expect(reportingSchoolYear('2027-08-01')).toBe('2027-2028');
    expect(reportingSchoolYear('')).toBeNull();
    expect(reportingTermPreset('grandviewheights', '2027-09-01')).toBeNull();
    expect(reportingTermPreset('no-such-school', IN_YEAR)).toBeNull();
    expect(reportingTermPreset(null, IN_YEAR)[0].label).toBe('Term 1');
  });
});

describe('Class Management uses the presets', () => {
  const CID = 'course-school-preset';
  var originals;
  var rpcCalls;

  const act = (action, dataset) => DashClassManager.handleAction(action, { dataset: dataset || {} });
  const draft = () => DashClassManager.reportingTermsDraft(CID);

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    rpcCalls = [];
    originals = {
      getSupabase: globalThis.getSupabase,
      isDemoMode: globalThis.isDemoMode,
      toast: globalThis.showSyncToast,
    };
    globalThis.isDemoMode = () => true;
    globalThis.showSyncToast = () => {};
    globalThis.getSupabase = () => ({
      rpc(name) {
        rpcCalls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied' } });
      },
    });
    saveCourses({ [CID]: { id: CID, name: 'Humanities 8', gradingSystem: 'proficiency', calcMethod: 'average' } });
    _cache.assessments[CID] = [];
    _cache.courseConfigs[CID] = {};
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await tick();
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.showSyncToast = originals.toast;
    setActiveTerm(CID, null);
    DashClassManager.resetState();
  });

  it('fills the rows from the chosen school and saves them', async () => {
    act('cmTermSchoolPreset');
    expect(draft().rows.map(r => r.ends_on)).toEqual(['2026-11-27', '2027-01-26', '2027-04-23', '2027-06-24']);
    act('cmTermSave');
    await tick();
    expect(getReportingTerms(CID).map(t => t.label)).toEqual(['Term 1', 'Term 2', 'Term 3', 'Term 4']);
    expect(rpcCalls).toEqual([]);

    DashClassManager.handleChange({ dataset: { actionChange: 'cmTermSchool' }, value: 'fraserheights' });
    act('cmTermSchoolPreset');
    expect(draft().rows[0].ends_on).toBe('2026-11-23');
    expect(draft().dirty).toBe(true);
  });
});

describe('a new class starts with the default school terms', () => {
  var originals;
  var calls;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    calls = [];
    originals = { getSupabase: globalThis.getSupabase, isDemoMode: globalThis.isDemoMode, alert: globalThis.alert };
    globalThis.isDemoMode = () => true;
    globalThis.alert = () => {};
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied', status: 401 } });
      },
      from() {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    });
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.alert = originals.alert;
    DashClassManager.resetState();
  });

  it('gives a wizard-created class Grandview Heights terms for the current year', async () => {
    saveCourses({});
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartCreate', { dataset: {} });
    DashClassManager.handleAction('cwSkipToCustom', { dataset: {} });
    const originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'cm-new-name' ? { value: 'Custom 8' } : originalGetElementById(id));
    DashClassManager.handleAction('cwGoToStep3', { dataset: {} });
    document.getElementById = originalGetElementById;
    DashClassManager.handleAction('cwFinishCreate', { dataset: {} });
    await tick(50);

    const cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Custom 8');
    expect(cid).toBeTruthy();
    const expected = reportingTermPreset('grandviewheights', getTodayStr());
    if (expected) {
      expect(getReportingTerms(cid)).toEqual(expected);
    } else {
      // Outside 2026-27 the presets don't apply and the class starts with none.
      expect(getReportingTerms(cid)).toEqual([]);
    }
    expect(calls).toEqual([]);
  });
});
