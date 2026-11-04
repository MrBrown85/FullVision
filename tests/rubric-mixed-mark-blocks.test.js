/**
 * Mixed rubric criteria on one competency (Colin, 2026-11-03): Progress in
 * One Area, Next Steps (Latest) and Generate's trend read the competency's
 * mark on the piece as the gradebook shows it, the lowest when the criteria
 * disagree (calc.js tagMarksByAssessment, #831), not the criteria's average
 * (tagScoresByAssessment). Thesis 4 and Evidence Use 1 on Significance: the
 * gradebook cell says 1, striped; these blocks said 2.5.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'rubric-mixed-blocks';
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
const debate = { id: 'debate', title: 'Treaty Debate', date: '2026-10-01', tagIds: ['t1'] };
const essay = { id: 'essay', title: 'Causes of the War', date: '2026-10-12', tagIds: ['t1'], rubricId: 'rub-1' };
const sc = (assessmentId, tagId, score, date) => ({ assessmentId, tagId, score, date });

function seed() {
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
  _cache.assessments[CID] = [debate, essay];
  _cache.scores[CID] = {
    [SID]: [
      sc('debate', 't1', 3, '2026-10-01'),
      sc('essay', 'crit-thesis', 4, '2026-10-12'),
      sc('essay', 'crit-evidence', 1, '2026-10-12'),
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [rubric];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a competency fed by two rubric criteria that disagree', () => {
  afterEach(() => delete COURSES[CID]);

  it('Next Steps prints the latest piece at the gradebook’s mark', () => {
    seed();
    expect(tagMarksByAssessment(CID, SID, 't1').find(m => m.assessmentId === 'essay')).toMatchObject({
      score: 1,
      mixed: true,
    });
    const out = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
    expect(out).toContain('Latest: Causes of the War');
    expect(out).toContain('1.0 / 4');
    expect(out).not.toContain('2.5');
  });

  it('Progress in One Area lists the piece at the gradebook’s mark', () => {
    seed();
    const out = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
    expect(out).toContain('Causes of the War');
    expect(out).toContain('1.0 / 4');
    expect(out).not.toContain('2.5 / 4');
  });

  it('Generate’s trend reads the same mark', () => {
    seed();
    const comp = CommentBank.facts(CID, STUDENT, null).comps.find(c => c.id === 'sec-1');
    expect(comp.scores.map(s => s.id + ' ' + s.v)).toEqual(['debate 3', 'essay 1']);
  });
});
