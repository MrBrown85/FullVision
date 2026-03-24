/**
 * Learning map accessor tests — gb-data.js
 */

const CID = 'test';

const MOCK_MAP = {
  subjects: [{ id: 'SCI8', name: 'Science 8' }],
  sections: [
    {
      id: 'sec1', name: 'Questioning', tags: [
        { id: 't1', label: 'Question and Predict' },
        { id: 't2', label: 'Plan Investigations' },
      ],
    },
    {
      id: 'sec2', name: 'Processing', tags: [
        { id: 't3', label: 'Identify Patterns' },
      ],
    },
  ],
};

beforeEach(() => {
  _cache.learningMaps[CID] = MOCK_MAP;
});

describe('getSections', () => {
  it('returns sections from learning map', () => {
    const sections = getSections(CID);
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe('Questioning');
  });

  it('returns empty array if no sections', () => {
    _cache.learningMaps[CID] = { subjects: [] };
    expect(getSections(CID)).toEqual([]);
  });
});

describe('getSubjects', () => {
  it('returns subjects from learning map', () => {
    const subjects = getSubjects(CID);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].id).toBe('SCI8');
  });
});

describe('getAllTags', () => {
  it('flattens tags from all sections', () => {
    const tags = getAllTags(CID);
    expect(tags).toHaveLength(3);
    expect(tags.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('returns empty array when no sections', () => {
    _cache.learningMaps[CID] = { sections: [] };
    expect(getAllTags(CID)).toEqual([]);
  });
});

describe('getTagById', () => {
  it('finds tag by id', () => {
    const tag = getTagById(CID, 't2');
    expect(tag.label).toBe('Plan Investigations');
  });

  it('returns undefined for missing tag', () => {
    expect(getTagById(CID, 'nonexistent')).toBeUndefined();
  });
});

describe('getSectionForTag', () => {
  it('returns section containing the tag', () => {
    const section = getSectionForTag(CID, 't3');
    expect(section.id).toBe('sec2');
  });

  it('returns undefined for tag not in any section', () => {
    expect(getSectionForTag(CID, 'nonexistent')).toBeUndefined();
  });
});
