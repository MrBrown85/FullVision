/**
 * The Scores view's column actions (Grade, Edit, Mark Blank Cells, Delete)
 * opened only on a right-click or double-click, with nothing to show they
 * were there, and the headers couldn't be reached with the keyboard (Nov 3
 * bug sweep, Step 4 group 2 #24). Each title now shows a ▾ and is a button
 * in one Tab stop: ← → move along the titles, and Return opens the menu.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, key, click } from './helpers/gradebook-dom.js';

const CID = 'cM';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const lab = { id: 'l1', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-11' };

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = [quiz, lab];
  _cache.scores[CID] = { s1: [], s2: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

const labels = () => Array.from(document.querySelectorAll('#gb-colheads .gb-grid-colhead-label'));
const labelFor = aid =>
  document.querySelector('#gb-colheads .gb-grid-colhead[data-aid="' + aid + '"] .gb-grid-colhead-label');

let realOpenGrader;
beforeEach(() => {
  realOpenGrader = PageAssignments.openGrader;
});
afterEach(() => {
  PageAssignments.openGrader = realOpenGrader;
  unmount();
});

describe('Scores column titles', () => {
  it('show a menu mark and are one Tab stop', () => {
    mount(seed, { course: CID });
    const all = labels();
    expect(all).toHaveLength(2);
    expect(all.map(l => l.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(all[0].getAttribute('role')).toBe('button');
    expect(all[0].getAttribute('aria-haspopup')).toBe('menu');
    expect(all[0].querySelector('.gb-colhead-menu-mark')).not.toBeNull();
  });

  it('move with the arrows', () => {
    mount(seed, { course: CID });
    const [first, second] = labels();
    first.focus();
    key(first, 'ArrowRight');
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(first.getAttribute('tabindex')).toBe('-1');
  });

  it('open the column menu with Return, and Escape gives the title the focus back', () => {
    mount(seed, { course: CID });
    const first = labels()[0];
    first.focus();
    key(first, 'Enter');
    const menu = document.querySelector('.gb-ctx-menu');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Grade This Assessment');
    key(menu, 'Escape');
    expect(document.querySelector('.gb-ctx-menu')).toBeNull();
    expect(document.activeElement).toBe(labels()[0]);
  });

  it('keep the focus through Mark Blank Cells Missing', () => {
    mount(seed, { course: CID });
    const quizLabel = labelFor('q1');
    quizLabel.focus();
    key(quizLabel, 'Enter');
    click(document.querySelector('[data-ctx="markUngradedNS"]'));
    expect(getAssignmentStatus(CID, 's1', 'q1')).toBe('NS');
    expect(document.activeElement).toBe(labelFor('q1'));
  });

  it('Grade This Assessment selects the first student’s cell when the grader closes', () => {
    let onClose = null;
    PageAssignments.openGrader = (cid, aid, sid, opts) => {
      onClose = opts.onClose;
    };
    mount(seed, { course: CID });
    const quizLabel = labelFor('q1');
    quizLabel.focus();
    key(quizLabel, 'Enter');
    click(document.querySelector('[data-ctx="scoreMode"]'));
    onClose();
    expect(document.activeElement.matches('.gb-scores-cell[data-aid="q1"][data-sid="s1"]')).toBe(true);
  });
});
