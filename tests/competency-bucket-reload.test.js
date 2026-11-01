/**
 * A competency level is the same before and after a reload (2026-11-01
 * math audit). Work outside a category counts toward a competency only when
 * it has no categorized evidence. That was read from the assessment's type,
 * but the server loads uncategorized work as formative while work just made
 * on this device was created summative, so in a class with no categories a
 * new quiz outweighed everything until the page was reloaded.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'bucket-reload';
const TERMS = [];

function seed(o) {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', gradeLevel: '8' };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sa', name: 'A', tags: [{ id: 't1' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = o.categories || [];
  _cache.assessments[CID] = o.assessments;
  _cache.scores[CID] = o.scores;
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = Object.assign({ reportingTerms: TERMS }, o.config);
  clearProfCache();
}

describe('a competency level is the same before and after a reload', () => {
  afterEach(() => delete COURSES[CID]);

  /* A class with no categories. Assessments loaded from the server have no
     category, so they load as formative; one the teacher has just made on
     this device was created summative. */
  it('counts work made on this device the way it will count once reloaded', () => {
    const loaded = id => ({ id, title: id, date: '2026-09-0' + id.slice(1), tagIds: ['t1'], type: 'formative' });
    const made = { id: 'a3', title: 'New Quiz', date: '2026-09-09', tagIds: ['t1'], type: 'summative' };
    const scores = {
      s1: [
        { assessmentId: 'a1', tagId: 't1', score: 2, date: '2026-09-01' },
        { assessmentId: 'a2', tagId: 't1', score: 2, date: '2026-09-02' },
        { assessmentId: 'a3', tagId: 't1', score: 4, date: '2026-09-09' },
      ],
    };
    seed({ assessments: [loaded('a1'), loaded('a2'), made], scores, config: { calcMethod: 'average' } });
    const onThisDevice = getTagProficiency(CID, 's1', 't1');
    seed({
      assessments: [loaded('a1'), loaded('a2'), { ...made, type: 'formative' }],
      scores,
      config: { calcMethod: 'average' },
    });
    const afterReload = getTagProficiency(CID, 's1', 't1');
    expect(afterReload).toBeCloseTo(8 / 3, 9);
    expect(onThisDevice).toBe(afterReload);
  });
});

describe('the growth line and the level read work the same way', () => {
  afterEach(() => delete COURSES[CID]);

  it('ends at the level when categorized work was scored as formative', () => {
    seed({
      categories: [{ id: 'k1', name: 'Labs', weight: 100 }],
      assessments: [
        { id: 'a1', title: 'Lab 1', date: '2026-09-01', tagIds: ['t1'], categoryId: 'k1', type: 'formative' },
        { id: 'a2', title: 'Lab 2', date: '2026-09-08', tagIds: ['t1'], categoryId: 'k1', type: 'summative' },
      ],
      scores: {
        s1: [
          { assessmentId: 'a1', tagId: 't1', score: 2, date: '2026-09-01', type: 'formative' },
          { assessmentId: 'a2', tagId: 't1', score: 4, date: '2026-09-08', type: 'summative' },
        ],
      },
      config: { calcMethod: 'average' },
    });
    const line = getSectionGrowthData(CID, 's1', 'sa');
    expect(getSectionProficiency(CID, 's1', 'sa')).toBe(3);
    expect(line[line.length - 1].prof).toBe(3);
  });
});
