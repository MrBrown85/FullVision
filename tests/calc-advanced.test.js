/**
 * Advanced calculation tests — trend, evidence count, focus areas, completion, growth.
 * These are data-dependent functions that need mocked gb-data layer.
 */

const originals = {};

function mockDataLayer(overrides) {
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

/* ── getSectionTrend ──────────────────────────────────────── */
describe('getSectionTrend', () => {
  it('returns up when most recent score is higher', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
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
    });
    expect(getSectionTrend('test', 'stu1', 'sec1')).toBe('up');
  });

  it('returns down when most recent score is lower', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
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
    });
    expect(getSectionTrend('test', 'stu1', 'sec1')).toBe('down');
  });

  it('returns flat when scores are equal', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 3, tagId: 't1', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
    });
    expect(getSectionTrend('test', 'stu1', 'sec1')).toBe('flat');
  });

  it('returns flat with fewer than 2 scores', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({
        stu1: [{ score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' }],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
    });
    expect(getSectionTrend('test', 'stu1', 'sec1')).toBe('flat');
  });

  it('returns flat for unknown section', () => {
    mockDataLayer({ getSections: () => [] });
    expect(getSectionTrend('test', 'stu1', 'nonexistent')).toBe('flat');
  });

  it('aggregates scores across multiple tags in a section', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }] }],
      getScores: () => ({
        stu1: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 4, tagId: 't2', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
    });
    // Most recent across both tags: t2 score 4 (Feb) vs t1 score 2 (Jan) → up
    expect(getSectionTrend('test', 'stu1', 'sec1')).toBe('up');
  });
});

/* ── getSectionEvidenceCount ──────────────────────────────── */
describe('getSectionEvidenceCount', () => {
  it('counts scored evidence across all tags', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }] }],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't1', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
          { score: 4, tagId: 't2', assessmentId: 'a3', date: '2025-01-01', type: 'summative' },
          { score: 1, tagId: 't1', assessmentId: 'a4', date: '2025-03-01', type: 'formative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
        { id: 'a3', type: 'summative', weight: 1 },
        { id: 'a4', type: 'formative', weight: 1 },
      ],
    });
    expect(getSectionEvidenceCount('test', 'stu1', 'sec1')).toBe(4);
  });

  it('returns 0 for unknown section', () => {
    mockDataLayer({ getSections: () => [] });
    expect(getSectionEvidenceCount('test', 'stu1', 'nonexistent')).toBe(0);
  });

  it('returns 0 when no scores exist', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({}),
      getAssessments: () => [],
    });
    expect(getSectionEvidenceCount('test', 'stu1', 'sec1')).toBe(0);
  });
});

/* ── getFocusAreas ────────────────────────────────────────── */
describe('getFocusAreas', () => {
  // Step 4 group 3 #42: competencies nobody has assessed are left out.
  it('leaves out competencies with no evidence', () => {
    mockDataLayer({
      getSections: () => [
        {
          id: 'sec1',
          tags: [
            { id: 't1', label: 'Tag1' },
            { id: 't2', label: 'Tag2' },
          ],
        },
      ],
      getAllTags: () => [
        { id: 't1', label: 'Tag1' },
        { id: 't2', label: 'Tag2' },
      ],
      getSectionForTag: (cid, tagId) => ({ id: 'sec1' }),
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          // t2 has no scores
        ],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    const result = getFocusAreas('test', 'stu1', 3);
    expect(result.map(r => r.tag.id)).toEqual(['t1']);
  });

  it('sorts by lowest proficiency after no-evidence tags', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }],
      getAllTags: () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      getSectionForTag: () => ({ id: 'sec1' }),
      getScores: () => ({
        stu1: [
          { score: 4, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 1, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
          { score: 3, tagId: 't3', assessmentId: 'a3', date: '2025-01-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
        { id: 'a3', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    const result = getFocusAreas('test', 'stu1', 3);
    expect(result[0].tag.id).toBe('t2'); // prof 1 (lowest)
    expect(result[1].tag.id).toBe('t3'); // prof 3
    expect(result[2].tag.id).toBe('t1'); // prof 4
  });

  it('defaults to 3 items', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }] }],
      getAllTags: () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }],
      getSectionForTag: () => ({ id: 'sec1' }),
      getScores: () => ({
        stu1: ['t1', 't2', 't3', 't4'].map((t, i) => ({
          score: 2,
          tagId: t,
          assessmentId: 'a' + i,
          date: '2025-01-01',
          type: 'summative',
        })),
      }),
      getAssessments: () => [0, 1, 2, 3].map(i => ({ id: 'a' + i, type: 'summative', weight: 1 })),
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    expect(getFocusAreas('test', 'stu1')).toHaveLength(3);
  });

  it('respects maxItems parameter', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }],
      getAllTags: () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      getSectionForTag: () => ({ id: 'sec1' }),
      getScores: () => ({
        stu1: ['t1', 't2'].map((t, i) => ({
          score: 2,
          tagId: t,
          assessmentId: 'a' + i,
          date: '2025-01-01',
          type: 'summative',
        })),
      }),
      getAssessments: () => [0, 1].map(i => ({ id: 'a' + i, type: 'summative', weight: 1 })),
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    expect(getFocusAreas('test', 'stu1', 1)).toHaveLength(1);
  });
});

