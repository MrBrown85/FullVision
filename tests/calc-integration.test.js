/**
 * Integration tests — data-dependent calculation functions.
 * These mock the gb-data layer to control what data the calc functions see.
 */

// Save original functions so we can restore them
const originals = {};

function mockDataLayer(overrides) {
  // Default mocks that return empty data
  const defaults = {
    getScores: () => ({}),
    getAssessments: () => [],
    getAssignmentStatuses: () => ({}),
    getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    getSections: () => [],
    getOverrides: () => ({}),
    getAllTags: () => [],
    getSectionForTag: () => null,
    getGradingScale: () => DEFAULT_GRADING_SCALE,
  };

  const mocks = { ...defaults, ...overrides };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

function restoreDataLayer() {
  Object.keys(originals).forEach(fn => {
    if (originals[fn]) globalThis[fn] = originals[fn];
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

/* ── getTagScores ─────────────────────────────────────────── */
describe('getTagScores', () => {
  it('filters scores by tag', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative' },
        { id: 'a2', type: 'summative' },
      ],
    });

    const result = getTagScores('test', 'stu1', 't1');
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(3);
  });

  it('excludes excused assessments', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssignmentStatuses: () => ({ 'stu1:a1': 'excused' }),
      getAssessments: () => [{ id: 'a1', type: 'summative' }],
    });

    const result = getTagScores('test', 'stu1', 't1');
    expect(result).toHaveLength(0);
  });

  it('converts points-mode scores to proficiency', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [
          { score: 90, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', scoreMode: 'points', maxPoints: 100 },
      ],
    });

    const result = getTagScores('test', 'stu1', 't1');
    expect(result[0].score).toBe(4);       // 90% → proficiency 4
    expect(result[0].rawPoints).toBe(90);   // original preserved
  });

  it('returns empty array for nonexistent student', () => {
    mockDataLayer({});
    const result = getTagScores('test', 'nobody', 't1');
    expect(result).toEqual([]);
  });
});

/* ── getTagProficiency ────────────────────────────────────── */
describe('getTagProficiency', () => {
  it('calculates proficiency using mostRecent', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 4, tagId: 't1', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });

    expect(getTagProficiency('test', 'stu1', 't1')).toBe(4);
  });

  it('returns 0 for no scores', () => {
    mockDataLayer({});
    expect(getTagProficiency('test', 'stu1', 't1')).toBe(0);
  });

  it('uses highest method when configured', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't1', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'highest', decayWeight: 0.65 }),
    });

    expect(getTagProficiency('test', 'stu1', 't1')).toBe(4);
  });
});

/* ── getSectionProficiency ────────────────────────────────── */
describe('getSectionProficiency', () => {
  it('averages tag proficiencies', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }] },
      ],
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });

    expect(getSectionProficiency('test', 'stu1', 'sec1')).toBe(3); // (4+2)/2
  });

  it('uses teacher override when present', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }] },
      ],
      getScores: () => ({
        stu1: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getOverrides: () => ({ stu1: { sec1: { level: 4, reason: 'Growth shown in conference' } } }),
    });

    expect(getSectionProficiency('test', 'stu1', 'sec1')).toBe(4);
  });

  it('returns 0 for unknown section', () => {
    mockDataLayer({
      getSections: () => [],
    });
    expect(getSectionProficiency('test', 'stu1', 'nope')).toBe(0);
  });
});

/* ── getOverallProficiency ────────────────────────────────── */
describe('getOverallProficiency', () => {
  it('averages non-zero section proficiencies', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }] },
        { id: 'sec2', tags: [{ id: 't2' }] },
        { id: 'sec3', tags: [{ id: 't3' }] },
      ],
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
          // t3 has no scores → section prof = 0 → excluded from average
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });

    // (4 + 2) / 2 = 3 — sec3 excluded because no evidence
    expect(getOverallProficiency('test', 'stu1')).toBe(3);
  });

  it('returns 0 when no sections have evidence', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({}),
      getAssessments: () => [],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });

    expect(getOverallProficiency('test', 'stu1')).toBe(0);
  });
});

