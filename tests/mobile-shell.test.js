/**
 * Mobile app shell tests — page-mobile.js patterns
 *
 * Tests the module API contracts, event delegation patterns,
 * and navigation stack behavior. Since page-mobile.js auto-boots
 * as an IIFE, we test the patterns through the modules it calls.
 */

import './setup-mobile.js';

/* ── Module existence ───────────────────────────────────────── */
describe('Mobile module API contracts', () => {
  it('MComponents is defined with all required methods', () => {
    expect(MComponents).toBeDefined();
    expect(typeof MComponents.navBar).toBe('function');
    expect(typeof MComponents.largeTitleHTML).toBe('function');
    expect(typeof MComponents.presentSheet).toBe('function');
    expect(typeof MComponents.dismissSheet).toBe('function');
    expect(typeof MComponents.showToast).toBe('function');
    expect(typeof MComponents.hideToast).toBe('function');
    expect(typeof MComponents.setupScrollTitle).toBe('function');
    expect(typeof MComponents.haptic).toBe('function');
    expect(typeof MComponents.relativeTime).toBe('function');
    expect(typeof MComponents.dateGroupLabel).toBe('function');
    expect(typeof MComponents.esc).toBe('function');
    expect(typeof MComponents.profBg).toBe('function');
    expect(typeof MComponents.setupOfflineDetection).toBe('function');
    expect(typeof MComponents.avatarColor).toBe('function');
    expect(typeof MComponents.avatarInitials).toBe('function');
  });

  it('MStudents is defined with all required methods', () => {
    expect(MStudents).toBeDefined();
    expect(typeof MStudents.renderList).toBe('function');
    expect(typeof MStudents.renderDetail).toBe('function');
    expect(typeof MStudents.filterList).toBe('function');
  });

  it('MObserve is defined with all required methods', () => {
    expect(MObserve).toBeDefined();
    expect(typeof MObserve.renderFeed).toBe('function');
    expect(typeof MObserve.applyFilter).toBe('function');
    expect(typeof MObserve.presentNewObsSheet).toBe('function');
    expect(typeof MObserve.resetSheetState).toBe('function');
    expect(typeof MObserve.toggleStudentPicker).toBe('function');
    expect(typeof MObserve.selectStudent).toBe('function');
    expect(typeof MObserve.filterStudentPicker).toBe('function');
    expect(typeof MObserve.setSentiment).toBe('function');
    expect(typeof MObserve.setContext).toBe('function');
    expect(typeof MObserve.toggleDim).toBe('function');
    expect(typeof MObserve.updateSubmitState).toBe('function');
    expect(typeof MObserve.saveObservation).toBe('function');
    expect(typeof MObserve.deleteObservation).toBe('function');
  });

  it('MGrade is defined with all required methods', () => {
    expect(MGrade).toBeDefined();
    expect(typeof MGrade.renderPicker).toBe('function');
    expect(typeof MGrade.filterAssessments).toBe('function');
    expect(typeof MGrade.renderSwiper).toBe('function');
    expect(typeof MGrade.setScore).toBe('function');
    expect(typeof MGrade.setStatus).toBe('function');
    expect(typeof MGrade.undoLastScore).toBe('function');
    expect(typeof MGrade.setupSwiper).toBe('function');
    expect(typeof MGrade.jumpToStudent).toBe('function');
  });
});

