/**
 * Rubric data layer tests — shared/data.js
 *
 * Local-cache CRUD only. Canonical-id patching + remote dispatch is in
 * data-rubrics-v2-sync.test.js. v2 create/update/delete dispatch is in
 * data-learning-map-v2-dispatch.test.js.
 */

const CID = 'test';

beforeEach(() => {
  _cache.rubrics[CID] = undefined;
  _cache.rubrics['other'] = undefined;
  localStorage.clear();
});

describe('rubric CRUD', () => {
  it('getRubrics returns empty array when none saved', () => {
    expect(getRubrics(CID)).toEqual([]);
  });

  it('saveRubrics + getRubrics roundtrips full rubric shape (criteria, levels, tagIds)', () => {
    const rubric = {
      id: 'r1',
      title: 'Detailed Rubric',
      criteria: [
        {
          id: 'c1',
          label: 'Content',
          weight: 2,
          tagIds: ['t1', 't2'],
          levels: { 1: 'Beginning', 2: 'Developing', 3: 'Proficient', 4: 'Extending' },
        },
        { id: 'c2', label: 'Organization', weight: 1, tagIds: ['t3'] },
      ],
    };
    saveRubrics(CID, [rubric]);
    const loaded = getRubricById(CID, 'r1');
    expect(loaded.title).toBe('Detailed Rubric');
    expect(loaded.criteria).toHaveLength(2);
    expect(loaded.criteria[0].weight).toBe(2);
    expect(loaded.criteria[0].tagIds).toEqual(['t1', 't2']);
    expect(loaded.criteria[0].levels['3']).toBe('Proficient');
  });

  it('getRubricById returns undefined for nonexistent ID', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Rubric A' }]);
    expect(getRubricById(CID, 'nonexistent')).toBeUndefined();
  });

  it('saveRubrics replaces the previous set (no merge)', () => {
    saveRubrics(CID, [
      { id: 'r1', title: 'Old' },
      { id: 'r2', title: 'Old2' },
    ]);
    saveRubrics(CID, [{ id: 'r3', title: 'New' }]);
    const rubrics = getRubrics(CID);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0].id).toBe('r3');
  });
});

describe('rubric course isolation', () => {
  it('getRubrics keys on course id — rubrics do not leak across courses', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Test Rubric' }]);
    saveRubrics('other', [{ id: 'r2', title: 'Other Rubric' }]);
    expect(getRubrics(CID)).toHaveLength(1);
    expect(getRubrics(CID)[0].title).toBe('Test Rubric');
    expect(getRubrics('other')[0].title).toBe('Other Rubric');
  });
});
