/**
 * Mobile Student Quick-Look tests — m-students.js
 *
 * Tests the student list rendering, detail screen data,
 * trend display, evidence counting, and search filtering.
 */

import './setup-mobile.js';

const CID = 'test';
const originals = {};

function mockDataLayer(overrides) {
  const defaults = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', pronouns: 'she/her', designations: ['G'] },
      { id: 'stu3', firstName: 'Liam', lastName: 'Chen', preferred: '', pronouns: 'he/him', designations: ['K'] },
    ],
    sortStudents: (arr) => arr,
    displayName: (st) => (st.preferred || st.firstName) + ' ' + st.lastName,
    getOverallProficiency: () => 3.0,
    getAssignmentStatuses: () => ({}),
    getAssessments: () => [],
    getScores: () => ({}),
    getSections: () => [],
    getGroupedSections: () => ({ groups: [], ungrouped: [] }),
    getCompletionPct: () => 50,
    getAllTags: () => [],
    getStudentQuickObs: () => [],
    getSectionProficiency: () => 3.0,
    getSectionTrend: () => 'flat',
    getSectionGrowthData: () => [],
    renderGrowthSparkline: () => '<span>sparkline</span>',
    getTagScores: () => [],
    getTagProficiency: () => 0,
    getTagById: () => null,
    getSectionForTag: () => null,
    getFocusAreas: () => [],
    getGroupProficiency: () => 0,
    getActiveCourse: () => CID,
    getCompetencyGroups: () => [],
  };
  const mocks = { ...defaults, ...overrides };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

function restoreDataLayer() {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
  });
}

beforeEach(() => {
  clearProfCache();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

afterEach(() => {
  restoreDataLayer();
});

/* ── renderList ─────────────────────────────────────────────── */
describe('MStudents.renderList', () => {
  it('renders all students as list cells', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('Cece');
    expect(html).toContain('Noor');
    expect(html).toContain('Liam');
  });

  it('includes role="button" and tabindex on cells for accessibility', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('shows empty state when no students', () => {
    mockDataLayer({ getStudents: () => [] });
    const html = MStudents.renderList(CID);
    expect(html).toContain('No Students');
    expect(html).toContain('Add students on the desktop app');
  });

  it('shows IEP badge for designated students', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('m-badge-iep');
  });

  it('shows MOD badge for modified students', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('m-badge-mod');
  });

  it('shows proficiency badge with correct value', () => {
    mockDataLayer({ getOverallProficiency: (cid, sid) => sid === 'stu1' ? 3.5 : 2.0 });
    const html = MStudents.renderList(CID);
    expect(html).toContain('3.5');
    expect(html).toContain('2.0');
  });

  it('shows dash for zero proficiency', () => {
    mockDataLayer({ getOverallProficiency: () => 0 });
    const html = MStudents.renderList(CID);
    // The proficiency badge should show '—' not '0.0'
    expect(html).toContain('—');
    expect(html).not.toContain('>0.0<');
  });

  it('shows missing dot when student has NS status', () => {
    mockDataLayer({
      getAssignmentStatuses: () => ({ 'stu1:a1': 'NS' }),
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-01-01', tagIds: ['t1'] }],
    });
    const html = MStudents.renderList(CID);
    expect(html).toContain('m-missing-dot');
  });

  it('does NOT repeat getAssessments/getAssignmentStatuses per student (N+1 fix)', () => {
    let assessCalls = 0;
    let statusCalls = 0;
    mockDataLayer({
      getAssessments: () => { assessCalls++; return []; },
      getAssignmentStatuses: () => { statusCalls++; return {}; },
    });
    MStudents.renderList(CID);
    // Should be called exactly once (hoisted), not once per student (3 students)
    expect(assessCalls).toBe(1);
    expect(statusCalls).toBe(1);
  });

  it('includes search bar', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('m-search-input');
    expect(html).toContain('Search students...');
  });

  it('renders pronouns as subtitle', () => {
    mockDataLayer({});
    const html = MStudents.renderList(CID);
    expect(html).toContain('she/her');
    expect(html).toContain('he/him');
  });
});

