/**
 * Report blocks read levels through calc.js (2026-11-01 math audit).
 * - Core Competencies averaged raw scores, so points work counted as its
 *   points (18 of 20 as level 18, a bar past 100%), Excused work counted,
 *   and the Factor and the report's term were ignored.
 * - Core Competencies let 0% category work lower a level, and counted
 *   Excused and unscored work in "Based on N assessments" (Nov 3 sweep).
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

function seed({ assessments, scores, statuses = {}, overrides = {}, sections, groups, categories = [] }) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: sections || [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
    competencyGroups: groups || [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = categories;
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

  it('leaves 0% category work out and counts only work with a level', () => {
    seed({
      categories: [
        { id: 'tests', name: 'Tests', weight: 100 },
        { id: 'practice', name: 'Practice', weight: 0 },
      ],
      assessments: [
        cc('lab', { categoryId: 'tests' }),
        cc('quiz', { categoryId: 'tests' }),
        cc('project', { categoryId: 'tests' }),
        cc('practice', { categoryId: 'practice' }),
      ],
      scores: [sc('lab', 4), sc('practice', 1)],
      statuses: { [SID + ':quiz']: 'EXC' },
    });
    const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
    // Only the Lab counts, as for the curricular competency: Extending
    expect(row).toContain('Extending');
    expect(row).toContain('width:100%');
    expect(row).toContain('Based on 1 assessment<');
  });

  it('still shows the block when tagged work has no level yet', () => {
    seed({ assessments: [cc('a')], scores: [] });
    const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
    expect(row).toContain('Not yet assessed');
    expect(row).toContain('Based on 0 assessments');
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

/* Progress in One Area and Generate named a competency's level "now" as the
   mean of its last four weeks of scores (startAndNow), so a report could
   print Evidence at 3.0 Proficient in the Proficiency block and 4.0
   Extending beside it, and a teacher's override never reached either
   (Nov 3 bug sweep). Now is the level calc.js grades. */
describe('the level now is the graded level on every block and the comment', () => {
  afterEach(() => delete COURSES[CID]);
  const run = overrides => {
    seed({
      assessments: [
        cc('a', { date: '2026-09-01' }),
        cc('b', { date: '2026-09-15' }),
        cc('c', { date: '2026-10-15' }),
        cc('d', { date: '2026-10-30' }),
      ],
      scores: [sc('a', 2), sc('b', 2), sc('c', 4), sc('d', 4)],
      overrides,
    });
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    const t = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return {
      level: getSectionProficiency(CID, SID, 'sec-1'),
      prog: t(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {})),
      prof: t(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {})),
      comp: CommentBank.facts(CID, STUDENT, null).comps[0],
    };
  };

  it('prints the Mean level, not the last weeks’ mean', () => {
    const r = run();
    expect(r.level).toBe(3);
    expect(r.prof).toContain('3.0 Proficient');
    expect(r.prog).toContain('Now 3.0 Proficient (+1.0 this term)');
    expect(r.prog).not.toContain('Extending');
    // The comment works from the same level; its trend stays the trend.
    expect(r.comp.level).toBe(3);
    expect(r.comp.now).toBe(4);
  });

  it('prints the teacher’s override', () => {
    const r = run({ [SID]: { 'sec-1': { level: 2, reason: 'Conference' } } });
    expect(r.level).toBe(2);
    expect(r.prog).toContain('Now 2.0 Developing');
    expect(r.comp.level).toBe(2);
  });
});
