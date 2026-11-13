/**
 * class: the tests that were tests/class-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('class-check-note', () => {
  /**
   * Switching to a class shows its saved copy, then asks the server whether it
   * changed. The sweep saw a score saved on the phone read "no score" for 3 to
   * 9 seconds after a switch, then change with no word: the "Checking for
   * updates…" note went when editing unlocked at 3 seconds. It now stays until
   * the server answers (30 seconds at most).
   */

  function classListStub() {
    var names = new Set();
    return {
      add: n => names.add(n),
      remove: n => names.delete(n),
      contains: n => names.has(n),
      toggle(n, force) {
        if (force === undefined ? !names.has(n) : force) names.add(n);
        else names.delete(n);
      },
    };
  }

  describe('the Checking for Updates note', () => {
    var originalBody;
    var originalHandle;
    var originalGetElementById;
    var answer;

    beforeEach(() => {
      vi.useFakeTimers();
      originalBody = document.body;
      originalHandle = globalThis._handleExternalCourseUpdate;
      originalGetElementById = document.getElementById;
      document.getElementById = () => null;
      document.body = { classList: classListStub(), setAttribute() {}, removeAttribute() {} };
      globalThis._handleExternalCourseUpdate = () =>
        new Promise(resolve => {
          answer = resolve;
        });
      _pageLocks.checking = 0;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    });

    afterEach(() => {
      vi.useRealTimers();
      document.body = originalBody;
      document.getElementById = originalGetElementById;
      globalThis._handleExternalCourseUpdate = originalHandle;
      _pageLocks.checking = 0;
    });

    it('stays after editing unlocks, until the server answers', async () => {
      var check = _startClassCheck(getActiveCourse());
      var classes = document.body.classList;

      vi.advanceTimersByTime(500);
      expect(classes.contains('fv-checking-slow')).toBe(true);
      expect(_pageLocks.checking).toBe(1);

      vi.advanceTimersByTime(4000);
      expect(_pageLocks.checking).toBe(0);
      expect(classes.contains('fv-checking-slow')).toBe(true);

      answer();
      await check;
      expect(classes.contains('fv-checking-slow')).toBe(false);
    });

    it('goes after 30 seconds even with no answer', () => {
      _startClassCheck(getActiveCourse());
      vi.advanceTimersByTime(29000);
      expect(document.body.classList.contains('fv-checking-slow')).toBe(true);
      vi.advanceTimersByTime(1500);
      expect(document.body.classList.contains('fv-checking-slow')).toBe(false);
      answer();
    });
  });
});

