/**
 * Missing means labelled Missing (Colin, Oct 30 2026): work counts as
 * missing only when its status is Missing (score.status 'NS'), whatever its
 * due date. An empty cell past its due date is just empty. Every place that
 * counts missing work reads the same rule: the gradebook cell, Missing and
 * Late, the student cards, the report blocks and the comment's facts.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-missing-labelled';
const TAG = 'tag-inquiry';
const NOOR = { id: 'stu-1', firstName: 'Noor', lastName: 'Khan' };
const LEV = { id: 'stu-2', firstName: 'Lev', lastName: 'Park' };

const work = (id, title, dueDate) => ({
  id,
  title,
  date: '2026-10-01',
  dueDate,
  scoreMode: 'proficiency',
  tagIds: [TAG],
  type: 'summative',
});
// Past due with nothing in it, labelled Missing before its due date, scored.
const PAST_DUE = work('a1', 'Lab Report', '2026-10-05');
const LABELLED = work('a2', 'Poster', '2099-10-05');
const SCORED = work('a3', 'Seminar', '2026-10-05');

function seed(statuses) {
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
  _cache.students[CID] = [NOOR, LEV];
  _cache.learningMaps[CID] = {
    sections: [{ id: 'sec-1', name: 'Inquiry', color: '#336699', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [PAST_DUE, LABELLED, SCORED];
  _cache.scores[CID] = {
    [NOOR.id]: [{ assessmentId: 'a3', tagId: TAG, score: 3, date: '2026-10-05' }],
    [LEV.id]: [{ assessmentId: 'a3', tagId: TAG, score: 3, date: '2026-10-05' }],
  };
  _cache.statuses[CID] = statuses;
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { missingPolicy: 'zero' };
  clearProfCache();
}

describe('missing means labelled Missing', () => {
  beforeEach(() => {
    localStorage.clear();
    seed({ [NOOR.id + ':a2']: 'NS' });
  });

  it('the gradebook cell: past due and empty is empty; labelled Missing is M', () => {
    expect(assessmentCellValue(CID, NOOR.id, PAST_DUE)).toMatchObject({ kind: 'none', text: '—', status: null });
    expect(assessmentCellValue(CID, NOOR.id, LABELLED)).toMatchObject({ kind: 'status', status: 'NS', text: 'M' });
  });

  it('Missing and Late lists only the labelled work', () => {
    const items = DashInsights.missingItems(CID, [NOOR, LEV]);
    expect(items.map(it => [it.kind, it.student.id, it.assessment.id])).toEqual([['ns', NOOR.id, 'a2']]);
  });

  it('the student cards count only the labelled work', () => {
    const scores = getScores(CID);
    const html = DashStudentCards.renderStudentCards(
      CID,
      [NOOR, LEV],
      [NOOR, LEV],
      getSections(CID),
      getAssessments(CID),
      scores,
      {},
    );
    expect(html.match(/dash-card-missing/g) || []).toHaveLength(1);
    expect(html).toContain('title="1 labelled Missing"');
  });

  it('the report blocks list only the labelled work', () => {
    const blocks = ['missing-work', 'term-glance', 'section-chart', 'score-distribution'].map(id =>
      ReportBlocks.renderReportBlock(id, CID, NOOR, {}, {}),
    );
    blocks.forEach(html => expect(html).not.toContain('Lab Report'));
    expect(blocks[0]).toContain('Poster');
    expect(blocks[2]).toContain('Poster');
    expect(blocks[3]).toContain('Missing Assignments (1)');
    // Lev has nothing labelled Missing.
    expect(ReportBlocks.renderReportBlock('score-distribution', CID, LEV, {}, {})).toContain('No missing assignments');
  });

  it('the comment facts count and name only the labelled work', () => {
    const f = CommentBank.facts(CID, NOOR, null);
    expect(f.record).toMatchObject({ missing: 1 });
    expect(f.notHandedIn).toEqual({ count: 1, titles: ['Poster'], groups: [] });
    expect(CommentBank.facts(CID, LEV, null).notHandedIn.count).toBe(0);
  });
});