/* ── getGroupProficiency ──────────────────────────────────── */
describe('getGroupProficiency', () => {
  it('averages section proficiencies within a group', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 4, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'Group 1', color: '#6366f1', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
          { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    // (3 + 4) / 2 = 3.5
    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(3.5);
  });

  it('returns 0 when group sections have no evidence', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
      ],
      getScores: () => ({}),
      getAssessments: () => [],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'Group 1', color: '#6366f1', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(0);
  });

  it('returns 0 for non-existent group', () => {
    mockDataLayer({
      getGroupedSections: () => ({ groups: [], ungrouped: [] }),
    });

    expect(getGroupProficiency('test', 'stu1', 'nonexistent')).toBe(0);
  });
});

/* ── getOverallProficiency (group-aware) ──────────────────── */
describe('getOverallProficiency (with groups)', () => {
  it('uses group averages + ungrouped sections', () => {
    // Group 1: sec1(3.0) + sec2(4.0) → avg 3.5
    // Group 2: sec3(2.0) + sec4(3.0) → avg 2.5
    // Ungrouped: sec5(4.0)
    // Overall: (3.5 + 2.5 + 4.0) / 3 = 10/3 ≈ 3.333
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
        { id: 'sec3', tags: [{ id: 't3' }], groupId: 'g2' },
        { id: 'sec4', tags: [{ id: 't4' }], groupId: 'g2' },
        { id: 'sec5', tags: [{ id: 't5' }] },
      ],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 4, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't3', assessmentId: 'a3', date: '2025-01-01', type: 'summative' },
          { score: 3, tagId: 't4', assessmentId: 'a4', date: '2025-01-01', type: 'summative' },
          { score: 4, tagId: 't5', assessmentId: 'a5', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
        { id: 'a3', type: 'summative', weight: 1 },
        { id: 'a4', type: 'summative', weight: 1 },
        { id: 'a5', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [
          { group: { id: 'g1', name: 'Group 1', color: '#6366f1', sortOrder: 0 }, sections: [
            { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
            { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
          ]},
          { group: { id: 'g2', name: 'Group 2', color: '#06b6d4', sortOrder: 1 }, sections: [
            { id: 'sec3', tags: [{ id: 't3' }], groupId: 'g2' },
            { id: 'sec4', tags: [{ id: 't4' }], groupId: 'g2' },
          ]},
        ],
        ungrouped: [{ id: 'sec5', tags: [{ id: 't5' }] }],
      }),
    });

    // (3.5 + 2.5 + 4.0) / 3 = 10/3
    const result = getOverallProficiency('test', 'stu1');
    expect(result).toBeCloseTo(10 / 3, 5);
  });

  it('falls back to flat averaging when no groups exist', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }] },
        { id: 'sec2', tags: [{ id: 't2' }] },
      ],
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({ groups: [], ungrouped: [
        { id: 'sec1', tags: [{ id: 't1' }] },
        { id: 'sec2', tags: [{ id: 't2' }] },
      ]}),
    });

    // (4 + 2) / 2 = 3 — same as original behavior
    expect(getOverallProficiency('test', 'stu1')).toBe(3);
  });

  it('skips empty groups in overall calculation', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [
          { group: { id: 'g1', name: 'Group 1', color: '#6366f1', sortOrder: 0 }, sections: [
            { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
          ]},
          { group: { id: 'g2', name: 'Empty Group', color: '#06b6d4', sortOrder: 1 }, sections: [] },
        ],
        ungrouped: [],
      }),
    });

    // Only g1 contributes: 4.0
    expect(getOverallProficiency('test', 'stu1')).toBe(4);
  });

  it('proves grouping changes the overall (core business rule)', () => {
    // Scenario: 4 sections, scores: 1, 1, 4, 4
    // Flat average: (1 + 1 + 4 + 4) / 4 = 2.5
    // Grouped: Group1(1,1)=1.0, Group2(4,4)=4.0 → (1 + 4) / 2 = 2.5
    // Now make it asymmetric: Group1 has 3 sections, Group2 has 1
    // Scores: 1, 1, 1, 4
    // Flat: (1+1+1+4)/4 = 1.75
    // Grouped: Group1(1,1,1)=1.0, Group2(4)=4.0 → (1+4)/2 = 2.5
    // DIFFERENT! This proves grouping matters.
    const sections = [
      { id: 's1', tags: [{ id: 't1' }], groupId: 'g1' },
      { id: 's2', tags: [{ id: 't2' }], groupId: 'g1' },
      { id: 's3', tags: [{ id: 't3' }], groupId: 'g1' },
      { id: 's4', tags: [{ id: 't4' }], groupId: 'g2' },
    ];
    const scores = {
      stu1: [
        { score: 1, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        { score: 1, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        { score: 1, tagId: 't3', assessmentId: 'a3', date: '2025-01-01', type: 'summative' },
        { score: 4, tagId: 't4', assessmentId: 'a4', date: '2025-01-01', type: 'summative' },
      ],
    };
    const assessments = [
      { id: 'a1', type: 'summative', weight: 1 },
      { id: 'a2', type: 'summative', weight: 1 },
      { id: 'a3', type: 'summative', weight: 1 },
      { id: 'a4', type: 'summative', weight: 1 },
    ];
    const cc = { calcMethod: 'mostRecent', decayWeight: 0.65 };

    // With groups → (1.0 + 4.0) / 2 = 2.5
    mockDataLayer({
      getSections: () => sections,
      getScores: () => scores,
      getAssessments: () => assessments,
      getCourseConfig: () => cc,
      getGroupedSections: () => ({
        groups: [
          { group: { id: 'g1', name: 'G1', color: '#000', sortOrder: 0 }, sections: sections.slice(0, 3) },
          { group: { id: 'g2', name: 'G2', color: '#000', sortOrder: 1 }, sections: [sections[3]] },
        ],
        ungrouped: [],
      }),
    });
    expect(getOverallProficiency('test', 'stu1')).toBe(2.5);

    // Without groups → (1+1+1+4)/4 = 1.75
    clearProfCache();
    restoreDataLayer();
    mockDataLayer({
      getSections: () => sections,
      getScores: () => scores,
      getAssessments: () => assessments,
      getCourseConfig: () => cc,
      getGroupedSections: () => ({ groups: [], ungrouped: sections }),
    });
    expect(getOverallProficiency('test', 'stu1')).toBe(1.75);
  });
});