describe('class-insights', () => {
  /**
   * The dashboard's class insights (teacher/dash-insights.js) and the calc.js
   * helpers behind them: how many students sit at each proficiency on a
   * competency, Who Needs Help, Missing and Late, and the class average's
   * change since the term before.
   */

  const CID = 'course-insights';
  const STUDENTS = [
    { id: 's1', firstName: 'Raj', lastName: 'Venkatesh' },
    { id: 's2', firstName: 'Sam', lastName: 'Blackwood' },
    { id: 's3', firstName: 'Noor', lastName: 'Al-Rashid' },
    { id: 's4', firstName: 'Ethan', lastName: 'Dubois' },
  ];
  const SECTIONS = [
    { id: 'q', name: 'Questioning and Predicting', shortName: 'Questioning', color: '#00f', tags: [{ id: 'tq' }] },
    { id: 'p', name: 'Processing', shortName: 'Processing', color: '#0f0', tags: [{ id: 'tp' }] },
    { id: 'c', name: 'Communicating', shortName: 'Communicating', color: '#f00', tags: [{ id: 'tc' }] },
  ];
  // Each student's proficiency on each competency; 0 is not scored.
  const PROF = {
    s1: { q: 2, p: 1, c: 2 },
    s2: { q: 2, p: 2, c: 2.3 },
    s3: { q: 4, p: 3.6, c: 4 },
    s4: { q: 3, p: 2, c: 0 },
  };

  const STUBBED = [
    'getSectionProficiency',
    'getGroupProficiency',
    'getGroupedSections',
    'getSections',
    'getSectionEvidenceCount',
    'getAssessments',
    'getAssignmentStatus',
    'assessmentCellValue',
  ];
  let saved;
  let evidence;

  beforeEach(() => {
    saved = {};
    STUBBED.forEach(name => {
      saved[name] = globalThis[name];
    });
    evidence = 3;
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    globalThis.getSectionProficiency = (cid, sid, secId) => (PROF[sid] && PROF[sid][secId]) || 0;
    globalThis.getGroupedSections = () => ({ groups: [], ungrouped: SECTIONS });
    globalThis.getSections = () => SECTIONS;
    globalThis.getSectionEvidenceCount = () => evidence;
  });

  afterEach(() => {
    STUBBED.forEach(name => {
      globalThis[name] = saved[name];
    });
    delete COURSES[CID];
    setActiveTerm(CID, null);
  });

  const IDS = STUDENTS.map(s => s.id);

  describe('competencyDistribution', () => {
    it('bands each scored student by their rounded proficiency, Emerging first', () => {
      const d = competencyDistribution(CID, IDS, { sectionId: 'p' });
      expect(d.bands.map(b => b.label)).toEqual(['Emerging', 'Developing', 'Proficient', 'Extending']);
      expect(d.bands.map(b => b.ids)).toEqual([['s1'], ['s2', 's4'], [], ['s3']]);
      expect(d.avg).toBeCloseTo((1 + 2 + 3.6 + 2) / 4);
    });

    it('leaves out students not yet scored on it', () => {
      const d = competencyDistribution(CID, IDS, { sectionId: 'c' });
      expect(d.values.s4).toBeUndefined();
      expect(d.bands[1].ids).toEqual(['s1', 's2']);
    });
  });

  describe('Who Needs Help', () => {
    it('reads a saved rule and falls back to Below Proficient, at least 3 scores', () => {
      expect(DashInsights.readRule(undefined)).toEqual({ below: 3, min: 3 });
      expect(DashInsights.readRule({ below: 2, min: 1 })).toEqual({ below: 2, min: 1 });
      expect(DashInsights.readRule({ below: 7, min: 9 })).toEqual({ below: 3, min: 3 });
    });
  });

  describe('the attention model (the competency filter and Needs Support read it)', () => {
    const OVERALL = { s1: 1.7, s2: 2.1, s3: 3.8, s4: 2.5 };
    beforeEach(() => {
      saved.getStudentQuickObs = globalThis.getStudentQuickObs;
      saved.getOverallProficiency = globalThis.getOverallProficiency;
      saved.studentGradeSummary = globalThis.studentGradeSummary;
      globalThis.getStudentQuickObs = () => [];
      globalThis.getAssessments = () => [];
      globalThis.getOverallProficiency = (cid, sid) => OVERALL[sid];
      globalThis.studentGradeSummary = (cid, sid) => ({ text: String(OVERALL[sid]), level: Math.round(OVERALL[sid]) });
    });
    afterEach(() => {
      ['getStudentQuickObs', 'getOverallProficiency', 'studentGradeSummary'].forEach(name => {
        globalThis[name] = saved[name];
      });
    });
    const model = rule => DashInsights.attentionModel(CID, STUDENTS, { rule, todayStr: '2026-10-22' });

    it('lists each student once, worst first, with the competencies under the rule', () => {
      const m = model({ below: 3, min: 3 });
      expect(m.people.map(p => [p.student.id, p.below.length])).toEqual([
        ['s1', 3],
        ['s2', 3],
        ['s4', 1],
      ]);
      expect(m.counts).toEqual({ all: 3, below: 3, notobs: 0, nostr: 0, missing: 0 });
      expect(DashInsights.belowCounts(m)).toEqual({ 's:q': 2, 's:p': 3, 's:c': 2 });
    });
  });

  describe('the Missing and Late cell', () => {
    it('says so at zero and counts each kind otherwise', () => {
      expect(DashInsights.missingGlanceHtml([], CID)).toContain('Nothing is missing or late.');
      const html = DashInsights.missingGlanceHtml([{ kind: 'ns' }, { kind: 'late' }, { kind: 'late' }], CID);
      expect(html).toContain('<b>1</b> Missing · <b>2</b> Late</span>');
      expect(html).not.toContain('Past Due');
    });

    it('opens the gradebook when anything is missing or late, and is plain text at zero (plan F.8)', () => {
      const html = DashInsights.missingGlanceHtml([{ kind: 'ns' }], CID);
      expect(html).toMatch(/^<a class="dash-glance-cell dash-glance-missing" role="link" tabindex="0"/);
      expect(html).toContain('data-href="/gradebook?course=' + CID + '"');
      expect(html).not.toContain('naFilter');
      expect(DashInsights.missingGlanceHtml([], CID)).toMatch(/^<div class="dash-glance-cell dash-glance-missing">/);
    });

    it('the Needs Attention card is gone; its model and rule stay', () => {
      expect(DashInsights.attentionCardHtml).toBeUndefined();
      ['attentionModel', 'belowLists', 'readRule', 'isBelowRule'].forEach(name =>
        expect(typeof DashInsights[name]).toBe('function'),
      );
    });
  });

  describe('Missing and Late', () => {
    it('lists work labelled Missing or Late in the active term, never an empty cell past its due date', () => {
      const A = [
        { id: 'a1', title: 'Lab', date: '2026-10-01', dueDate: '2026-10-05' },
        { id: 'a2', title: 'Quiz', date: '2026-10-10', dueDate: '2026-10-30' },
      ];
      globalThis.getAssessments = () => A;
      // s3 has nothing on the Lab, which is past due: not missing.
      globalThis.getAssignmentStatus = (cid, sid, aid) =>
        sid === 's1' && aid === 'a2' ? 'NS' : sid === 's2' && aid === 'a1' ? 'LATE' : null;
      const items = DashInsights.missingItems(CID, STUDENTS);
      expect(items.map(it => [it.kind, it.student.id, it.assessment.id])).toEqual([
        ['ns', 's1', 'a2'],
        ['late', 's2', 'a1'],
      ]);
    });
  });

  describe('the class average since the last report', () => {
    it('is null before any report has ended', () => {
      expect(classGradeChange(CID, IDS)).toBeNull();
    });
  });

  describe('a class average on one assessment', () => {
    it('reads as a level, points with a %, or a %', () => {
      expect(classColumnAverageText(CID, { scoreMode: 'proficiency' }, { avg: 2.94, count: 3 })).toBe('2.9');
      expect(
        classColumnAverageText(CID, { scoreMode: 'points', maxPoints: 10 }, { avg: 7.37, pct: 73.7, count: 3 }),
      ).toBe('7.4/10 · 74%');
      expect(classColumnAverageText(CID, { scoreMode: 'points' }, null)).toBe('—');
    });
  });

  describe('dashboard settings follow the teacher', () => {
    it('saves Cards | Grid and the rule with the teacher config, each keeping the other', () => {
      saveDashboardPrefs({ studentView: 'grid' });
      saveDashboardPrefs({ helpRule: { below: 2, min: 1 } });
      expect(getDashboardPrefs()).toEqual({ studentView: 'grid', helpRule: { below: 2, min: 1 } });
      expect(JSON.parse(localStorage.getItem('gb-config')).dashboardPrefs.studentView).toBe('grid');
    });

    it('sends them to save_teacher_preferences as dashboard_prefs', () => {
      expect(_teacherPrefsPatchFromConfig({ dashboardPrefs: { studentView: 'grid' } })).toEqual({
        dashboard_prefs: { studentView: 'grid' },
      });
    });
  });
});

describe('class-preload', () => {
  /**
   * Every class is loaded at sign-in, not only the one the teacher opens with:
   * preloadClasses loads the rest one at a time, and loadClass shares one load
   * per class. Class Settings shows a class's student count once it is in,
   * and a class picked before its data arrives shows "Loading this class…"
   * instead of an empty roster that could be edited.
   */

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

  describe('Class Settings while classes load', () => {
    var main;
    var sidebar;
    var originalGetElementById;
    var originalQuery;
    beforeEach(() => {
      main = { innerHTML: '' };
      sidebar = { innerHTML: '', style: {}, removeAttribute() {} };
      originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        if (id === 'sidebar-mount') return sidebar;
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
      // The class list sits where the student list goes.
      expect(sidebar.innerHTML).toContain('Loading…');
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
});
