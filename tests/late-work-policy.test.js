/**
 * Late Work Policy is one saved value on the class (course.late_work_policy).
 * Class Management's Details tab edits it and the report's Score
 * Distribution block prints it. The report used to read a device-only copy in
 * the course config, so a policy set in Class Management never printed.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-late-policy';
const STUDENT = { id: 'stu-1', firstName: 'Noor', lastName: 'Khan' };

function seed(course) {
  COURSES[CID] = Object.assign({ id: CID, name: 'Science 8', gradingSystem: 'proficiency' }, course);
  _cache.students[CID] = [STUDENT];
  // The block draws only once the student has scored work.
  _cache.learningMaps[CID] = {
    sections: [{ id: 'sec-1', name: 'Inquiry', color: '#336699', tags: [{ id: 'tag-1', label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [{ id: 'a', title: 'Lab', scoreMode: 'proficiency', tagIds: ['tag-1'], type: 'summative' }];
  _cache.scores[CID] = { 'stu-1': [{ assessmentId: 'a', tagId: 'tag-1', score: 3, date: '2026-10-10' }] };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('Late Work Policy on the report', () => {
  beforeEach(() => localStorage.clear());

  it("prints the class's saved policy", () => {
    seed({ lateWorkPolicy: 'Late work loses 10% per day.' });
    const html = ReportBlocks.renderBlockScoreDistribution(CID, STUDENT);
    expect(html).toContain('Late work loses 10% per day.');
  });

  it('ignores a device-only copy in the course config', () => {
    seed({ lateWorkPolicy: null });
    _cache.courseConfigs[CID] = { lateWorkPolicy: 'Stale local text' };
    const html = ReportBlocks.renderBlockScoreDistribution(CID, STUDENT);
    expect(html).not.toContain('Stale local text');
    expect(html).toContain('No late work policy set');
  });

  it('escapes the policy text', () => {
    seed({ lateWorkPolicy: '<img src=x onerror=alert(1)>' });
    const html = ReportBlocks.renderBlockScoreDistribution(CID, STUDENT);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
