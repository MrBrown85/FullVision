/**
 * In the Competencies view, proficiency and rubric columns named their
 * competency (PA3, QP2) but points columns showed only "/10" or "/20", so
 * work feeding a competency and work feeding none looked the same (Nov 3
 * bug sweep, Step 4 group 3 #38). A points column now names the
 * competencies it feeds, or says No Competency; its total stays in the
 * title above.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cK';
const quiz = { id: 'q1', title: 'Unit 1 Quiz', scoreMode: 'points', maxPoints: 20, tagIds: ['T5'], date: '2026-10-10' };
const sheet = {
  id: 'd1',
  title: 'Density Worksheet',
  scoreMode: 'points',
  maxPoints: 10,
  tagIds: [],
  date: '2026-10-11',
};

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'SUB', name: 'Science' }],
    sections: [{ id: 'sec1', subject: 'SUB', name: 'Planning', tags: [{ id: 'T5', code: 'PA5', label: 'Plans' }] }],
  };
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Adams' }];
  _cache.assessments[CID] = [quiz, sheet];
  _cache.scores[CID] = { s1: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

afterEach(unmount);

describe('points column headers in the Competencies view', () => {
  it('name the competency the work feeds, or say it feeds none', () => {
    mount(seed, { course: CID });
    showCompetencies();
    const heads = Array.from(document.querySelectorAll('.gb-grid-tag-header'));
    const texts = heads.map(h => h.textContent);
    expect(texts).toContain('PA5');
    expect(texts).toContain('No Competency');
    expect(texts.some(t => /^\/\d+$/.test(t))).toBe(false);
    const none = heads.find(h => h.textContent === 'No Competency');
    expect(none.classList.contains('gb-grid-tag-header-crit')).toBe(true);
    expect(none.dataset.tipText).toBe('Density Worksheet counts toward no competency');
    // The total is still in the title row.
    expect(document.querySelector('.gb-grid-colheads-row1').textContent).toContain('/ 10');
  });
});
