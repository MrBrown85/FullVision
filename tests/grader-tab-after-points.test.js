/**
 * In the gradebook's grader, Tab from the Score box after a new score saved
 * it, but the save redrew the dialog and replaced Overall Comment, so focus
 * fell to the page and the next keystroke went nowhere (Nov 3 bug sweep,
 * Step 4 group 2 #22). With no change Tab worked. Focus now goes to the new
 * Overall Comment box.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { mount, unmount, key } from './helpers/gradebook-dom.js';

const CID = 'cG';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = { s1: [], s2: [] };
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

describe('Tab from the grader Score box', () => {
  it('lands on Overall Comment after a new score', async () => {
    const box = openGrader();
    expect(box.classList.contains('grdp-input')).toBe(true);
    box.value = '7';
    // Tab: focus moves to the next control, Overall Comment.
    document.getElementById('grdt-overall-q1').focus();
    expect(getPointsScore(CID, 's1', 'q1')).toBe(7);
    await new Promise(r => setTimeout(r, 5));
    expect(document.activeElement.id).toBe('grdt-overall-q1');
    expect(document.activeElement.isConnected).toBe(true);
  });
});
