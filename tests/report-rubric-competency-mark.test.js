/**
 * A competency's mark on rubric work, on the report blocks (Nov 3 bug
 * sweep, reports group 2). Two criteria feed one competency and the student
 * gets 4 on one and 1 on the other: the gradebook's competency cell shows 1,
 * striped as mixed (DECISIONS "Rubric criteria score on their own").
 * Assignment Grades by Competency printed 4.0 / 4 Extending, and the
 * Proficiency block's Lowest work skipped the low criterion, because both
 * kept each assessment's highest criterion. Both now read the mark through
 * calc.js (tagMarksByAssessment), as the gradebook does.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-rubric-mark';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

const rubric = {
  id: 'rub-1',
  name: 'Essay',
  criteria: [
    { id: 'crit-thesis', name: 'Thesis', tagIds: ['t1'], levels: {} },
    { id: 'crit-evidence', name: 'Evidence Use', tagIds: ['t1'], levels: {} },
  ],
};
const essay = { id: 'essay', title: 'Causes of the War', date: '2026-10-01', tagIds: ['t1'], rubricId: 'rub-1' };
const debate = { id: 'debate', title: 'Treaty Debate', date: '2026-10-09', tagIds: ['t1'] };
const sc = (assessmentId, tagId, score, extra) => ({ assessmentId, tagId, score, date: '2026-10-10', ...extra });

function seed(scores) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec-1', name: 'Significance', tags: [{ id: 't1', label: 'Significance' }] }],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [essay, debate];
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [rubric];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a competency fed by two rubric criteria', () => {
  afterEach(() => delete COURSES[CID]);

  it('prints the lowest criterion when they disagree, as the gradebook does', () => {
    seed([sc('essay', 'crit-thesis', 4), sc('essay', 'crit-evidence', 1), sc('debate', 't1', 3)]);
    expect(competencyLevelFromCriteria(CID, SID, essay, 't1')).toMatchObject({ score: 1, mixed: true });
    expect(tagMarksByAssessment(CID, SID, 't1').find(m => m.assessmentId === 'essay')).toMatchObject({
      score: 1,
      mixed: true,
    });

    const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
    expect(grades).toContain('Causes of the War 1.0 / 4 Emerging');
    expect(grades).not.toContain('4.0 / 4');

    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Best work: Treaty Debate (Oct 9), 3.0 / 4.');
  });

  it('prints the one level, with its ±, when they agree', () => {
    seed([sc('essay', 'crit-thesis', 3, { mod: 1 }), sc('essay', 'crit-evidence', 3, { mod: 1 })]);
    const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
    expect(grades).toContain('Causes of the War 3.3 / 4 Proficient');
  });
});
