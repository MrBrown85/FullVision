/**
 * The dashboard's Overall sort (the grid's Overall heading and the Overall
 * High→Low / Low→High menu) follows the grade Overall shows. In a Letter
 * class that is the letter and course %, so the sort is by the course %,
 * not the competency proficiency (which is 0 for every student in a
 * points-only class, so the sort did nothing).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'course-sort';

const points = id => ({ id, title: id, scoreMode: 'points', maxPoints: 100, tagIds: [], type: 'summative' });
const score = (assessmentId, value) => ({ assessmentId, tagId: '', score: value, date: '2026-10-10' });

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [points('essay')];
  _cache.scores[CID] = { low: [score('essay', 48)], high: [score('essay', 72)], none: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('studentOverallSortValue', () => {
  beforeEach(() => localStorage.clear());

  it('is the course % shown in a Letter class', () => {
    seed('letter');
    expect(studentGradeSummary(CID, 'low').text).toContain('48%');
    expect(studentOverallSortValue(CID, 'low')).toBe(48);
    expect(studentOverallSortValue(CID, 'high')).toBe(72);
    expect(studentOverallSortValue(CID, 'none')).toBe(null);
  });

  it('is the overall proficiency in a Proficiency class', () => {
    seed('proficiency');
    expect(studentOverallSortValue(CID, 'high')).toBe(getOverallProficiency(CID, 'high') || null);
  });
});

describe('the dashboard Overall sort', () => {
  it('sorts by studentOverallSortValue, not the proficiency', () => {
    const src = readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8');
    const block = src.slice(src.indexOf("case 'overall-desc':"), src.indexOf("case 'flagged':"));
    expect(block).toContain('studentOverallSortValue(cid, a.id)');
    expect(block).not.toContain('getOverallProficiency');
  });
});
