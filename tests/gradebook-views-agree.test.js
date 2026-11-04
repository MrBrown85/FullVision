/**
 * The two gradebook views showed the same things differently: an empty
 * cell was "—" in Scores (as the key says) but "·" in Competencies; a points
 * Class Average was "6" in Scores and "6/10" in Competencies; and a
 * Proficiency class's Overall was a bare coloured "3.3" in Scores but
 * "3.3 Proficient" in Competencies (Nov 3 bug sweep, Step 4 group 3 #29).
 * Both views now write each the same way.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cV';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const lab = { id: 'l1', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-11' };
const hw = { id: 'h1', title: 'Homework', scoreMode: 'complete', maxPoints: 1, tagIds: ['T1'], date: '2026-10-12' };

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'SUB', name: 'Science' }],
    sections: [{ id: 'sec1', subject: 'SUB', name: 'Questioning', tags: [{ id: 'T1', code: 'QAP1', label: 'Q' }] }],
  };
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = [quiz, lab, hw];
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' },
      { assessmentId: 'l1', tagId: 'T1', score: 3, date: '2026-10-11', note: '' },
    ],
    s2: [{ assessmentId: 'q1', tagId: 'T1', score: 4, date: '2026-10-10', note: '' }],
  };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

const text = el => (el ? el.textContent.trim() : null);

afterEach(unmount);

describe('the Scores and Competencies views agree', () => {
  it('write an empty cell as —', () => {
    mount(seed, { course: CID });
    expect(text(document.querySelector('.gb-scores-cell[data-aid="l1"][data-sid="s2"]'))).toBe('—');
    expect(text(document.querySelector('.gb-scores-cell[data-aid="h1"][data-sid="s2"]'))).toBe('—');
    showCompetencies();
    expect(text(document.querySelector('td.gb-score[data-aid="l1"][data-sid="s2"]'))).toBe('—');
    expect(text(document.querySelector('td.gb-score[data-aid="h1"][data-sid="s2"]'))).toBe('—');
    expect(text(document.querySelector('td.gb-score[data-aid="q1"][data-sid="s2"]'))).not.toBe('·');
  });

  it('write a points Class Average as 6/10', () => {
    mount(seed, { course: CID });
    const scoresAvg = Array.from(document.querySelectorAll('.gb-scores-stats .gb-avg-val')).map(text);
    expect(scoresAvg).toContain('6/10');
    showCompetencies();
    const compAvg = Array.from(document.querySelectorAll('.gb-stats-row .gb-avg-val')).map(text);
    expect(compAvg).toContain('6/10');
  });

  it('put the proficiency word with a Proficiency class’s Overall', () => {
    mount(seed, { course: CID });
    const grade = document.querySelector('#gb-rowheads .gb-grid-rowhead-grade');
    expect(grade.querySelector('.gb-grade-word').textContent).toBe('Proficient');
    showCompetencies();
    expect(document.querySelector('#gb-rowheads .gb-grid-rowhead-overall small').textContent).toBe('Proficient');
  });
});
