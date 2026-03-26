/**
 * Rubric data layer tests — gb-data.js
 * Tests getRubrics, saveRubrics, getRubricById, and rubric structure persistence.
 */

const CID = 'test';

beforeEach(() => {
  _cache.rubrics[CID] = undefined;
  _cache.rubrics['other'] = undefined;
  localStorage.clear();
});

describe('getRubrics', () => {
  it('returns empty array when none saved', () => {
    expect(getRubrics(CID)).toEqual([]);
  });
});

describe('saveRubrics / getRubrics roundtrip', () => {
  it('persists and retrieves rubrics', () => {
    const rubrics = [
      { id: 'r1', title: 'Writing Rubric' },
      { id: 'r2', title: 'Lab Rubric' },
    ];
    saveRubrics(CID, rubrics);
    const result = getRubrics(CID);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Writing Rubric');
    expect(result[1].title).toBe('Lab Rubric');
  });
});

describe('getRubricById', () => {
  it('returns the correct rubric', () => {
    saveRubrics(CID, [
      { id: 'r1', title: 'Rubric A' },
      { id: 'r2', title: 'Rubric B' },
    ]);
    const rubric = getRubricById(CID, 'r2');
    expect(rubric).toBeDefined();
    expect(rubric.title).toBe('Rubric B');
  });

  it('returns undefined for nonexistent ID', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Rubric A' }]);
    expect(getRubricById(CID, 'nonexistent')).toBeUndefined();
  });
});

describe('rubric with criteria array', () => {
  it('saves and loads criteria structure correctly', () => {
    const rubric = {
      id: 'r1',
      title: 'Detailed Rubric',
      criteria: [
        { id: 'c1', label: 'Content', weight: 2 },
        { id: 'c2', label: 'Organization', weight: 1 },
      ],
    };
    saveRubrics(CID, [rubric]);
    const loaded = getRubricById(CID, 'r1');
    expect(loaded.criteria).toHaveLength(2);
    expect(loaded.criteria[0].label).toBe('Content');
    expect(loaded.criteria[1].weight).toBe(1);
  });
});

describe('rubric criteria with levels', () => {
  it('saves and loads levels object within criteria', () => {
    const rubric = {
      id: 'r1',
      title: 'Leveled Rubric',
      criteria: [
        {
          id: 'c1',
          label: 'Analysis',
          levels: {
            1: 'Beginning',
            2: 'Developing',
            3: 'Proficient',
            4: 'Extending',
          },
        },
      ],
    };
    saveRubrics(CID, [rubric]);
    const loaded = getRubricById(CID, 'r1');
    expect(loaded.criteria[0].levels['3']).toBe('Proficient');
    expect(loaded.criteria[0].levels['4']).toBe('Extending');
  });
});

describe('multiple rubrics coexist', () => {
  it('all rubrics are retrievable', () => {
    saveRubrics(CID, [
      { id: 'r1', title: 'First' },
      { id: 'r2', title: 'Second' },
      { id: 'r3', title: 'Third' },
    ]);
    expect(getRubrics(CID)).toHaveLength(3);
    expect(getRubricById(CID, 'r1').title).toBe('First');
    expect(getRubricById(CID, 'r3').title).toBe('Third');
  });
});

describe('rubric with tagIds in criteria', () => {
  it('saves tagIds within criteria correctly', () => {
    const rubric = {
      id: 'r1',
      title: 'Tagged Rubric',
      criteria: [
        { id: 'c1', label: 'Research', tagIds: ['t1', 't2'] },
        { id: 'c2', label: 'Presentation', tagIds: ['t3'] },
      ],
    };
    saveRubrics(CID, [rubric]);
    const loaded = getRubricById(CID, 'r1');
    expect(loaded.criteria[0].tagIds).toEqual(['t1', 't2']);
    expect(loaded.criteria[1].tagIds).toEqual(['t3']);
  });
});

describe('saveRubrics overwrites previous', () => {
  it('replaces all rubrics with new set', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Old' }]);
    saveRubrics(CID, [{ id: 'r2', title: 'New' }]);
    const rubrics = getRubrics(CID);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0].id).toBe('r2');
    expect(rubrics[0].title).toBe('New');
  });
});

describe('rubric course isolation', () => {
  it('getRubrics from different course returns different rubrics', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Test Rubric' }]);
    saveRubrics('other', [{ id: 'r2', title: 'Other Rubric' }]);
    expect(getRubrics(CID)).toHaveLength(1);
    expect(getRubrics(CID)[0].title).toBe('Test Rubric');
    expect(getRubrics('other')).toHaveLength(1);
    expect(getRubrics('other')[0].title).toBe('Other Rubric');
  });
});
