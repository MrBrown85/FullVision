/**
 * The menu on a student's name in the Gradebook
 * (teacher/gradebook-student-menu.js). A click on a name opened the
 * student's page; it now opens a menu, as a click on a column's title opens
 * the column's (Colin, Nov 25: "when I left-click a student in this list,
 * give options like 'set all to missing, set all to excused'").
 *
 * Mark Missing, Excuse and Clear act on the student's row: a blank cell is
 * one with no grade, whatever its date (Colin, Nov 25: "blank means no
 * grade"; a first rule of "due by today" passed over nearly every cell in a
 * class whose pieces were all due at the end of the term). Each line has its
 * count, and one use is undone by its toast, Cmd+Z or Undo Last Marking. The lists' keys and
 * placing are in e2e/gradebook-student-menu.spec.js, with the click itself:
 * linkedom has no capture phase, so the click that opens a menu here also
 * reaches the menu's own click-away and closes it. These tests open the menu
 * with a right-click, which opens the same one.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, click, key, fire } from './helpers/gradebook-dom.js';

const CID = 'cSM';
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// Every piece due at the end of the term, as in the class where the first rule failed.
const quiz = (id, title, date, categoryId) => ({
  id,
  title,
  scoreMode: 'points',
  maxPoints: 10,
  tagIds: ['T1'],
  date,
  dueDate: day(120),
  categoryId,
});

/* Ava: Quiz One scored; Essay, Quiz Two and Project blank (Project dated a
   month from now); Lab Missing; Poster Excused. */
function seed() {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.categories[CID] = [
    { id: 'cat-t', name: 'Tests', weight: 50 },
    { id: 'cat-p', name: 'Projects', weight: 50 },
  ];
  _cache.assessments[CID] = [
    quiz('q1', 'Quiz One', day(-70), 'cat-t'),
    quiz('e1', 'Essay', day(-65), 'cat-p'),
    quiz('q2', 'Quiz Two', day(-20), 'cat-t'),
    quiz('l1', 'Lab', day(-15), 'cat-p'),
    quiz('p1', 'Poster', day(-10), 'cat-p'),
    quiz('f1', 'Project', day(30), 'cat-p'),
  ];
  _cache.scores[CID] = {
    s1: [{ assessmentId: 'q1', tagId: 'T1', score: 8, date: day(-70), note: '' }],
    s2: [],
  };
  _cache.statuses[CID] = { 's1:l1': 'NS', 's1:p1': 'EXC' };
  _cache.courseConfigs[CID] = {};
}

afterEach(() => {
  unmount();
  delete COURSES[CID];
  delete _cache.categories[CID];
});

const nameOf = sid => document.querySelector('#gb-rowheads .gb-grid-rowhead-name[data-sid="' + sid + '"]');
const open = (sid = 's1') => {
  fire(nameOf(sid), 'contextmenu');
  return document.querySelector('.gb-ctx-menu');
};
// A list's lines as "label count".
const lines = sub =>
  Array.from(document.querySelectorAll('.gb-ctx-sub[data-sub="' + sub + '"] .gb-ctx-item')).map(el => {
    const hint = el.querySelector('.gb-ctx-hint');
    return el.querySelector('.gb-ctx-label').textContent + (hint ? ' ' + hint.textContent : '');
  });
const pick = (sub, label) =>
  click(
    Array.from(document.querySelectorAll('.gb-ctx-sub[data-sub="' + sub + '"] .gb-ctx-item')).find(
      el => el.querySelector('.gb-ctx-label').textContent === label,
    ),
  );
const statuses = () => Object.assign({}, getAssignmentStatuses(CID));

