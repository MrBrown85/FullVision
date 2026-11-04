/**
 * In the gradebook's grader the focus opens in the Score box, where ← and →
 * moved the caret, not the student, though the hint said "← → change
 * student"; Return stepped, and the hint didn't say so; and Escape after
 * stepping selected the first student's cell, not the one the teacher ended
 * on (Nov 3 bug sweep, Step 4 group 3 #31). Now ← → change student while
 * the box holds the saved points, the hint names Return, and closing
 * selects the last student's cell.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { mount, unmount, key } from './helpers/gradebook-dom.js';

const CID = 'cR';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = { s1: [{ assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' }], s2: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

let realPage;
afterEach(() => {
  if (window.PageAssignments.graderOpen()) window.PageAssignments.closeGrader();
  unmount();
  window.PageAssignments = realPage;
});

function openGrader() {
  mount(seed, { course: CID });
  realPage = window.PageAssignments;
  runInThisContext(readFileSync('teacher/page-assignments.js', 'utf-8'), { filename: 'teacher/page-assignments.js' });
  const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
  cell.classList.add('gb-focus');
  cell.focus();
  key(cell, 'Enter');
  return document.activeElement;
}

const student = () => document.querySelector('#grader-overlay .grader-student').textContent;

describe('the grader Score box', () => {
  it('changes student with → while it holds the saved points', () => {
    const box = openGrader();
    expect(box.classList.contains('grdp-input')).toBe(true);
    expect(student()).toContain('Ava');
    key(box, 'ArrowRight');
    expect(student()).toContain('Ben');
    key(document.activeElement, 'ArrowLeft');
    expect(student()).toContain('Ava');
  });

  it('keeps ← → for the caret once something is typed', () => {
    const box = openGrader();
    box.value = '7';
    const e = key(box, 'ArrowRight');
    expect(e.defaultPrevented).toBe(false);
    expect(student()).toContain('Ava');
  });

  it('says Return goes to the next student', () => {
    openGrader();
    expect(document.querySelector('#grader-overlay .grader-hint').textContent).toBe(
      'Return next student · ← → change student · Esc closes',
    );
  });

  it('selects the cell of the student it ended on when it closes', () => {
    const box = openGrader();
    key(box, 'ArrowRight');
    key(document.activeElement, 'Escape');
    expect(window.PageAssignments.graderOpen()).toBe(false);
    expect(document.activeElement.matches('.gb-scores-cell[data-aid="q1"][data-sid="s2"]')).toBe(true);
  });
});