/* ── getCompletionPct ─────────────────────────────────────── */
describe('getCompletionPct', () => {
  it('returns percentage of tags with scored evidence', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }] }],
      getAllTags: () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }],
      getScores: () => ({
        stu1: [
          { score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 2, tagId: 't2', assessmentId: 'a2', date: '2025-01-01', type: 'summative' },
          // t3, t4 have no scores
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
      ],
    });
    expect(getCompletionPct('test', 'stu1')).toBe(50); // 2 of 4 tags
  });

  it('returns 100 when all tags have evidence', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getAllTags: () => [{ id: 't1' }],
      getScores: () => ({
        stu1: [{ score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' }],
      }),
      getAssessments: () => [{ id: 'a1', type: 'summative', weight: 1 }],
    });
    expect(getCompletionPct('test', 'stu1')).toBe(100);
  });

  it('returns 0 when no tags have evidence', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }, { id: 't2' }] }],
      getAllTags: () => [{ id: 't1' }, { id: 't2' }],
      getScores: () => ({}),
      getAssessments: () => [],
    });
    expect(getCompletionPct('test', 'stu1')).toBe(0);
  });

  it('returns 0 when no tags exist', () => {
    mockDataLayer({
      getSections: () => [],
      getAllTags: () => [],
    });
    expect(getCompletionPct('test', 'stu1')).toBe(0);
  });

  it('counts uncategorized or formative-only evidence when it is scored', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getAllTags: () => [{ id: 't1' }],
      getScores: () => ({
        stu1: [{ score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'formative' }],
      }),
      getAssessments: () => [{ id: 'a1', type: 'formative', weight: 1 }],
    });
    expect(getCompletionPct('test', 'stu1')).toBe(100);
  });
});

/* ── getSectionGrowthData ─────────────────────────────────── */
describe('getSectionGrowthData', () => {
  it('returns chronological proficiency snapshots', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({
        stu1: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'summative' },
          { score: 3, tagId: 't1', assessmentId: 'a2', date: '2025-02-01', type: 'summative' },
          { score: 4, tagId: 't1', assessmentId: 'a3', date: '2025-03-01', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', weight: 1 },
        { id: 'a2', type: 'summative', weight: 1 },
        { id: 'a3', type: 'summative', weight: 1 },
      ],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    const points = getSectionGrowthData('test', 'stu1', 'sec1');
    expect(points).toHaveLength(3);
    expect(points[0].date).toBe('2025-01-01');
    expect(points[0].prof).toBe(2); // only first score
    expect(points[2].date).toBe('2025-03-01');
    expect(points[2].prof).toBe(4); // mostRecent of all 3
  });

  it('returns empty array for unknown section', () => {
    mockDataLayer({ getSections: () => [] });
    expect(getSectionGrowthData('test', 'stu1', 'nonexistent')).toEqual([]);
  });

  it('returns empty array when no scores', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({}),
      getAssessments: () => [],
    });
    expect(getSectionGrowthData('test', 'stu1', 'sec1')).toEqual([]);
  });

  it('includes scored evidence even when it comes from uncategorized or formative compatibility data', () => {
    mockDataLayer({
      getSections: () => [{ id: 'sec1', tags: [{ id: 't1' }] }],
      getScores: () => ({
        stu1: [{ score: 3, tagId: 't1', assessmentId: 'a1', date: '2025-01-01', type: 'formative' }],
      }),
      getAssessments: () => [{ id: 'a1', type: 'formative', weight: 1 }],
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
    });
    expect(getSectionGrowthData('test', 'stu1', 'sec1')).toEqual([{ date: '2025-01-01', prof: 3 }]);
  });
});