/* ── renderDetail ───────────────────────────────────────────── */
describe('MStudents.renderDetail', () => {
  it('shows hero with student name and proficiency', () => {
    mockDataLayer({});
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Cece');
    expect(html).toContain('m-hero-prof');
    expect(html).toContain('3.0');
  });

  it('shows proficiency label (Proficient, Emerging, etc.)', () => {
    mockDataLayer({});
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Proficient');
  });

  it('returns error when student not found', () => {
    mockDataLayer({});
    const html = MStudents.renderDetail(CID, 'nonexistent');
    expect(html).toContain('Student not found');
  });

  it('shows stats strip with completion, assessed, and notes', () => {
    mockDataLayer({
      getCompletionPct: () => 75,
      getAllTags: () => [{ id: 't1' }, { id: 't2' }],
      getStudentQuickObs: () => [{ id: 'ob1' }, { id: 'ob2' }, { id: 'ob3' }],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('75%');
    expect(html).toContain('Complete');
    expect(html).toContain('3'); // 3 observations
    expect(html).toContain('Notes');
  });

  it('shows missing count in stats strip', () => {
    mockDataLayer({
      getAssignmentStatuses: () => ({ 'stu1:a1': 'NS', 'stu1:a2': 'NS' }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', date: '2025-01-01', tagIds: [] },
        { id: 'a2', type: 'summative', date: '2025-01-02', tagIds: [] },
      ],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Missing');
    expect(html).toContain('>2<');
  });
});

/* ── Trend arrows (bug fix verification) ────────────────────── */
describe('Trend display (string comparison fix)', () => {
  it('shows ↑ for upward trend', () => {
    mockDataLayer({
      getSections: () => [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }],
      getGroupedSections: () => ({ groups: [], ungrouped: [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'up',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('↑');
    expect(html).toContain('var(--score-3)'); // green for upward
  });

  it('shows ↓ for downward trend', () => {
    mockDataLayer({
      getSections: () => [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }],
      getGroupedSections: () => ({ groups: [], ungrouped: [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }] }),
      getSectionProficiency: () => 2.0,
      getSectionTrend: () => 'down',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('↓');
    expect(html).toContain('var(--score-1)'); // red for downward
  });

  it('shows — for flat trend', () => {
    mockDataLayer({
      getSections: () => [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }],
      getGroupedSections: () => ({ groups: [], ungrouped: [{ id: 's1', name: 'Test Section', shortName: 'Test', tags: [], color: '#888' }] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('—');
  });
});

/* ── Evidence count (summative only) ────────────────────────── */
describe('Evidence count filtering', () => {
  it('only counts summative scores as evidence', () => {
    const sec = {
      id: 's1', name: 'Test', shortName: 'Test', color: '#888',
      tags: [{ id: 't1', label: 'Tag 1' }],
    };
    mockDataLayer({
      getSections: () => [sec],
      getGroupedSections: () => ({ groups: [], ungrouped: [sec] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
      getTagScores: () => [
        { score: 3, tagId: 't1', assessmentId: 'a1', type: 'summative', date: '2025-01-01' },
        { score: 2, tagId: 't1', assessmentId: 'a2', type: 'formative', date: '2025-01-02' },
        { score: 4, tagId: 't1', assessmentId: 'a3', type: 'formative', date: '2025-01-03' },
      ],
      getTagProficiency: () => 3.0,
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    // Timeline should only show the summative score (score=3), not formatives
    expect(html).toContain('m-sec-tl-dot');
    // Only 1 timeline item (the summative), not 3
    var dotCount = (html.match(/m-sec-tl-dot/g) || []).length;
    expect(dotCount).toBe(1);
  });
});

/* ── Focus areas ────────────────────────────────────────────── */
describe('Focus areas card', () => {
  it('shows focus areas when student has weak tags', () => {
    mockDataLayer({
      getFocusAreas: () => [
        { tag: { id: 't1', label: 'Questioning' }, prof: 1.5, section: { color: '#2196F3' } },
        { tag: { id: 't2', label: 'Evaluating' }, prof: 0, section: { color: '#4CAF50' } },
      ],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Focus Areas');
    expect(html).toContain('Questioning');
    expect(html).toContain('1.5');
    expect(html).toContain('No evidence');
  });

  it('hides focus areas when all tags are proficient', () => {
    mockDataLayer({
      getFocusAreas: () => [
        { tag: { id: 't1', label: 'Tag 1' }, prof: 3.5, section: { color: '#888' } },
        { tag: { id: 't2', label: 'Tag 2' }, prof: 4.0, section: { color: '#888' } },
      ],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).not.toContain('Focus Areas');
  });
});

/* ── Competency groups ──────────────────────────────────────── */
describe('Competency group display', () => {
  it('renders group headers with averaged proficiency', () => {
    mockDataLayer({
      getSections: () => [
        { id: 's1', name: 'Questioning', shortName: 'Quest', tags: [], color: '#888', groupId: 'g1' },
      ],
      getGroupedSections: () => ({
        groups: [{
          group: { id: 'g1', label: 'Thinking', name: 'Thinking' },
          sections: [{ id: 's1', name: 'Questioning', shortName: 'Quest', tags: [], color: '#888' }],
        }],
        ungrouped: [],
      }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
      getGroupProficiency: () => 3.2,
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Thinking');
    expect(html).toContain('m-group-header');
    expect(html).toContain('3.2');
  });

  it('falls back to flat section list when no groups exist', () => {
    const sec = { id: 's1', name: 'Test', shortName: 'Test', tags: [], color: '#888' };
    mockDataLayer({
      getSections: () => [sec],
      getGroupedSections: () => ({ groups: [], ungrouped: [] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Test');
    expect(html).not.toContain('m-group-header');
  });
});

/* ── Growth sparklines ──────────────────────────────────────── */
describe('Growth sparklines', () => {
  it('renders sparkline in section card', () => {
    const sec = { id: 's1', name: 'Test', shortName: 'Test', tags: [], color: '#888' };
    mockDataLayer({
      getSections: () => [sec],
      getGroupedSections: () => ({ groups: [], ungrouped: [sec] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'up',
      getSectionGrowthData: () => [{ date: '2025-01-01', prof: 2 }, { date: '2025-02-01', prof: 3 }],
      renderGrowthSparkline: () => '<div class="growth-sparkline">mock-sparkline</div>',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('growth-sparkline');
    expect(html).toContain('mock-sparkline');
  });
});

/* ── Section card accessibility ─────────────────────────────── */
describe('Section card ARIA', () => {
  it('section cards have aria-expanded="false" by default', () => {
    const sec = { id: 's1', name: 'Test', shortName: 'Test', tags: [], color: '#888' };
    mockDataLayer({
      getSections: () => [sec],
      getGroupedSections: () => ({ groups: [], ungrouped: [sec] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });
});

/* ── Observation cards in detail (enriched) ─────────────────── */
describe('Observation cards in student detail', () => {
  it('shows context and dimension tags on observation cards', () => {
    mockDataLayer({
      getStudentQuickObs: () => [
        {
          id: 'ob1', text: 'Great participation', sentiment: 'strength',
          context: 'whole-class', dims: ['engagement'], created: '2025-03-14T10:00:00Z',
        },
      ],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('m-obs-context'); // context label present
    expect(html).toContain('m-obs-tags');     // tag chips present
  });
});

/* ── filterList ─────────────────────────────────────────────── */
describe('MStudents.filterList', () => {
  it('is a function', () => {
    expect(typeof MStudents.filterList).toBe('function');
  });
});

/* ── Edge cases: students with minimal data ─────────────────── */
describe('Student edge cases', () => {
  it('handles student with no pronouns', () => {
    mockDataLayer({
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'User', preferred: '', pronouns: '', designations: [] }],
    });
    const html = MStudents.renderList(CID);
    expect(html).toContain('Test User');
    expect(html).not.toContain('m-cell-subtitle'); // no subtitle without pronouns
  });

  it('handles student with no designations array', () => {
    mockDataLayer({
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'User', preferred: '', pronouns: '', designations: null }],
    });
    const html = MStudents.renderList(CID);
    expect(html).toContain('Test User');
    expect(html).not.toContain('m-badge');
  });

  it('handles student with empty designations array', () => {
    mockDataLayer({
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'User', preferred: '', pronouns: '', designations: [] }],
    });
    const html = MStudents.renderList(CID);
    expect(html).not.toContain('m-badge-iep');
  });

  it('uses preferred name over first name', () => {
    mockDataLayer({
      getStudents: () => [{ id: 'stu1', firstName: 'Alexander', lastName: 'Smith', preferred: 'Alex', pronouns: '', designations: [] }],
      displayName: (st) => (st.preferred || st.firstName) + ' ' + st.lastName,
    });
    const html = MStudents.renderList(CID);
    expect(html).toContain('Alex Smith');
  });

  it('handles student with multiple designations', () => {
    mockDataLayer({
      getStudents: () => [{ id: 'stu1', firstName: 'Test', lastName: 'User', preferred: '', pronouns: '', designations: ['G', 'K'] }],
    });
    const html = MStudents.renderList(CID);
    // G has iep:true, K has iep:true AND modified:true
    expect(html).toContain('m-badge-iep');
    expect(html).toContain('m-badge-mod');
  });
});

/* ── Detail screen: multiple sections ───────────────────────── */
describe('Student detail with multiple sections', () => {
  it('renders multiple section cards', () => {
    const sections = [
      { id: 's1', name: 'Questioning', shortName: 'Quest', tags: [], color: '#2196F3' },
      { id: 's2', name: 'Planning', shortName: 'Plan', tags: [], color: '#4CAF50' },
      { id: 's3', name: 'Processing', shortName: 'Process', tags: [], color: '#FF9800' },
    ];
    mockDataLayer({
      getSections: () => sections,
      getGroupedSections: () => ({ groups: [], ungrouped: sections }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('Quest');
    expect(html).toContain('Plan');
    expect(html).toContain('Process');
    // Count section cards
    const count = (html.match(/m-section-card/g) || []).length;
    expect(count).toBe(3);
  });

  it('shows different proficiency values per section', () => {
    const sections = [
      { id: 's1', name: 'Sec A', shortName: 'A', tags: [], color: '#888' },
      { id: 's2', name: 'Sec B', shortName: 'B', tags: [], color: '#888' },
    ];
    mockDataLayer({
      getSections: () => sections,
      getGroupedSections: () => ({ groups: [], ungrouped: sections }),
      getSectionProficiency: (cid, sid, secId) => secId === 's1' ? 4.0 : 1.5,
      getSectionTrend: () => 'flat',
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('4.0');
    expect(html).toContain('1.5');
  });

  it('shows tags within expanded section', () => {
    const sec = {
      id: 's1', name: 'Test', shortName: 'Test', color: '#888',
      tags: [
        { id: 't1', label: 'Tag Alpha' },
        { id: 't2', label: 'Tag Beta' },
      ],
    };
    mockDataLayer({
      getSections: () => [sec],
      getGroupedSections: () => ({ groups: [], ungrouped: [sec] }),
      getSectionProficiency: () => 3.0,
      getSectionTrend: () => 'flat',
      getTagScores: () => [],
      getTagProficiency: () => 0,
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    // Section detail now shows timeline (not per-tag rows) — with no scores, shows empty state
    expect(html).toContain('m-sec-empty');
    expect(html).toContain('No summative scores yet');
  });
});

/* ── Detail screen: recent assessments ──────────────────────── */
describe('Student detail recent assessments', () => {
  it('shows last 5 assessments sorted by date', () => {
    mockDataLayer({
      getAssessments: () => [
        { id: 'a1', title: 'Assess 1', type: 'summative', date: '2025-01-01', tagIds: [] },
        { id: 'a2', title: 'Assess 2', type: 'formative', date: '2025-02-01', tagIds: [] },
        { id: 'a3', title: 'Assess 3', type: 'summative', date: '2025-03-01', tagIds: [] },
        { id: 'a4', title: 'Assess 4', type: 'formative', date: '2025-03-10', tagIds: [] },
        { id: 'a5', title: 'Assess 5', type: 'summative', date: '2025-03-15', tagIds: [] },
        { id: 'a6', title: 'Assess 6', type: 'summative', date: '2025-03-20', tagIds: [] },
      ],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    // Should show 5 most recent, not all 6
    expect(html).toContain('Assess 6');
    expect(html).toContain('Assess 5');
    expect(html).not.toContain('Assess 1'); // oldest should be cut
  });

  it('shows NS status badge on assessments', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-01', tagIds: [] }],
      getAssignmentStatuses: () => ({ 'stu1:a1': 'NS' }),
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('>NS<');
  });

  it('shows EXC status badge on excused assessments', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-01', tagIds: [] }],
      getAssignmentStatuses: () => ({ 'stu1:a1': 'EXC' }),
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('>EXC<');
  });

  it('shows empty state when no assessments', () => {
    mockDataLayer({
      getAssessments: () => [],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('No assessments yet');
  });

  it('shows empty state when no observations', () => {
    mockDataLayer({
      getStudentQuickObs: () => [],
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('No observations yet');
  });
});

/* ── Detail screen: score chips on assessments ──────────────── */
describe('Assessment score chips', () => {
  it('shows per-tag score chips on assessments', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-01', tagIds: ['t1'] }],
      getScores: () => ({
        stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3.5, type: 'summative', date: '2025-03-01' }],
      }),
      getTagById: (cid, tid) => ({ id: tid, label: 'Questioning', shortName: 'Quest' }),
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('m-assess-score-chip');
    expect(html).toContain('3.5');
  });

  it('shows dash for unscored tags', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-01', tagIds: ['t1'] }],
      getScores: () => ({ stu1: [] }),
      getTagById: () => ({ id: 't1', label: 'Test' }),
    });
    const html = MStudents.renderDetail(CID, 'stu1');
    expect(html).toContain('—');
  });
});
