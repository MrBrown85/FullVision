/**
 * Growth Since Last Report: the arrow follows the figures beside it
 * (2026-11-01 math audit). It compared whole levels, so in a Letter class a
 * competency going from 67% to 83% (3− to 3+) showed "Same" beside the two
 * percents. A Proficiency class shows the word, so there it still compares
 * whole levels.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-growth';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
const TERMS = [
  { ordinal: 1, label: 'Report 1', starts_on: '2026-09-01', ends_on: '2026-09-30' },
  { ordinal: 2, label: 'Report 2', starts_on: '2026-10-01', ends_on: '2026-10-31' },
];

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem, gradeLevel: '12' };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [
    { id: 'a1', title: 'Essay 1', date: '2026-09-15', tagIds: ['t1'] },
    { id: 'a2', title: 'Essay 2', date: '2026-10-15', tagIds: ['t1'] },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'a1', tagId: 't1', score: 3, mod: -1, date: '2026-09-15' },
      { assessmentId: 'a2', tagId: 't1', score: 3, mod: 1, date: '2026-10-15' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: TERMS };
  setActiveTerm(CID, 2);
  clearProfCache();
}
const arrowOf = html => (html.match(/aria-label="(Up|Down|Same)"/) || [])[1];

describe('Growth Since Last Report arrow', () => {
  afterEach(() => {
    setActiveTerm(CID, null);
    delete COURSES[CID];
  });

  it('is up in a Letter class when the % beside it rises', () => {
    seed('letter');
    const html = ReportBlocks.renderBlockGrowth(CID, STUDENT);
    expect(html).toContain('67%');
    expect(html).toContain('83%');
    expect(arrowOf(html)).toBe('Up');
  });

  it('is the same in a Proficiency class while the word is the same', () => {
    seed('proficiency');
    expect(arrowOf(ReportBlocks.renderBlockGrowth(CID, STUDENT))).toBe('Same');
  });
});
