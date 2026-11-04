/**
 * DECISIONS, Gradebook sweep 4: the selected cell keeps the keyboard focus
 * through a redraw, the grader and the cell menu. After a cell-menu item,
 * Escape from Edit Score, or Done in a grader opened from Grade This
 * Assessment, focus fell to the page and a keyboard user had to Tab about
 * 26 times to get back (Nov 3 bug sweep, Step 4 group 2 #21).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, key, click } from './helpers/gradebook-dom.js';

const CID = 'cF';
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

const cellFor = sid => document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="' + sid + '"]');
const isCell = (el, sid) => !!el && el.matches && el.matches('.gb-scores-cell[data-aid="q1"][data-sid="' + sid + '"]');

let realOpenGrader;
beforeEach(() => {
  realOpenGrader = PageAssignments.openGrader;
});
afterEach(() => {
  PageAssignments.openGrader = realOpenGrader;
  unmount();
});

function openCellMenu(cell) {
  cell.classList.add('gb-focus');
  cell.focus();
  key(cell, 'F10', { shiftKey: true });
  return document.querySelector('.gb-ctx-menu');
}

describe('the selected cell keeps the focus', () => {
  it('after a cell-menu item', () => {
    mount(seed, { course: CID });
    const menu = openCellMenu(cellFor('s1'));
    click(menu.querySelector('[data-ctx="lateCell"]'));
    expect(getAssignmentStatus(CID, 's1', 'q1')).toBe('LATE');
    expect(isCell(document.activeElement, 's1')).toBe(true);
    expect(document.activeElement.classList.contains('gb-focus')).toBe(true);
  });

  it('after Clear Score', () => {
    mount(seed, { course: CID });
    const menu = openCellMenu(cellFor('s1'));
    click(menu.querySelector('[data-ctx="clearCell"]'));
    expect(isCell(document.activeElement, 's1')).toBe(true);
  });

  it('after Escape in Edit Score', () => {
    mount(seed, { course: CID });
    const menu = openCellMenu(cellFor('s1'));
    click(menu.querySelector('[data-ctx="editCell"]'));
    const inp = document.querySelector('.gb-scores-input');
    expect(inp).not.toBeNull();
    key(inp, 'Escape');
    expect(isCell(document.activeElement, 's1')).toBe(true);
  });

  it('after Tab saves Edit Score at the end of the row', () => {
    mount(seed, { course: CID });
    const menu = openCellMenu(cellFor('s1'));
    click(menu.querySelector('[data-ctx="editCell"]'));
    const inp = document.querySelector('.gb-scores-input');
    inp.value = '6';
    key(inp, 'Tab');
    expect(getPointsScore(CID, 's1', 'q1')).toBe(6);
    expect(isCell(document.activeElement, 's1')).toBe(true);
  });

  it('after Done in the grader', () => {
    let onClose = null;
    PageAssignments.openGrader = (cid, aid, sid, opts) => {
      onClose = opts.onClose;
    };
    mount(seed, { course: CID });
    const cell = cellFor('s1');
    cell.classList.add('gb-focus');
    cell.focus();
    key(cell, 'Enter');
    expect(onClose).toBeTypeOf('function');
    onClose();
    expect(isCell(document.activeElement, 's1')).toBe(true);
  });
});