describe('a click on a student’s name', () => {
  it('is taken by the menu, so the page is not left', () => {
    mount(seed, { course: CID });
    expect(click(nameOf('s1')).defaultPrevented).toBe(true);
  });

  it('opens the name’s menu, each line with its icon', () => {
    mount(seed, { course: CID });
    open();
    const top = Array.from(document.querySelectorAll('.gb-ctx-menu > .gb-ctx-item')).map(
      el => el.querySelector('.gb-ctx-label').textContent,
    );
    expect(top).toEqual([
      'Open Student Page',
      'Show Only This Student',
      'Add Observation',
      'Copy Missing Work List',
      'Mark Missing',
      'Excuse',
      'Clear',
    ]);
    // Each line has its icon, as the cell's menu does.
    document.querySelectorAll('.gb-ctx-menu > .gb-ctx-item').forEach(el => {
      expect(el.querySelector('svg')).not.toBeNull();
    });
  });

  it('with Cmd, Ctrl or Shift is left to the link, which opens the page in a new tab', () => {
    mount(seed, { course: CID });
    const e = new document.defaultView.Event('click', { bubbles: true, cancelable: true });
    e.metaKey = true;
    nameOf('s1').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.querySelector('.gb-ctx-menu')).toBeNull();
  });

  it('a right-click opens it too, in place of the browser’s menu', () => {
    mount(seed, { course: CID });
    expect(fire(nameOf('s1'), 'contextmenu').defaultPrevented).toBe(true);
    expect(document.querySelector('.gb-ctx-menu')).not.toBeNull();
  });

  it('lights the student’s row while the menu is open, and lets it go after', () => {
    mount(seed, { course: CID });
    const menu = open();
    expect(nameOf('s1').closest('.gb-grid-rowhead').classList.contains('gb-col-menu')).toBe(true);
    expect(document.querySelector('#gb-data tr[data-sid="s1"]').classList.contains('gb-col-menu')).toBe(true);
    key(menu, 'Escape');
    expect(document.querySelector('.gb-ctx-menu')).toBeNull();
    expect(document.querySelector('.gb-col-menu')).toBeNull();
  });
});

describe('the lists say how many cells each line changes', () => {
  it('Mark Missing: every cell with no grade, whatever its dates, then a category and a month at a time', () => {
    mount(seed, { course: CID });
    open();
    const got = lines('missing');
    // Essay, Quiz Two and Project; not the scored quiz, the Missing lab or the Excused poster.
    expect(got.slice(0, 3)).toEqual(['All Blank Cells 3', 'In Tests 1', 'In Projects 2']);
    // A line a month, by the date under each column's title.
    const months = got.slice(3);
    expect(months.every(l => /^From [A-Z][a-z]+ [123]$/.test(l))).toBe(true);
    expect(months.reduce((n, l) => n + Number(l.split(' ').pop()), 0)).toBe(3);
  });

  it('a cell with something written on it and no grade is not blank', () => {
    mount(seed, { course: CID });
    _cache.scores[CID].s1.push({ assessmentId: 'e1', tagId: 'T1', score: 0, date: day(-65), note: 'See me.' });
    PageGradebook.render();
    open();
    expect(lines('missing')[0]).toBe('All Blank Cells 2');
  });

  it('Excuse: blank, Missing, or both', () => {
    mount(seed, { course: CID });
    open();
    expect(lines('excuse').slice(0, 5)).toEqual([
      'Blank Cells 3',
      'Missing Cells 1',
      'Blank and Missing Cells 4',
      'In Tests 1',
      'In Projects 3',
    ]);
  });

  it('Clear: every Missing, Excused or Late, greyed when there is none', () => {
    mount(seed, { course: CID });
    open();
    expect(lines('clear')).toEqual(['All Missing 1', 'All Excused 1', 'All Late']);
    const late = document.querySelectorAll('.gb-ctx-sub[data-sub="clear"] .gb-ctx-item')[2];
    expect(late.classList.contains('is-disabled')).toBe(true);
    expect(late.getAttribute('aria-disabled')).toBe('true');
  });

  it('a student with nothing to change gets greyed lines', () => {
    mount(seed, { course: CID });
    _cache.statuses[CID] = {
      's2:q1': 'EXC',
      's2:e1': 'EXC',
      's2:q2': 'EXC',
      's2:l1': 'EXC',
      's2:p1': 'EXC',
      's2:f1': 'EXC',
    };
    PageGradebook.render();
    open('s2');
    expect(lines('missing')).toEqual(['All Blank Cells']);
    click(document.querySelector('.gb-ctx-sub[data-sub="missing"] .gb-ctx-item'));
    expect(statuses()['s2:f1']).toBe('EXC');
    expect(document.querySelector('[data-ctx="copyMissing"]').classList.contains('is-disabled')).toBe(true);
  });
});

