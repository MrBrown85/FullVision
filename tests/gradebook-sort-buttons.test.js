/**
 * The gradebook's Student button cycled through four name orders, with the
 * same ▲ for last-name and first-name A–Z and no tooltip, so a teacher
 * couldn't tell which was on; Overall couldn't be sorted at all (Nov 3 bug
 * sweep, Step 4 group 3 #27). Student now names the order on and says what
 * a click turns it to, and Overall sorts lowest first, then highest.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, click, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cO';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-10' };

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Zoe', lastName: 'Adams' },
    { id: 's2', firstName: 'Ava', lastName: 'Brown' },
    { id: 's3', firstName: 'Max', lastName: 'Chen' },
  ];
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = {
    s1: [{ assessmentId: 'q1', tagId: 'T1', score: 3, date: '2026-10-10', note: '' }],
    s2: [{ assessmentId: 'q1', tagId: 'T1', score: 4, date: '2026-10-10', note: '' }],
    s3: [{ assessmentId: 'q1', tagId: 'T1', score: 1, date: '2026-10-10', note: '' }],
  };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'SUB', name: 'Science' }],
    sections: [{ id: 'sec1', subject: 'SUB', name: 'Questioning', tags: [{ id: 'T1', label: 'Questions' }] }],
  };
}

const order = () => Array.from(document.querySelectorAll('#gb-data tr[data-sid]')).map(r => r.dataset.sid);
const nameBtn = () => document.querySelector('[data-action="toggleSort"][data-sortkey="name"]');
const overallBtn = () => document.querySelector('[data-action="toggleSort"][data-sortkey="overall"]');

afterEach(unmount);

describe('the Student sort', () => {
  it('names the order on and the one a click gives', () => {
    mount(seed, { course: CID });
    expect(order()).toEqual(['s1', 's2', 's3']);
    expect(nameBtn().textContent).toBe('StudentLast Name A–Z');
    expect(nameBtn().getAttribute('title')).toBe('Sorted by Last Name A–Z. Click for Last Name Z–A.');
    click(nameBtn());
    expect(order()).toEqual(['s3', 's2', 's1']);
    expect(nameBtn().textContent).toContain('Last Name Z–A');
    click(nameBtn());
    expect(order()).toEqual(['s2', 's3', 's1']);
    expect(nameBtn().textContent).toContain('First Name A–Z');
    click(nameBtn());
    expect(nameBtn().textContent).toContain('First Name Z–A');
    click(nameBtn());
    expect(nameBtn().textContent).toContain('Last Name A–Z');
  });
});

describe('the Overall sort', () => {
  for (const view of ['scores', 'competencies']) {
    it('sorts lowest first, then highest, in the ' + view + ' view', () => {
      mount(seed, { course: CID });
      if (view === 'competencies') showCompetencies();
      click(overallBtn());
      expect(order()).toEqual(['s3', 's1', 's2']);
      expect(overallBtn().getAttribute('title')).toBe('Sorted by Overall, lowest first. Click for highest first.');
      click(overallBtn());
      expect(order()).toEqual(['s2', 's1', 's3']);
      // Student goes back to last name A–Z.
      click(nameBtn());
      expect(order()).toEqual(['s1', 's2', 's3']);
    });
  }
});
