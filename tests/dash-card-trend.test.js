/**
 * The dashboard card's trend arrow (2026-11-01 math audit). It averaged raw
 * score entries, so points work counted as its points: a student going from
 * 5/10 and 6/10 (Developing) to two Proficient levels read as dropping from
 * 5.5 to 3. It now reads competency evidence as calc.js counts it.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'card-trend';
const SID = 'stu-1';
const UP = '&#x2191;';
const DOWN = '&#x2193;';

function card(assessments, scores, statuses = {}) {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses;
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
  const st = { id: SID, firstName: 'Noor', lastName: 'Khan' };
  return DashStudentCards.renderStudentCards(CID, [st], [st], getSections(CID), assessments, getScores(CID), {});
}
const pts = id => ({ id, title: id, scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] });
const lvl = id => ({ id, title: id, tagIds: ['t1'] });
const sc = (aid, score, date) => ({ assessmentId: aid, tagId: 't1', score, date });

describe('dashboard card trend', () => {
  afterEach(() => delete COURSES[CID]);

  it('reads points work as its level', () => {
    const html = card(
      [pts('a'), pts('b'), lvl('c'), lvl('d')],
      [sc('a', 5, '2026-09-01'), sc('b', 6, '2026-09-08'), sc('c', 3, '2026-09-15'), sc('d', 3, '2026-09-22')],
    );
    expect(html).toContain(UP);
    expect(html).not.toContain(DOWN);
  });

  it('leaves Excused work out', () => {
    const html = card(
      [lvl('a'), lvl('b'), lvl('c'), lvl('d'), lvl('e')],
      [
        sc('a', 2, '2026-09-01'),
        sc('b', 2, '2026-09-08'),
        sc('c', 3, '2026-09-15'),
        sc('d', 3, '2026-09-22'),
        sc('e', 1, '2026-09-29'),
      ],
      { [SID + ':e']: 'EXC' },
    );
    expect(html).toContain(UP);
  });
});
