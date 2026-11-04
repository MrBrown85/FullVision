/**
 * The Competencies view's cells had no accessible name: level tiles, M and
 * EXC said nothing, and rubric cells only "Click to grade it on the
 * rubric.", while Scores cells read "Mateo Alvarez, Density Worksheet: 8 out
 * of 10" (Nov 3 bug sweep, Step 4 group 3 #28). Each cell now names the
 * student, the work, the competency and the score.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cN';
const quiz = {
  id: 'q1',
  title: 'Density Worksheet',
  scoreMode: 'points',
  maxPoints: 10,
  tagIds: ['T1'],
  date: '2026-10-10',
};
const lab = { id: 'l1', title: 'Lab 1', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-11' };
const hw = { id: 'h1', title: 'Homework', scoreMode: 'complete', maxPoints: 1, tagIds: ['T1'], date: '2026-10-12' };

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'SUB', name: 'Science' }],
    sections: [
      { id: 'sec1', subject: 'SUB', name: 'Questioning', tags: [{ id: 'T1', code: 'QAP1', label: 'Questions' }] },
    ],
  };
  _cache.students[CID] = [
    { id: 's1', firstName: 'Mateo', lastName: 'Alvarez' },
    { id: 's2', firstName: 'Hannah', lastName: 'Whitford' },
  ];
  _cache.assessments[CID] = [quiz, lab, hw];
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' },
      { assessmentId: 'l1', tagId: 'T1', score: 3, mod: 1, date: '2026-10-11', note: '' },
    ],
    s2: [],
  };
  _cache.statuses[CID] = { 's2:l1': 'NS', 's2:q1': 'EXC' };
  _cache.courseConfigs[CID] = {};
}

const label = (aid, sid) =>
  document.querySelector('#gb-data td[data-aid="' + aid + '"][data-sid="' + sid + '"]').getAttribute('aria-label');

afterEach(unmount);

describe('Competencies cells', () => {
  it('say the student, the work, the competency and the score', () => {
    mount(seed, { course: CID });
    showCompetencies();
    expect(label('q1', 's1')).toBe('Mateo Alvarez, Density Worksheet: 8 out of 10');
    expect(label('l1', 's1')).toBe('Mateo Alvarez, Lab 1, QAP1: 3+, Proficient +');
    expect(label('h1', 's1')).toBe('Mateo Alvarez, Homework: No score');
    expect(label('l1', 's2')).toBe('Hannah Whitford, Lab 1, QAP1: Missing');
    expect(label('q1', 's2')).toBe('Hannah Whitford, Density Worksheet: Excused');
  });
});
