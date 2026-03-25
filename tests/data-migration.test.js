/**
 * Learning map migration tests — flatten section/tag hierarchy
 */

const CID = 'migtest';

describe('migrateLearningMap', () => {
  it('promotes section properties onto tags and changes section ID to tag ID', () => {
    const oldMap = {
      subjects: [{ id: 'SCI8', name: 'Science 8' }],
      sections: [
        {
          id: 'SCI8_questioning', subject: 'SCI8', name: 'Questioning and Predicting',
          shortName: 'Questioning', color: '#0891b2',
          tags: [{ id: 'QAP', label: 'Question and Predict', text: '' }]
        },
        {
          id: 'SCI8_evaluating', subject: 'SCI8', name: 'Evaluating',
          shortName: 'Evaluating', color: '#dc2626',
          tags: [{ id: 'EM', label: 'Evaluate Methods', text: '' }]
        }
      ]
    };

    const result = migrateLearningMap(oldMap);

    expect(result._flatVersion).toBe(2);
    // Section IDs become tag IDs
    expect(result.sections[0].id).toBe('QAP');
    expect(result.sections[1].id).toBe('EM');
    // Tags gain section properties
    expect(result.sections[0].tags[0].color).toBe('#0891b2');
    expect(result.sections[0].tags[0].subject).toBe('SCI8');
    expect(result.sections[0].tags[0].shortName).toBe('Questioning');
    expect(result.sections[0].tags[0].name).toBe('Questioning and Predicting');
    expect(result.sections[1].tags[0].color).toBe('#dc2626');
    // Legacy section ID is preserved for rollback
    expect(result.sections[0].tags[0]._legacySectionId).toBe('SCI8_questioning');
    expect(result.sections[1].tags[0]._legacySectionId).toBe('SCI8_evaluating');
    // sectionToTagMap is stored
    expect(result._sectionToTagMap).toEqual({
      'SCI8_questioning': 'QAP',
      'SCI8_evaluating': 'EM'
    });
  });

  it('is idempotent — already migrated maps are returned unchanged', () => {
    const alreadyFlat = {
      _flatVersion: 2,
      subjects: [{ id: 'SCI8', name: 'Science 8' }],
      sections: [
        { id: 'QAP', subject: 'SCI8', name: 'Questioning', color: '#0891b2',
          tags: [{ id: 'QAP', label: 'Question and Predict', color: '#0891b2' }] }
      ]
    };

    const result = migrateLearningMap(alreadyFlat);
    expect(result).toBe(alreadyFlat); // same reference — no mutation
    expect(result.sections[0].id).toBe('QAP');
  });

  it('handles null/undefined/empty maps gracefully', () => {
    expect(migrateLearningMap(null)).toBeNull();
    expect(migrateLearningMap(undefined)).toBeUndefined();
    expect(migrateLearningMap({ sections: [] })._flatVersion).toBe(2);
  });

  it('handles sections with no tags', () => {
    const map = {
      sections: [
        { id: 'empty', name: 'Empty Section', tags: [] },
        { id: 'sec2', name: 'Has Tag', color: '#ff0000', tags: [{ id: 'T1', label: 'Tag 1' }] }
      ]
    };
    const result = migrateLearningMap(map);
    expect(result.sections[0].id).toBe('empty'); // unchanged — no tag to adopt
    expect(result.sections[1].id).toBe('T1');
  });

  it('preserves tag IDs exactly — scores remain valid', () => {
    const map = {
      sections: [
        { id: 'OLD_SEC', tags: [{ id: 'QAP', label: 'Q&P' }] },
        { id: 'OLD_SEC2', tags: [{ id: 'PI', label: 'Plan' }] }
      ]
    };
    migrateLearningMap(map);
    // Tag IDs never change
    expect(map.sections[0].tags[0].id).toBe('QAP');
    expect(map.sections[1].tags[0].id).toBe('PI');
  });
});

describe('migrateOverridesForFlatMap', () => {
  beforeEach(() => {
    _cache.overrides[CID] = {
      'stu1': {
        'SCI8_questioning': { level: 3, reason: 'Good progress' },
        'SCI8_evaluating': { level: 2, reason: 'Needs work' }
      },
      'stu2': {
        'SCI8_questioning': { level: 4, reason: 'Excellent' }
      }
    };
  });

  it('re-keys overrides from old section IDs to tag IDs', () => {
    const sectionToTag = {
      'SCI8_questioning': 'QAP',
      'SCI8_evaluating': 'EM'
    };

    migrateOverridesForFlatMap(CID, sectionToTag);

    const overrides = _cache.overrides[CID];
    expect(overrides['stu1']['QAP']).toEqual({ level: 3, reason: 'Good progress' });
    expect(overrides['stu1']['EM']).toEqual({ level: 2, reason: 'Needs work' });
    expect(overrides['stu1']['SCI8_questioning']).toBeUndefined();
    expect(overrides['stu2']['QAP']).toEqual({ level: 4, reason: 'Excellent' });
  });

  it('does nothing with empty sectionToTag map', () => {
    const before = JSON.stringify(_cache.overrides[CID]);
    migrateOverridesForFlatMap(CID, {});
    expect(JSON.stringify(_cache.overrides[CID])).toBe(before);
  });

  it('does nothing when overrides already use tag IDs', () => {
    _cache.overrides[CID] = {
      'stu1': { 'QAP': { level: 3, reason: 'test' } }
    };
    const sectionToTag = { 'SCI8_questioning': 'QAP' };
    migrateOverridesForFlatMap(CID, sectionToTag);
    expect(_cache.overrides[CID]['stu1']['QAP']).toEqual({ level: 3, reason: 'test' });
  });
});

describe('migrateGoalsForFlatMap', () => {
  it('re-keys goals from old section IDs to tag IDs', () => {
    _cache.goals[CID] = {
      'stu1': { 'SCI8_questioning': 'Improve questioning skills' }
    };
    migrateGoalsForFlatMap(CID, { 'SCI8_questioning': 'QAP' });
    expect(_cache.goals[CID]['stu1']['QAP']).toBe('Improve questioning skills');
    expect(_cache.goals[CID]['stu1']['SCI8_questioning']).toBeUndefined();
  });
});

describe('migrateReflectionsForFlatMap', () => {
  it('re-keys reflections from old section IDs to tag IDs', () => {
    _cache.reflections[CID] = {
      'stu1': { 'SCI8_evaluating': { confidence: 3, text: 'Getting better', date: '2025-01-01' } }
    };
    migrateReflectionsForFlatMap(CID, { 'SCI8_evaluating': 'EM' });
    expect(_cache.reflections[CID]['stu1']['EM'].confidence).toBe(3);
    expect(_cache.reflections[CID]['stu1']['SCI8_evaluating']).toBeUndefined();
  });
});