/* ── getGroupProficiency — edge cases ─────────────────────── */
describe('getGroupProficiency (edge cases)', () => {
  it('excludes sections with no evidence from group average', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          // t2 has no scores → sec2 prof = 0 → excluded
        ],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'G1', color: '#000', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
          { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    // Only sec1 has evidence → group avg = 3.0, not 1.5
    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(3);
  });

  it('respects teacher overrides in group average', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getOverrides: () => ({ stu1: { sec1: { level: 4, reason: 'Conference' } } }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'G1', color: '#000', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
          { id: 'sec2', tags: [{ id: 't2' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    // sec1 override=4, sec2 calculated=2 → (4+2)/2 = 3
    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(3);
  });

  it('handles single-section groups', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'G1', color: '#000', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    // Single section → group avg = section prof
    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(3);
  });

  it('handles multi-tag sections in groups', () => {
    mockDataLayer({
      getSections: () => [
        { id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }], groupId: 'g1' },
      ],
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getGroupedSections: () => ({
        groups: [{ group: { id: 'g1', name: 'G1', color: '#000', sortOrder: 0 }, sections: [
          { id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }], groupId: 'g1' },
        ]}],
        ungrouped: [],
      }),
    });

    // sec1 has 2 tags: t1=4, t2=2 → section avg=3 → group avg=3
    expect(getGroupProficiency('test', 'stu1', 'g1')).toBe(3);
  });
});
