/**
 * Clear Score in the Scores view's cell menu, and Delete in the
 * Competencies view, took the score off with no toast and no Undo on
 * screen; only Cmd+Z, which nothing mentions, brought it back (Nov 3 bug
 * sweep, Step 4 group 2 #19). Both now show an Undo toast that names the
 * student, and its Undo puts the score back.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, key, click, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cU';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const lab = { id: 'l1', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-11' };

function seed() {
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  _cache.assessments[CID] = [quiz, lab];
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' },
      { assessmentId: 'l1', tagId: 'T1', score: 3, date: '2026-10-11', note: '' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

const scoreOf = aid => (getScores(CID).s1 || []).find(e => e.assessmentId === aid && e.score > 0);

afterEach(unmount);

describe('Clear Score in the Scores view', () => {
  it('shows an Undo toast, and its Undo puts the score back', () => {
    mount(seed, { course: CID });
    const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
    cell.dispatchEvent(new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true }));
    click(document.querySelector('[data-ctx="clearCell"]'));
    expect(getPointsScore(CID, 's1', 'q1')).toBeNull();
    const toast = document.getElementById('undo-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Score cleared for Ava Test');
    executeUndo();
    expect(getPointsScore(CID, 's1', 'q1')).toBe(8);
    expect(document.getElementById('undo-toast')).toBeNull();
  });

  it('closes the toast when Cmd+Z undoes the clear', () => {
    mount(seed, { course: CID });
    const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
    cell.dispatchEvent(new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true }));
    click(document.querySelector('[data-ctx="clearCell"]'));
    key(document.body, 'z', { metaKey: true });
    expect(getPointsScore(CID, 's1', 'q1')).toBe(8);
    expect(document.getElementById('undo-toast')).toBeNull();
  });

  it('shows no toast when the cell had no score', () => {
    mount(
      () => {
        seed();
        _cache.scores[CID] = { s1: [] };
      },
      { course: CID },
    );
    const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
    cell.dispatchEvent(new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true }));
    click(document.querySelector('[data-ctx="clearCell"]'));
    expect(document.getElementById('undo-toast')).toBeNull();
  });
});

describe('Delete in the Competencies view', () => {
  it('shows an Undo toast, and its Undo puts the level back', () => {
    mount(seed, { course: CID });
    showCompetencies();
    const cell = document.querySelector('#gb-data td.gb-score[data-aid="l1"][data-sid="s1"][data-tid="T1"]');
    expect(cell).not.toBeNull();
    cell.focus();
    cell.classList.add('gb-focus');
    key(cell, 'Delete');
    expect(scoreOf('l1')).toBeUndefined();
    expect(document.getElementById('undo-toast').textContent).toContain('Score cleared for Ava Test');
    executeUndo();
    expect(scoreOf('l1').score).toBe(3);
  });
});