/* ── Screen HTML structure ──────────────────────────────────── */
describe('Screen HTML structure contracts', () => {
  const originals = {};

  function mockAll() {
    const defaults = {
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'Student', preferred: '', pronouns: '', designations: [] }],
      sortStudents: (arr) => arr,
      displayName: (st) => st.firstName + ' ' + st.lastName,
      getOverallProficiency: () => 3.0,
      getAssignmentStatuses: () => ({}),
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: [] }],
      getScores: () => ({}),
      getSections: () => [],
      getGroupedSections: () => ({ groups: [], ungrouped: [] }),
      getCompletionPct: () => 0,
      getAllTags: () => [],
      getStudentQuickObs: () => [],
      getAllQuickObs: () => [],
      getSectionProficiency: () => 0,
      getSectionTrend: () => 'flat',
      getSectionGrowthData: () => [],
      renderGrowthSparkline: () => '',
      getTagScores: () => [],
      getTagProficiency: () => 0,
      getTagById: () => null,
      getSectionForTag: () => null,
      getFocusAreas: () => [],
      getGroupProficiency: () => 0,
      getActiveCourse: () => 'test',
      getCompetencyGroups: () => [],
      getAssignmentStatus: () => null,
      setAssignmentStatus: () => {},
      saveScores: () => {},
    };
    Object.keys(defaults).forEach(fn => {
      originals[fn] = globalThis[fn];
      globalThis[fn] = defaults[fn];
    });
    globalThis.COURSES = { test: { id: 'test', name: 'Test', calcMethod: 'mostRecent' } };
  }

  function restoreAll() {
    Object.keys(originals).forEach(fn => {
      if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    });
  }

  beforeEach(() => {
    clearProfCache();
    mockAll();
  });

  afterEach(() => {
    restoreAll();
  });

  it('renderList returns HTML with m-screen wrapper', () => {
    const html = MStudents.renderList('test');
    expect(html).toContain('<div class="m-screen"');
    expect(html).toContain('id="m-screen-students-list"');
  });

  it('renderDetail returns HTML with m-screen wrapper', () => {
    const html = MStudents.renderDetail('test', 'stu1');
    expect(html).toContain('<div class="m-screen');
    expect(html).toContain('id="m-screen-student-detail"');
  });

  it('renderFeed returns HTML with m-screen wrapper', () => {
    const html = MObserve.renderFeed('test');
    expect(html).toContain('<div class="m-screen"');
    expect(html).toContain('id="m-screen-obs-feed"');
  });

  it('renderPicker returns HTML with m-screen wrapper', () => {
    const html = MGrade.renderPicker('test');
    expect(html).toContain('<div class="m-screen"');
    expect(html).toContain('id="m-screen-grade-picker"');
  });

  it('renderSwiper returns HTML with m-screen wrapper', () => {
    const html = MGrade.renderSwiper('test', 'a1');
    expect(html).toContain('<div class="m-screen');
    expect(html).toContain('id="m-screen-grade-swiper"');
  });

  it('all screens contain a nav bar', () => {
    expect(MStudents.renderList('test')).toContain('m-nav-bar');
    expect(MStudents.renderDetail('test', 'stu1')).toContain('m-nav-bar');
    expect(MObserve.renderFeed('test')).toContain('m-nav-bar');
    expect(MGrade.renderPicker('test')).toContain('m-nav-bar');
    expect(MGrade.renderSwiper('test', 'a1')).toContain('m-nav-bar');
  });

  it('detail screens include back button', () => {
    expect(MStudents.renderDetail('test', 'stu1')).toContain('m-nav-bar-back');
    expect(MGrade.renderSwiper('test', 'a1')).toContain('m-nav-bar-back');
  });

  it('list screens do NOT include back button', () => {
    expect(MStudents.renderList('test')).not.toContain('m-nav-bar-back');
    expect(MObserve.renderFeed('test')).not.toContain('m-nav-bar-back');
    expect(MGrade.renderPicker('test')).not.toContain('m-nav-bar-back');
  });
});

