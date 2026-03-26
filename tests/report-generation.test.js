/**
 * Report generation tests — data layer functions that reports depend on.
 *
 * Note: page-reports.js wraps its functions in an IIFE (window.PageReports),
 * so getPronouns and renderers are NOT available as globals. We test the
 * data-layer functions from gb-data.js and gb-calc.js that reports rely on.
 */

const CID = 'rpttest';

beforeEach(() => {
  localStorage.clear();
  _cache.students[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
  _cache.reportConfig[CID] = undefined;
  _cache.overrides[CID] = undefined;
  _cache.statuses[CID] = undefined;
  _cache.config = null;
  // Ensure COURSES has our test course
  if (typeof COURSES !== 'undefined') {
    COURSES[CID] = { id: CID, name: 'Report Test', gradingSystem: 'proficiency', calcMethod: 'mostRecent', decayWeight: 0.65, curriculumTags: [] };
  }
  // Set up a learning map with sections and tags
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB1', name: 'Subject 1', color: '#0891b2' }],
    sections: [
      {
        id: 'T1', subject: 'SUB1', name: 'Section One', shortName: 'Sec1', color: '#0891b2',
        tags: [{ id: 'T1', label: 'Tag One', text: '', color: '#0891b2', subject: 'SUB1', name: 'Section One', shortName: 'Sec1' }]
      },
      {
        id: 'T2', subject: 'SUB1', name: 'Section Two', shortName: 'Sec2', color: '#dc2626',
        tags: [{ id: 'T2', label: 'Tag Two', text: '', color: '#dc2626', subject: 'SUB1', name: 'Section Two', shortName: 'Sec2' }]
      }
    ]
  };
  // Clear proficiency caches
  if (typeof clearProfCache === 'function') clearProfCache();
});

/* ── Report config save/load ─────────────────────────────────── */
describe('report config persistence', () => {
  it('saveReportConfig stores and getReportConfig retrieves report blocks', () => {
    const config = {
      preset: 'standard',
      blocks: [
        { id: 'header', label: 'Header', enabled: true, locked: true },
        { id: 'academic-summary', label: 'Academic Summary', enabled: true, locked: false }
      ]
    };
    saveReportConfig(CID, config);
    const loaded = getReportConfig(CID);
    expect(loaded.preset).toBe('standard');
    expect(loaded.blocks).toHaveLength(2);
    expect(loaded.blocks[0].id).toBe('header');
  });

  it('getReportConfig returns null for unconfigured course', () => {
    const result = getReportConfig(CID);
    expect(result).toBeNull();
  });
});

/* ── Course config with report settings ──────────────────────── */
describe('course config with report settings', () => {
  it('saves and loads reportAsPercentage setting', () => {
    saveCourseConfig(CID, { reportAsPercentage: true, calcMethod: 'mostRecent' });
    const cc = getCourseConfig(CID);
    expect(cc.reportAsPercentage).toBe(true);
    expect(cc.calcMethod).toBe('mostRecent');
  });
});

/* ── getStudents for report iteration ────────────────────────── */
describe('getStudents for report iteration', () => {
  it('returns all students for the course', () => {
    const students = [
      { id: 's1', firstName: 'Alice', lastName: 'Smith', designations: [], sortName: 'Smith Alice' },
      { id: 's2', firstName: 'Bob', lastName: 'Jones', designations: [], sortName: 'Jones Bob' }
    ];
    saveStudents(CID, students);
    const result = getStudents(CID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[1].id).toBe('s2');
  });
});

/* ── Proficiency functions used by reports ────────────────────── */
describe('proficiency functions for reports', () => {
  beforeEach(() => {
    // Set up students, assessments, and scores
    _cache.students[CID] = [
      { id: 's1', firstName: 'Alice', lastName: 'Smith', designations: [], sortName: 'Smith Alice' },
      { id: 's2', firstName: 'Bob', lastName: 'Jones', designations: [], sortName: 'Jones Bob' }
    ];
    _cache.assessments[CID] = [
      { id: 'a1', title: 'Quiz 1', date: '2025-01-10', type: 'summative', tagIds: ['T1'] },
      { id: 'a2', title: 'Quiz 2', date: '2025-01-20', type: 'summative', tagIds: ['T1'] },
      { id: 'a3', title: 'Test 1', date: '2025-01-15', type: 'summative', tagIds: ['T2'] }
    ];
    _cache.scores[CID] = {
      s1: [
        { id: 'sc1', assessmentId: 'a1', tagId: 'T1', score: 3, date: '2025-01-10', type: 'summative' },
        { id: 'sc2', assessmentId: 'a2', tagId: 'T1', score: 4, date: '2025-01-20', type: 'summative' },
        { id: 'sc3', assessmentId: 'a3', tagId: 'T2', score: 2, date: '2025-01-15', type: 'summative' }
      ]
    };
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    if (typeof clearProfCache === 'function') clearProfCache();
  });

  it('getOverallProficiency returns valid number for student with scores', () => {
    const overall = getOverallProficiency(CID, 's1');
    expect(overall).toBeGreaterThan(0);
    expect(overall).toBeLessThanOrEqual(4);
  });

  it('getSectionProficiency returns valid number for student with scores in a section', () => {
    const secProf = getSectionProficiency(CID, 's1', 'T1');
    expect(secProf).toBeGreaterThan(0);
    expect(secProf).toBeLessThanOrEqual(4);
  });

  it('getTagProficiency returns valid number', () => {
    const tagProf = getTagProficiency(CID, 's1', 'T1');
    expect(tagProf).toBeGreaterThan(0);
    expect(tagProf).toBeLessThanOrEqual(4);
  });

  it('students with no scores return 0 from proficiency functions', () => {
    expect(getOverallProficiency(CID, 's2')).toBe(0);
    expect(getSectionProficiency(CID, 's2', 'T1')).toBe(0);
    expect(getTagProficiency(CID, 's2', 'T1')).toBe(0);
  });

  it('getSectionTrend returns up/down/flat for known data', () => {
    // s1 has scores 3 then 4 for T1 — trend should be 'up'
    const trend = getSectionTrend(CID, 's1', 'T1');
    expect(trend).toBe('up');

    // Student with no scores should be 'flat'
    expect(getSectionTrend(CID, 's2', 'T1')).toBe('flat');
  });
});
