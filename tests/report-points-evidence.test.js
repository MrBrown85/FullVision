/**
 * Report blocks that list evidence by level read points work as its level
 * on the grading scale. They used the raw points (18 of 20 as level 18),
 * which has no label, so the report showed a "?" glyph.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-report-points';
const SID = 'stu-1';
const TAG = 'tag-inquiry';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

const points = (id, title, max) => ({
  id,
  title,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: [TAG],
  type: 'summative',
});
const level = (id, title) => ({ id, title, scoreMode: 'proficiency', tagIds: [TAG], type: 'summative' });
const score = (assessmentId, value, extra) => ({
  assessmentId,
  tagId: TAG,
  score: value,
  date: '2026-10-10',
  ...extra,
});

function seed({ assessments, scores, statuses = {} }) {
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    sections: [{ id: 'sec-1', name: 'Inquiry', color: '#336699', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses;
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('report evidence for points work', () => {
  beforeEach(() => localStorage.clear());

  it('labels points evidence by its level in Learning Outcomes', () => {
    seed({ assessments: [points('a', 'Essay', 20)], scores: [score('a', 18)] });
    const html = ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT);
    expect(html).toContain('Essay');
    expect(html).toContain('[E]');
    expect(html).not.toContain('[?]');
  });

  it('labels points evidence by its level in the Section Proficiency Breakdown', () => {
    seed({
      assessments: [points('a', 'Essay', 20), points('b', 'Quiz', 10)],
      scores: [score('a', 18), score('b', 6)],
    });
    const html = ReportBlocks.renderBlockSectionChart(CID, STUDENT);
    expect(html).toContain('Essay');
    expect(html).not.toMatch(/>\?</);
    // 18/20 = 90% is Extending, 6/10 = 60% is Developing.
    expect(html).toMatch(/>E<\/span>\s*<span[^>]*>Essay/);
    expect(html).toMatch(/>D<\/span>\s*<span[^>]*>Quiz/);
  });

  it('counts points work by level in the Score Distribution', () => {
    seed({
      assessments: [points('a', 'Essay', 20), level('b', 'Seminar')],
      scores: [score('a', 18), score('b', 3, { mod: 1 })],
    });
    const html = ReportBlocks.renderBlockScoreDistribution(CID, STUDENT);
    expect(html).not.toMatch(/>\?</);
    expect(html).toContain('Top assignments');
    expect(html).toMatch(/>E<\/span>\s*<span[^>]*>Essay/);
    expect(html).toMatch(/>P<\/span>\s*<span[^>]*>Seminar/);
  });

  it('leaves excused work out of the evidence', () => {
    seed({
      assessments: [points('a', 'Essay', 20), points('b', 'Quiz', 10)],
      scores: [score('a', 18), score('b', 6)],
      statuses: { [SID + ':b']: 'EXC' },
    });
    const html = ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT);
    expect(html).toContain('Essay');
    expect(html).not.toContain('Quiz');
  });
});