/* ── XSS prevention ─────────────────────────────────────────── */
describe('XSS prevention in rendered HTML', () => {
  const originals = {};

  function mockWithXSS() {
    const xssName = '<img src=x onerror=alert(1)>';
    originals.getStudents = globalThis.getStudents;
    originals.sortStudents = globalThis.sortStudents;
    originals.displayName = globalThis.displayName;
    originals.getOverallProficiency = globalThis.getOverallProficiency;
    originals.getAssignmentStatuses = globalThis.getAssignmentStatuses;
    originals.getAssessments = globalThis.getAssessments;

    globalThis.getStudents = () => [{ id: 'xss1', firstName: xssName, lastName: 'Test', preferred: '', pronouns: xssName, designations: [] }];
    globalThis.sortStudents = (arr) => arr;
    globalThis.displayName = (st) => st.firstName + ' ' + st.lastName;
    globalThis.getOverallProficiency = () => 3.0;
    globalThis.getAssignmentStatuses = () => ({});
    globalThis.getAssessments = () => [];
  }

  afterEach(() => {
    Object.keys(originals).forEach(fn => {
      if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    });
  });

  it('student names are HTML-escaped in list', () => {
    mockWithXSS();
    const html = MStudents.renderList('test');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

/* ── Data action attributes ─────────────────────────────────── */
describe('Data action attributes for event delegation', () => {
  const originals = {};

  beforeEach(() => {
    const defaults = {
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'Student', preferred: '', pronouns: '', designations: [] }],
      sortStudents: (arr) => arr,
      displayName: (st) => st.firstName,
      getOverallProficiency: () => 0,
      getAssignmentStatuses: () => ({}),
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
      getScores: () => ({}),
      getSections: () => [],
      getGroupedSections: () => ({ groups: [], ungrouped: [] }),
      getCompletionPct: () => 0,
      getAllTags: () => [],
      getStudentQuickObs: () => [],
      getAllQuickObs: () => [],
      getSectionProficiency: () => 0,
      getSectionTrend: () => 'flat',
      getSectionGrowthData: () => [],
      renderGrowthSparkline: () => '',
      getTagScores: () => [],
      getTagProficiency: () => 0,
      getTagById: () => ({ id: 't1', label: 'Test Tag' }),
      getSectionForTag: () => ({ color: '#888' }),
      getFocusAreas: () => [],
      getGroupProficiency: () => 0,
      getActiveCourse: () => 'test',
      getCompetencyGroups: () => [],
      getAssignmentStatus: () => null,
    };
    Object.keys(defaults).forEach(fn => {
      originals[fn] = globalThis[fn];
      globalThis[fn] = defaults[fn];
    });
    globalThis.COURSES = { test: { id: 'test', name: 'Test', calcMethod: 'mostRecent' } };
    clearProfCache();
  });

  afterEach(() => {
    Object.keys(originals).forEach(fn => {
      if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    });
  });

  it('student list cells have m-student-detail action', () => {
    const html = MStudents.renderList('test');
    expect(html).toContain('data-action="m-student-detail"');
    expect(html).toContain('data-sid="stu1"');
  });

  it('assessment cells have m-grade-assess action', () => {
    const html = MGrade.renderPicker('test');
    expect(html).toContain('data-action="m-grade-assess"');
    expect(html).toContain('data-aid="a1"');
  });

  it('score buttons have m-grade-score action with correct data', () => {
    const html = MGrade.renderSwiper('test', 'a1');
    expect(html).toContain('data-action="m-grade-score"');
    expect(html).toContain('data-sid="stu1"');
    expect(html).toContain('data-aid="a1"');
    expect(html).toContain('data-tid="t1"');
  });

  it('observation FAB has m-obs-new action', () => {
    const html = MObserve.renderFeed('test');
    expect(html).toContain('data-action="m-obs-new"');
  });

  it('filter pills have m-obs-filter action', () => {
    const html = MObserve.renderFeed('test');
    expect(html).toContain('data-action="m-obs-filter"');
  });

  it('student cells have data-sid for navigation', () => {
    const html = MStudents.renderList('test');
    expect(html).toContain('data-sid="stu1"');
  });

  it('grade segmented control has data-val for filtering', () => {
    const html = MGrade.renderPicker('test');
    expect(html).toContain('data-val="recent"');
    expect(html).toContain('data-val="all"');
    expect(html).toContain('data-val="ungraded"');
  });

  it('thumbnail strip has m-grade-jump actions', () => {
    const html = MGrade.renderSwiper('test', 'a1');
    expect(html).toContain('data-action="m-grade-jump"');
    expect(html).toContain('data-idx="0"');
  });

  it('status pills carry student and assessment IDs', () => {
    const html = MGrade.renderSwiper('test', 'a1');
    expect(html).toMatch(/data-val="NS".*data-sid="stu1".*data-aid="a1"/);
  });
});

/* ── Screen structure (requires mocks) ──────────────────────── */
describe('Screen structure details', () => {
  const originals2 = {};
  beforeEach(() => {
    const defaults = {
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'Student', preferred: '', pronouns: '', designations: [] }],
      sortStudents: (arr) => arr,
      displayName: (st) => st.firstName + ' ' + st.lastName,
      getOverallProficiency: () => 3.0,
      getAssignmentStatuses: () => ({}),
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
      getScores: () => ({}),
      getSections: () => [],
      getGroupedSections: () => ({ groups: [], ungrouped: [] }),
      getCompletionPct: () => 0,
      getAllTags: () => [],
      getStudentQuickObs: () => [],
      getAllQuickObs: () => [],
      getSectionProficiency: () => 0,
      getSectionTrend: () => 'flat',
      getSectionGrowthData: () => [],
      renderGrowthSparkline: () => '',
      getTagScores: () => [],
      getTagProficiency: () => 0,
      getTagById: () => ({ id: 't1', label: 'T' }),
      getSectionForTag: () => ({ color: '#888' }),
      getFocusAreas: () => [],
      getGroupProficiency: () => 0,
      getActiveCourse: () => 'test',
      getCompetencyGroups: () => [],
      getAssignmentStatus: () => null,
      setAssignmentStatus: () => {},
      saveScores: () => {},
    };
    Object.keys(defaults).forEach(fn => {
      originals2[fn] = globalThis[fn];
      globalThis[fn] = defaults[fn];
    });
    globalThis.COURSES = { test: { id: 'test', name: 'Test', calcMethod: 'mostRecent' } };
    clearProfCache();
  });
  afterEach(() => {
    Object.keys(originals2).forEach(fn => {
      if (originals2[fn] !== undefined) globalThis[fn] = originals2[fn];
    });
  });

  it('list and feed screens have unique IDs', () => {
    const ids = [
      MStudents.renderList('test').match(/id="(m-screen-[^"]+)"/)[1],
      MObserve.renderFeed('test').match(/id="(m-screen-[^"]+)"/)[1],
      MGrade.renderPicker('test').match(/id="(m-screen-[^"]+)"/)[1],
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('student detail screen has its own ID', () => {
    expect(MStudents.renderDetail('test', 'stu1')).toContain('id="m-screen-student-detail"');
  });

  it('grade swiper screen has its own ID', () => {
    expect(MGrade.renderSwiper('test', 'a1')).toContain('id="m-screen-grade-swiper"');
  });

  it('list screens have unique nav bar IDs', () => {
    const screens = [MStudents.renderList('test'), MObserve.renderFeed('test'), MGrade.renderPicker('test')];
    const navIds = screens.map(html => (html.match(/id="(m-nav-bar-[^"]+)"/) || [])[1]);
    expect(new Set(navIds).size).toBe(3);
  });

  it('list screens have m-screen-content and large title', () => {
    [MStudents.renderList('test'), MObserve.renderFeed('test'), MGrade.renderPicker('test')].forEach(html => {
      expect(html).toContain('m-screen-content');
      expect(html).toContain('m-title-large');
    });
  });

  it('student detail has m-screen-content', () => {
    expect(MStudents.renderDetail('test', 'stu1')).toContain('m-screen-content');
  });

  it('detail screens include back button', () => {
    expect(MStudents.renderDetail('test', 'stu1')).toContain('m-nav-bar-back');
    expect(MGrade.renderSwiper('test', 'a1')).toContain('m-nav-bar-back');
  });
});
