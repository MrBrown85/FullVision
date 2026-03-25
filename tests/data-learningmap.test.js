/**
 * Learning map accessor tests — gb-data.js
 * Uses flat format (1:1 section-to-tag, section.id = tag.id)
 */

const CID = 'test';

const MOCK_MAP = {
  _flatVersion: 2,
  subjects: [{ id: 'SCI8', name: 'Science 8' }],
  sections: [
    {
      id: 't1', name: 'Questioning', color: '#0891b2', subject: 'SCI8', shortName: 'Questioning',
      tags: [{ id: 't1', label: 'Question and Predict', color: '#0891b2', subject: 'SCI8', name: 'Questioning', shortName: 'Questioning' }],
    },
    {
      id: 't2', name: 'Planning', color: '#0891b2', subject: 'SCI8', shortName: 'Planning',
      tags: [{ id: 't2', label: 'Plan Investigations', color: '#0891b2', subject: 'SCI8', name: 'Planning', shortName: 'Planning' }],
    },
    {
      id: 't3', name: 'Processing', color: '#0891b2', subject: 'SCI8', shortName: 'Processing',
      tags: [{ id: 't3', label: 'Identify Patterns', color: '#0891b2', subject: 'SCI8', name: 'Processing', shortName: 'Processing' }],
    },
  ],
};

beforeEach(() => {
  _cache.learningMaps[CID] = MOCK_MAP;
});

describe('getSections', () => {
  it('returns sections from learning map', () => {
    const sections = getSections(CID);
    expect(sections).toHaveLength(3);
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
  it('returns section containing the tag (section.id = tag.id in flat format)', () => {
    const section = getSectionForTag(CID, 't3');
    expect(section.id).toBe('t3');
    expect(section.name).toBe('Processing');
  });

  it('returns undefined for tag not in any section', () => {
    expect(getSectionForTag(CID, 'nonexistent')).toBeUndefined();
  });
});
