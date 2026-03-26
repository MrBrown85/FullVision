/**
 * Competency group data layer tests — gb-data.js
 * Tests getCompetencyGroups, saveCompetencyGroups, getCompetencyGroupById,
 * and course isolation.
 */

const CID = 'test';

const MOCK_MAP = {
  _flatVersion: 2,
  _customized: true,
  subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
  sections: [
    {
      id: 't1', name: 'Questioning', color: '#0891b2', subject: 'SCI8', shortName: 'Questioning',
      tags: [{ id: 't1', label: 'Question and Predict', color: '#0891b2', subject: 'SCI8', name: 'Questioning', shortName: 'Questioning' }],
    },
  ],
};

beforeEach(() => {
  _cache.learningMaps[CID] = structuredClone(MOCK_MAP);
  _cache.learningMaps['other'] = undefined;
  _cache.courseConfigs[CID] = undefined;
  localStorage.clear();
});

describe('getCompetencyGroups', () => {
  it('returns empty array when none saved', () => {
    expect(getCompetencyGroups(CID)).toEqual([]);
  });
});

describe('saveCompetencyGroups / getCompetencyGroups roundtrip', () => {
  it('persists and retrieves competency groups', () => {
    const groups = [
      { id: 'g1', name: 'Science Skills', sortOrder: 0 },
      { id: 'g2', name: 'Math Skills', sortOrder: 1 },
    ];
    saveCompetencyGroups(CID, groups);
    const result = getCompetencyGroups(CID);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Science Skills');
    expect(result[1].name).toBe('Math Skills');
  });
});

describe('getCompetencyGroupById', () => {
  it('returns the correct group', () => {
    saveCompetencyGroups(CID, [
      { id: 'g1', name: 'Group A' },
      { id: 'g2', name: 'Group B' },
    ]);
    const group = getCompetencyGroupById(CID, 'g2');
    expect(group).toBeDefined();
    expect(group.name).toBe('Group B');
  });

  it('returns undefined for nonexistent ID', () => {
    saveCompetencyGroups(CID, [{ id: 'g1', name: 'Group A' }]);
    expect(getCompetencyGroupById(CID, 'nonexistent')).toBeUndefined();
  });
});

describe('multiple groups coexist', () => {
  it('all groups are retrievable', () => {
    const groups = [
      { id: 'g1', name: 'First', sortOrder: 0 },
      { id: 'g2', name: 'Second', sortOrder: 1 },
      { id: 'g3', name: 'Third', sortOrder: 2 },
    ];
    saveCompetencyGroups(CID, groups);
    expect(getCompetencyGroups(CID)).toHaveLength(3);
    expect(getCompetencyGroupById(CID, 'g1').name).toBe('First');
    expect(getCompetencyGroupById(CID, 'g3').name).toBe('Third');
  });
});

describe('group with sections array', () => {
  it('saves group containing section references correctly', () => {
    const groups = [
      { id: 'g1', name: 'Inquiry', sortOrder: 0, color: '#10b981', sectionIds: ['t1', 't2'] },
    ];
    saveCompetencyGroups(CID, groups);
    const loaded = getCompetencyGroupById(CID, 'g1');
    expect(loaded.sectionIds).toEqual(['t1', 't2']);
    expect(loaded.color).toBe('#10b981');
  });
});

describe('saveCompetencyGroups overwrites previous', () => {
  it('replaces all groups with new set', () => {
    saveCompetencyGroups(CID, [{ id: 'g1', name: 'Old Group' }]);
    saveCompetencyGroups(CID, [{ id: 'g2', name: 'New Group' }]);
    const groups = getCompetencyGroups(CID);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('g2');
    expect(groups[0].name).toBe('New Group');
  });
});

describe('competency groups course isolation', () => {
  it('groups from different course are isolated', () => {
    // Set up other course's learning map
    _cache.learningMaps['other'] = {
      _flatVersion: 2,
      _customized: true,
      subjects: [{ id: 'MATH', name: 'Math', color: '#6366f1' }],
      sections: [],
    };

    saveCompetencyGroups(CID, [{ id: 'g1', name: 'Science Groups' }]);
    saveCompetencyGroups('other', [{ id: 'g2', name: 'Math Groups' }]);

    expect(getCompetencyGroups(CID)).toHaveLength(1);
    expect(getCompetencyGroups(CID)[0].name).toBe('Science Groups');
    expect(getCompetencyGroups('other')).toHaveLength(1);
    expect(getCompetencyGroups('other')[0].name).toBe('Math Groups');
  });
});
