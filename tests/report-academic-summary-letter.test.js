/**
 * The Progress Report's Academic Summary block. Letter and Both classes
 * show the letter and course % ("A (95%)"), as Class Summary does; Both
 * keeps the proficiency word under it. Proficiency classes are unchanged.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-report-letter';
const SID = 'stu-1';
const TAG = 'tag-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

const points = (id, max) => ({
  id,
  title: id,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: [TAG],
  type: 'summative',
});
const score = (assessmentId, value) => ({ assessmentId, tagId: TAG, score: value, date: '2026-10-10' });

const stubbed = ['getSections', 'getGroupedSections', 'getOverallProficiency'];
const originals = {};

function seed(gradingSystem, scores) {
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem };
  _cache.students[CID] = [STUDENT];
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [points('a', 10), points('b', 10)];
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

function summary() {
  return ReportBlocks.renderBlockAcademicSummary(CID, STUDENT);
}

describe('Academic Summary overall grade', () => {
  beforeEach(() => {
    localStorage.clear();
    stubbed.forEach(name => (originals[name] = globalThis[name]));
    globalThis.getSections = () => [];
    globalThis.getGroupedSections = () => ({ groups: [], ungrouped: [] });
    globalThis.getOverallProficiency = () => 3;
  });

  afterEach(() => {
    stubbed.forEach(name => (globalThis[name] = originals[name]));
    delete COURSES[CID];
  });

  it('shows the letter and % for a Letter class', () => {
    seed('letter', [score('a', 10), score('b', 9)]);
    const html = summary();
    expect(html).toContain('Overall Grade');
    expect(html).toContain('A (95%)');
    expect(html).not.toContain('Overall Proficiency');
  });

  it('shows the letter and % with the proficiency word for a Both class', () => {
    seed('both', [score('a', 7), score('b', 7)]);
    const html = summary();
    expect(html).toContain('C+ (70%)');
    expect(html).toContain('Overall Proficiency: Proficient');
  });

  it('shows the letter and percent for a Letter class', () => {
    seed('letter', [score('a', 10), score('b', 9)]);
    expect(summary()).toContain('A (95%)');
  });

  it('shows No Evidence for a Letter class with nothing graded', () => {
    seed('letter', []);
    expect(summary()).toContain('No Evidence');
  });

  it('keeps the proficiency word for a Proficiency class', () => {
    seed('proficiency', [score('a', 10), score('b', 9)]);
    const html = summary();
    expect(html).toContain('Overall Proficiency');
    expect(html).toContain('Proficient');
    expect(html).not.toContain('A (95%)');
  });
});
