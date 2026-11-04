/**
 * In the Scores view a digit typed on a selected cell did nothing and gave
 * no hint, while the Competencies view opened a box with the digit in it
 * (Nov 3 bug sweep, Step 4 group 2 #20). A digit now starts Edit Score with
 * it on points work and on a level; rubric work says to press Return.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, key, fire } from './helpers/gradebook-dom.js';

const CID = 'cD';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const lab = { id: 'l1', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-11' };
const poster = {
  id: 'p1',
  title: 'Poster',
  scoreMode: 'proficiency',
  rubricId: 'r1',
  tagIds: ['T1'],
  date: '2026-10-12',
};

function seed() {
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  _cache.assessments[CID] = [quiz, lab, poster];
  _cache.rubrics[CID] = [{ id: 'r1', name: 'R', criteria: [{ id: 'c1', name: 'Design', tagIds: ['T1'], levels: {} }] }];
  _cache.scores[CID] = { s1: [{ assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' }] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

function select(aid) {
  const cell = document.querySelector('.gb-scores-cell[data-aid="' + aid + '"][data-sid="s1"]');
  cell.classList.add('gb-focus');
  cell.focus();
  return cell;
}

afterEach(unmount);

describe('a digit on a selected Scores cell', () => {
  it('starts Edit Score with the digit on points work, and saves it', () => {
    mount(seed, { course: CID });
    const cell = select('q1');
    const e = key(cell, '7');
    expect(e.defaultPrevented).toBe(true);
    const inp = cell.querySelector('.gb-scores-input');
    expect(inp).not.toBeNull();
    expect(inp.value).toBe('7');
    fire(inp, 'blur');
    expect(getPointsScore(CID, 's1', 'q1')).toBe(7);
  });

  it('starts Edit Score on a level with 1 to 4', () => {
    mount(seed, { course: CID });
    const cell = select('l1');
    key(cell, '3');
    expect(cell.querySelector('.gb-scores-input').value).toBe('3');
  });

  it('says to press Return on rubric work', () => {
    mount(seed, { course: CID });
    const cell = select('p1');
    key(cell, '3');
    expect(cell.querySelector('.gb-scores-input')).toBeNull();
    const tip = document.getElementById('gb-tooltip');
    expect(tip.textContent).toBe('Scored on the rubric. Press Return to open it.');
  });
});