describe('a line of a list', () => {
  it('Mark Missing › All Blank Cells marks only those, with an Undo toast', () => {
    mount(seed, { course: CID });
    open();
    pick('missing', 'All Blank Cells');
    expect(statuses()).toEqual({ 's1:e1': 'NS', 's1:q2': 'NS', 's1:f1': 'NS', 's1:l1': 'NS', 's1:p1': 'EXC' });
    expect(getScores(CID).s1).toHaveLength(1);
    expect(document.getElementById('undo-toast').textContent).toContain('3 blank cells marked Missing for Ava Adams');
    expect(document.querySelector('.gb-ctx-menu')).toBeNull();
    // The grid shows them.
    expect(document.querySelector('#gb-data td[data-sid="s1"][data-aid="e1"]').textContent).toContain('M');
  });

  it('the toast’s Undo puts each cell back as it was', () => {
    mount(seed, { course: CID });
    open();
    pick('excuse', 'Blank and Missing Cells');
    expect(statuses()).toEqual({ 's1:e1': 'EXC', 's1:q2': 'EXC', 's1:f1': 'EXC', 's1:l1': 'EXC', 's1:p1': 'EXC' });
    expect(document.getElementById('undo-toast').textContent).toContain('4 cells marked Excused for Ava Adams');
    executeUndo();
    // The lab is Missing again, not blank; the poster was never touched.
    expect(statuses()).toEqual({ 's1:l1': 'NS', 's1:p1': 'EXC' });
  });

  it('Cmd+Z undoes it too', () => {
    mount(seed, { course: CID });
    open();
    pick('missing', 'In Tests');
    expect(statuses()['s1:q2']).toBe('NS');
    expect(statuses()['s1:e1']).toBeUndefined();
    key(document.body, 'z', { metaKey: true });
    expect(statuses()).toEqual({ 's1:l1': 'NS', 's1:p1': 'EXC' });
    expect(document.getElementById('undo-toast')).toBeNull();
  });

  it('Clear › All Missing takes Missing off the row', () => {
    mount(seed, { course: CID });
    open();
    pick('clear', 'All Missing');
    expect(statuses()).toEqual({ 's1:p1': 'EXC' });
    expect(document.getElementById('undo-toast').textContent).toContain('Missing cleared from 1 cell for Ava Adams');
  });

  it('an undo leaves a cell the teacher has changed since', () => {
    mount(seed, { course: CID });
    open();
    pick('missing', 'All Blank Cells');
    setAssignmentStatus(CID, 's1', 'e1', 'EXC');
    executeUndo();
    expect(statuses()).toEqual({ 's1:e1': 'EXC', 's1:l1': 'NS', 's1:p1': 'EXC' });
    expect(statuses()['s1:f1']).toBeUndefined();
  });
});

describe('Undo Last Marking', () => {
  it('is in the menu after a use, kept on this device, and puts the cells back', () => {
    mount(seed, { course: CID });
    expect(open().querySelector('[data-ctx="undoLast"]')).toBeNull();
    pick('missing', 'All Blank Cells');
    dismissUndoToast();
    // The page is drawn again from scratch, as on another visit.
    PageGradebook.destroy();
    PageGradebook.init({ course: CID });
    click(open().querySelector('[data-ctx="undoLast"]'));
    expect(statuses()).toEqual({ 's1:l1': 'NS', 's1:p1': 'EXC' });
    expect(open().querySelector('[data-ctx="undoLast"]')).toBeNull();
  });
});

describe('the lines for one student', () => {
  it('Show Only This Student leaves their row, and the same line shows everyone again', () => {
    mount(seed, { course: CID });
    click(open().querySelector('[data-ctx="showOnly"]'));
    expect(document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name')).toHaveLength(1);
    const again = open().querySelector('[data-ctx="showOnly"]');
    expect(again.querySelector('.gb-ctx-label').textContent).toBe('Show All Students');
    click(again);
    expect(document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name')).toHaveLength(2);
  });

  it('Copy Missing Work List says how many pieces it holds', () => {
    mount(seed, { course: CID });
    const copy = open().querySelector('[data-ctx="copyMissing"]');
    expect(copy.querySelector('.gb-ctx-hint').textContent).toBe('1');
    expect(copy.classList.contains('is-disabled')).toBe(false);
  });
});
