/**
 * Points work's mark on the report blocks (Nov 3 bug sweep, reports group
 * 2). In a Letter or Both class a 17/20 quiz tagged to a competency printed
 * the % its level counts as (Proficient, 75%) in Assignment Grades by
 * Competency, the Proficiency block's Best and Lowest work, Progress in One
 * Area, Next Steps' Latest line and Ways to Support at Home, while By Date
 * printed 17/20 · 85%. Each now prints the piece's own % from calc.js, as
 * Generate does (#565).
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-own-pct';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

function seed(mode, assessments, scores) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: mode };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry', i_can_statements: ['I can ask'] }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const quiz = (id, date) => ({ id, title: 'Quiz ' + id, date, tagIds: ['t1'], scoreMode: 'points', maxPoints: 20 });
const sc = (assessmentId, score) => ({ assessmentId, tagId: 't1', score, date: '2026-10-10' });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('points work prints its own % on the report blocks', () => {
  afterEach(() => delete COURSES[CID]);

  it('prints 17/20 as 85% on every block in a Letter class', () => {
    seed('letter', [quiz('A', '2026-10-01')], [sc('A', 17)]);
    const a = getAssessments(CID)[0];
    expect(getAssessmentGroupPercentage(CID, SID, [a]).pct).toBeCloseTo(85, 9);
    // Its level (Proficient on Points to Proficiency) counts as 75%.
    expect(formatLevelAs(CID, getTagScores(CID, SID, 't1')[0].score, 'percent')).toBe('75%');

    const byComp = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
    const byDate = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'date' }));
    expect(byDate).toContain('17/20 · 85%');
    expect(byComp).toContain('85%');
    expect(byComp).not.toContain('75%');

    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Best work: Quiz A (Oct 1), 85%.');
    const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
    expect(prog).toContain('Best Quiz A, Oct 1 · 85%');
    expect(prog).toContain('Latest Quiz A, Oct 1 · 85%');
    expect(prog).toContain('Oct 1 Quiz A 85%');
    // Start of term and Now are the competency's level, not the piece's.
    expect(prog).toContain('Now 75%');
    const steps = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
    expect(steps).toContain('Latest: Quiz A, Oct 1 · 85%');
    const home = text(ReportBlocks.renderBlockSupportHome(CID, STUDENT, {}, {}));
    expect(home).toContain('Ask to see Quiz A, Oct 1 · 85%');
  });

  it('prints its own % beside the level in a Both class', () => {
    seed('both', [quiz('A', '2026-10-01')], [sc('A', 17)]);
    const byComp = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
    expect(byComp).toContain('3.0 / 4 · 85%');
    const steps = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
    expect(steps).toContain('Latest: Quiz A, Oct 1 · 3.0 / 4 · 85% Proficient');
  });

  it('names only the pieces at the % it prints when two share a level', () => {
    // 16/20 and 17/20 are both Proficient; the higher % is the best work.
    seed('letter', [quiz('A', '2026-10-01'), quiz('B', '2026-10-05')], [sc('A', 16), sc('B', 17)]);
    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Best work: Quiz B (Oct 5), 85%.');
    const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
    expect(prog).toContain('Best Quiz B, Oct 5 · 85%');
    expect(prog).not.toContain('Quiz A, Oct 1 · Quiz B');
  });

  it('leaves a Proficiency class as it was', () => {
    seed('proficiency', [quiz('A', '2026-10-01'), quiz('B', '2026-10-05')], [sc('A', 16), sc('B', 17)]);
    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Best work: Quiz A (Oct 1) and Quiz B (Oct 5), 3.0 / 4.');
  });
});
