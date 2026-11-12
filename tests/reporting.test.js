/**
 * reporting: the tests that were tests/reporting-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('reporting-term-presets', () => {
  /**
   * Surrey secondary schools' reporting periods as presets
   * (shared/reporting-term-presets.js; docs/DECISIONS.md "Reporting periods").
   * Grandview Heights is the default: a new class starts with its terms, and
   * the Class Settings editor fills rows from any listed school.
   */

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

  describe('Class Settings uses the presets', () => {
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
});

describe('reporting-terms-calc', () => {
  /**
   * Reporting periods (docs/DECISIONS.md, "Reporting periods" 2; Colin,
   * 2026-11-03). Teachers grade cumulatively: a report's grade is the year to
   * date as of its term's end date. While a term is active (the Reports page),
   * every grade counts every assessment dated on or before that term's end, and
   * undated work; work dated after it doesn't count. With no term active (the
   * year so far) nothing changes.
   */

  const CID = 'course-terms';
  const SID = 'stu-1';
  const TAG = 'tag-1';
  const SEC = 'sec-1';

  const TERMS = [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-12-01', ends_on: '2027-03-15' },
  ];

  function points(id, max, date, categoryId) {
    return { id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [TAG], categoryId, type: 'summative', date };
  }
  function level(id, date) {
    return { id, title: id, tagIds: [TAG], type: 'summative', date };
  }
  function score(assessmentId, value, date) {
    return { assessmentId, tagId: TAG, score: value, date };
  }

  function seed({ categories, assessments, scores, config }) {
    saveCourses({
      [CID]: { id: CID, name: 'Science 8', gradingSystem: 'both', calcMethod: 'average', gradeLevel: '8' },
    });
    _cache.categories[CID] = categories || [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = Object.assign({ reportingTerms: TERMS, calcMethod: 'average' }, config || {});
    _cache.learningMaps[CID] = {
      sections: [
        { id: SEC, name: 'Questioning', subject: 'Science', tags: [{ id: TAG, code: 'Q', name: 'Questioning' }] },
      ],
    };
    clearProfCache();
  }

  describe("a report reads the year to date as of its term's end", () => {
    beforeEach(() => {
      localStorage.clear();
      setActiveTerm(CID, null);
    });
    afterEach(() => setActiveTerm(CID, null));

    // Colin's example from the term-scoping audit: Mean, one competency, a 2
    // in October and a 4 in December.
    it('Mean: a 2 in October and a 4 in December are 2.0 on Report 1, 3.0 on Report 2 and 3.0 in the gradebook', () => {
      seed({
        assessments: [level('oct', '2026-10-15'), level('dec', '2026-12-10')],
        scores: [score('oct', 2, '2026-10-15'), score('dec', 4, '2026-12-10')],
      });
      expect(getSectionProficiency(CID, SID, SEC)).toBe(3); // the gradebook: the year so far
      expect(getOverallProficiency(CID, SID)).toBe(3);
      setActiveTerm(CID, 1);
      expect(getSectionProficiency(CID, SID, SEC)).toBe(2); // Sep 1 – Nov 30
      expect(getCourseLetterData(CID, SID).R).toBe(50);
      setActiveTerm(CID, 2);
      expect(getSectionProficiency(CID, SID, SEC)).toBe(3); // Sep 1 – Mar 15, not only Term 2's 4
      expect(getOverallProficiency(CID, SID)).toBe(3);
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });

    it("course % counts every assessment up to the report's end", () => {
      seed({
        assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
        scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
      });
      expect(getCourseLetterData(CID, SID).R).toBe(75); // 15/20 the year so far

      setActiveTerm(CID, 1);
      expect(getCourseLetterData(CID, SID).R).toBe(50); // 5/10 to Nov 30
      setActiveTerm(CID, 2);
      expect(getCourseLetterData(CID, SID).R).toBe(75); // 15/20 to Mar 15

      setActiveTerm(CID, null);
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });

    it("work dated after the report's end does not count for that report", () => {
      seed({
        assessments: [level('a1', '2026-10-05'), level('a2', '2027-04-01')],
        scores: [score('a1', 2, '2026-10-05'), score('a2', 4, '2027-04-01')],
      });
      setActiveTerm(CID, 2);
      expect(getOverallProficiency(CID, SID)).toBe(2);
      expect(getTagScores(CID, SID, TAG)).toHaveLength(1);
      expect(assessmentInYearToDate(CID, { id: 'x', date: '2027-03-15' })).toBe(true);
      expect(assessmentInYearToDate(CID, { id: 'x', date: '2027-03-16' })).toBe(false);
    });

    it("a student with nothing yet in this term keeps the year's grade", () => {
      seed({
        assessments: [level('a1', '2026-10-05')],
        scores: [score('a1', 3, '2026-10-05')],
      });
      setActiveTerm(CID, 2);
      expect(getOverallProficiency(CID, SID)).toBe(3);
    });

    it('undated work counts in every report and in the year so far', () => {
      seed({
        assessments: [points('dated', 10, '2026-10-01'), points('undated', 10, undefined)],
        scores: [score('dated', 10, '2026-10-01'), score('undated', 0, '2026-10-01')],
      });
      expect(getCourseLetterData(CID, SID).R).toBe(50);
      setActiveTerm(CID, 1);
      expect(getCourseLetterData(CID, SID).R).toBe(50);
      expect(assessmentInYearToDate(CID, { id: 'x' })).toBe(true);
      // The term's own window, for what describes this term only, has no undated work.
      expect(assessmentInTermWindow(CID, { id: 'x' })).toBe(false);
    });

    it('the term window holds only the work dated inside the term', () => {
      seed({ assessments: [level('a1', '2026-10-05')], scores: [score('a1', 3, '2026-10-05')] });
      expect(assessmentInTermWindow(CID, { date: '2026-10-05' })).toBe(true); // no term: everything
      setActiveTerm(CID, 2);
      expect(assessmentInTermWindow(CID, { date: '2026-10-05' })).toBe(false);
      expect(assessmentInTermWindow(CID, { date: '2026-12-01' })).toBe(true);
      expect(assessmentInYearToDate(CID, { date: '2026-10-05' })).toBe(true);
    });

    it('a competency override applies year to date', () => {
      seed({
        assessments: [level('a1', '2026-10-05'), level('a2', '2027-01-20')],
        scores: [score('a1', 1, '2026-10-05'), score('a2', 2, '2027-01-20')],
      });
      setSectionOverride(CID, SID, SEC, 4, 'Showed it in conversation');
      expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
      setActiveTerm(CID, 1);
      expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
      setActiveTerm(CID, 2);
      expect(getSectionProficiency(CID, SID, SEC)).toBe(4);
      expect(getSectionProficiencyRaw(CID, SID, SEC)).toBe(1.5); // both pieces, the year to date
    });

    it('a Term 1 piece marked Missing still counts on Report 2', () => {
      seed({
        assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
        scores: [score('t2', 9, '2027-01-10')],
      });
      _cache.statuses[CID] = { [SID + ':t1']: 'NS' };
      clearProfCache();
      setActiveTerm(CID, 2);
      expect(getCourseLetterData(CID, SID).R).toBe(45); // 9/20, not 9/10
    });

    it('previousReportTerm is the term before the report, or the last ended term for the year so far', () => {
      seed({ assessments: [level('a1', '2026-10-05')], scores: [score('a1', 3, '2026-10-05')] });
      setActiveTerm(CID, 2);
      expect(previousReportTerm(CID).ordinal).toBe(1);
      setActiveTerm(CID, 1);
      expect(previousReportTerm(CID)).toBeNull();
      setActiveTerm(CID, null);
      const was = globalThis.courseToday;
      try {
        globalThis.courseToday = () => '2026-11-15';
        expect(previousReportTerm(CID)).toBeNull();
        globalThis.courseToday = () => '2026-12-05';
        expect(previousReportTerm(CID).ordinal).toBe(1);
      } finally {
        globalThis.courseToday = was;
      }
    });

    it('readAsOfTerm reads another report and puts the one in view back', () => {
      seed({
        assessments: [level('oct', '2026-10-15'), level('dec', '2026-12-10')],
        scores: [score('oct', 2, '2026-10-15'), score('dec', 4, '2026-12-10')],
      });
      setActiveTerm(CID, 2);
      expect(readAsOfTerm(CID, 1, () => getOverallProficiency(CID, SID))).toBe(2);
      expect(getActiveTerm(CID).ordinal).toBe(2);
      setActiveTerm(CID, null);
      expect(readAsOfTerm(CID, 1, () => getOverallProficiency(CID, SID))).toBe(2);
      expect(getActiveTerm(CID)).toBeNull();
    });

    it('cached results are kept per term', () => {
      seed({
        assessments: [points('t1', 10, '2026-10-01'), points('t2', 10, '2027-01-10')],
        scores: [score('t1', 5, '2026-10-01'), score('t2', 10, '2027-01-10')],
      });
      setActiveTerm(CID, 1);
      getCourseLetterData(CID, SID);
      setActiveTerm(CID, 2);
      expect(getCourseLetterData(CID, SID).R).toBe(75);
      setActiveTerm(CID, 1);
      expect(getCourseLetterData(CID, SID).R).toBe(50);
      setActiveTerm(CID, null);
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });

    it('an unknown ordinal, "all" or null means all time', () => {
      seed({ assessments: [points('t1', 10, '2026-10-01')], scores: [score('t1', 5, '2026-10-01')] });
      expect(setActiveTerm(CID, 9)).toBeNull();
      expect(getActiveTerm(CID)).toBeNull();
      expect(setActiveTerm(CID, 'all')).toBeNull();
      expect(setActiveTerm(CID, 2)).toMatchObject({ ordinal: 2, label: 'Term 2' });
      expect(getActiveTerm(CID).startsOn).toBe('2026-12-01');
    });

    it('no term is saved per class: the gradebook, dashboard and student page show the year so far', () => {
      expect(typeof activateSavedTerm).toBe('undefined');
      expect(typeof getSelectedTermOrdinal).toBe('undefined');
      expect(typeof setSelectedTermOrdinal).toBe('undefined');
      expect(typeof renderTermPicker).toBe('undefined');
    });
  });
});

describe('reporting-terms-config', () => {
  /**
   * Reporting terms live on the course row (migrations/20261017_course_reporting_terms.sql)
   * and travel in the course config like the grading scale: saveReportingTerms
   * sends them through update_course, get_class_bundle brings them back, and
   * the rules the server's check constraint enforces are checked here first.
   */

  const CID = 'e0000000-0000-4000-8000-00000000007e';

  const QUARTERS = [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-15' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-11-16', ends_on: '2027-01-31' },
  ];

  function fakeServer() {
    var server = { patches: [] };
    server.client = function () {
      return {
        rpc(name, payload) {
          if (name === 'update_course') {
            server.patches.push(payload.p_patch);
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    return server;
  }

  describe('reportingTermsError', () => {
    it('accepts an empty list and a valid list', () => {
      expect(reportingTermsError([])).toBeNull();
      expect(reportingTermsError(QUARTERS)).toBeNull();
    });
    it('names the problem in plain words', () => {
      expect(reportingTermsError(QUARTERS.concat([{}, {}, {}, {}, {}]))).toMatch(/up to 6/);
      expect(reportingTermsError([{ ordinal: 0, label: 'x', starts_on: '2026-09-01', ends_on: '2026-09-02' }])).toMatch(
        /1 to 6/,
      );
      expect(reportingTermsError([QUARTERS[0], Object.assign({}, QUARTERS[1], { ordinal: 1 })])).toMatch(/same number/);
      expect(reportingTermsError([{ ordinal: 1, label: ' ', starts_on: '2026-09-01', ends_on: '2026-09-02' }])).toMatch(
        /needs a name/,
      );
      expect(reportingTermsError([{ ordinal: 1, label: 'T', starts_on: '2026-09-01', ends_on: '' }])).toMatch(
        /end date/,
      );
      expect(reportingTermsError([{ ordinal: 1, label: 'T', starts_on: '2026-09-09', ends_on: '2026-09-01' }])).toMatch(
        /ends before it starts/,
      );
      expect(
        reportingTermsError([
          QUARTERS[0],
          { ordinal: 2, label: 'Term 2', starts_on: '2026-11-15', ends_on: '2027-01-31' },
        ]),
      ).toMatch(/overlap/);
    });
  });

  describe('saveReportingTerms', () => {
    var server;
    var originals;
    beforeEach(() => {
      localStorage.clear();
      server = fakeServer();
      originals = { getSupabase: globalThis.getSupabase, isDemoMode: globalThis.isDemoMode };
      globalThis.getSupabase = server.client;
      globalThis.isDemoMode = () => false;
      _useSupabase = true;
      saveCourses({ [CID]: { id: CID, name: 'Math 9', gradingSystem: 'proficiency', calcMethod: 'mean' } });
      _cache.courseConfigs[CID] = {};
      setActiveTerm(CID, null);
    });
    afterEach(() => {
      _useSupabase = false;
      globalThis.getSupabase = originals.getSupabase;
      globalThis.isDemoMode = originals.isDemoMode;
      setActiveTerm(CID, null);
    });

    it('numbers terms by start date and sends them as reporting_terms', async () => {
      var err = saveReportingTerms(CID, [
        { ordinal: 1, label: 'Later', starts_on: '2027-02-01', ends_on: '2027-06-30' },
        { ordinal: 2, label: 'Earlier ', starts_on: '2026-09-01', ends_on: '2027-01-31' },
      ]);
      expect(err).toBeNull();
      var terms = getReportingTerms(CID);
      expect(terms.map(t => [t.ordinal, t.label])).toEqual([
        [1, 'Earlier'],
        [2, 'Later'],
      ]);
      await new Promise(r => setTimeout(r, 10));
      expect(server.patches).toHaveLength(1);
      expect(server.patches[0].reporting_terms).toEqual(terms);
    });

    it('refuses an invalid list and saves nothing', async () => {
      var err = saveReportingTerms(CID, [{ ordinal: 1, label: 'T', starts_on: '2026-09-09', ends_on: '2026-09-01' }]);
      expect(err).toMatch(/ends before it starts/);
      expect(getReportingTerms(CID)).toEqual([]);
      await new Promise(r => setTimeout(r, 10));
      expect(server.patches).toHaveLength(0);
    });

    it('finds the term containing a date', () => {
      saveReportingTerms(CID, QUARTERS);
      expect(reportingTermOn(CID, '2026-12-25').ordinal).toBe(2);
      expect(reportingTermOn(CID, '2027-05-01')).toBeNull();
    });
  });

  describe('the bundle brings reporting terms back', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.courseConfigs[CID] = {};
    });

    it('hydrates reportingTerms from the course_config section', () => {
      _applyBundleCourseConfig(CID, { grading_scale: null, category_weights: null, reporting_terms: QUARTERS }, {});
      expect(getReportingTerms(CID)).toEqual(QUARTERS);
    });

    // The live get_class_bundle's course_config has only the scale and the
    // weights; the terms come on gradebook.course. After a sign-out wiped this
    // device, a class came back with no terms.
    it('hydrates reportingTerms from the course row when course_config leaves them out', () => {
      _applyBundleCourseConfig(
        CID,
        { grading_scale: null, category_weights: null },
        { id: CID, name: 'Humanities 8', reporting_terms: QUARTERS },
      );
      expect(getReportingTerms(CID)).toEqual(QUARTERS);
    });

    it('keeps no terms when the course row has none', () => {
      _applyBundleCourseConfig(
        CID,
        { grading_scale: null, category_weights: null },
        { id: CID, reporting_terms: null },
      );
      expect(getReportingTerms(CID)).toEqual([]);
    });
  });
});
