/**
 * Report blocks read levels through calc.js (2026-11-01 math audit).
 * - Core Competencies averaged raw scores, so points work counted as its
 *   points (18 of 20 as level 18, a bar past 100%), Excused work counted,
 *   and the Factor and the report's term were ignored.
 * - The override note rounded the calculated level twice, so 3.46 read
 *   "3.5 Extending".
 * - The Proficiency block's Overall "then" was a flat mean of competencies
 *   while "now" rolls up through competency groups (rollUpSectionLevels).
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-calc';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

function seed({ assessments, scores, statuses = {}, overrides = {}, sections, groups }) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: sections || [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
    competencyGroups: groups || [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses;
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = overrides;
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const sc = (assessmentId, score, extra) => ({ assessmentId, tagId: 't1', score, date: '2026-10-10', ...extra });
const cc = (id, extra) => ({ id, title: id, tagIds: ['t1'], coreCompetencyIds: ['CT'], ...extra });
// The Creative Thinking row of the Core Competencies block.
const ctRow = html => {
  const i = html.indexOf('Creative Thinking');
  return html.slice(i, html.indexOf('Based on', i) + 30);
};

describe('Core Competencies block', () => {
  afterEach(() => delete COURSES[CID]);

  it('reads points work as its level, not its points', () => {
    seed({ assessments: [cc('a', { scoreMode: 'points', maxPoints: 20 })], scores: [sc('a', 18)] });
    const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
    // 18 of 20 is 90%: Extending on Points to Proficiency, a full bar
    expect(row).toContain('Extending');
    expect(row).toContain('width:100%');
  });

  it('leaves Excused work out and counts each Factor', () => {
    seed({
      assessments: [cc('a', { weight: 3 }), cc('b'), cc('c')],
      scores: [sc('a', 2), sc('b', 4), sc('c', 1)],
      statuses: { [SID + ':c']: 'EXC' },
    });
    // (2 × 3 + 4) / 4 = 2.5: a 62.5% bar
    expect(ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT))).toContain('width:62.5%');
  });
});

describe('override note', () => {
  afterEach(() => delete COURSES[CID]);

  it('words the calculated level from the level itself', () => {
    seed({
      assessments: [cc('a', { weight: 54 }), cc('b', { weight: 46 })],
      scores: [sc('a', 3), sc('b', 4)],
      overrides: { [SID]: { 'sec-1': { level: 2, reason: 'Conference' } } },
    });
    // (3 × 54 + 4 × 46) / 100 = 3.46: Proficient, not Extending
    expect(getSectionProficiencyRaw(CID, SID, 'sec-1')).toBeCloseTo(3.46, 9);
    expect(ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT)).toContain('calculated: 3.5 Proficient');
  });
});

describe('rollUpSectionLevels', () => {
  afterEach(() => delete COURSES[CID]);

  it('rolls up through groups exactly as the overall level does', () => {
    seed({
      sections: [
        { id: 's1', name: 'S1', groupId: 'g', tags: [{ id: 't1' }] },
        { id: 's2', name: 'S2', groupId: 'g', tags: [{ id: 't2' }] },
        { id: 's3', name: 'S3', tags: [{ id: 't3' }] },
      ],
      groups: [{ id: 'g', name: 'G' }],
      assessments: [{ id: 'a', title: 'a', tagIds: ['t1', 't2', 't3'] }],
      scores: [sc('a', 2), sc('a', 4, { tagId: 't2' }), sc('a', 1, { tagId: 't3' })],
    });
    // group (2 + 4) / 2 = 3, then (3 + 1) / 2 = 2; a flat mean would be 2.33
    expect(getOverallProficiency(CID, SID)).toBe(2);
    const then = { s1: 2, s2: 4, s3: 1 };
    expect(rollUpSectionLevels(CID, sec => then[sec.id])).toBe(2);
    expect(rollUpSectionLevels(CID, () => 0)).toBe(0);
  });
});
