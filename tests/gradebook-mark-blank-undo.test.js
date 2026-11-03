/**
 * Count Missing as Zero in the gradebook column menu (Nov 3 bug sweep, Step 4
 * group 1): it marked every blank cell Missing at once with no toast and no
 * count, and Cmd+Z did nothing, so the teacher could not tell which cells had
 * been blank. It is now Mark Blank Cells Missing / Excused; an Undo toast
 * gives the count, and the toast's Undo or Cmd+Z takes off just those marks.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const hw = {
  id: 'a1',
  title: 'Homework',
  scoreMode: 'proficiency',
  tagIds: ['T1'],
  date: '2026-10-10',
  type: 'summative',
};

let stubDocument;
let win;

function seed(cid) {
  _cache.students[cid] = [
    { id: 's1', firstName: 'Ava', lastName: 'Test' },
    { id: 's2', firstName: 'Ben', lastName: 'Test' },
    { id: 's3', firstName: 'Cara', lastName: 'Test' },
  ];
  _cache.assessments[cid] = [hw];
  _cache.scores[cid] = { s1: [{ assessmentId: 'a1', tagId: 'T1', score: 3, date: '2026-10-10', note: '' }] };
  _cache.statuses[cid] = {};
  _cache.courseConfigs[cid] = {};
}
const statuses = cid => ({ ...getAssignmentStatuses(cid) });

function open(cid) {
  if (globalThis.PageGradebook.destroy) PageGradebook.destroy();
  PageGradebook.init({ course: cid });
}
function menu(ctx) {
  const head = document.querySelector('.gb-grid-colhead[data-aid="a1"]');
  // The slanted titles find their column from the pointer position.
  head.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
  head.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
  const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  ev.clientX = 10;
  ev.clientY = 0;
  head.dispatchEvent(ev);
  const item = document.querySelector('[data-ctx="' + ctx + '"]');
  const text = item && item.textContent;
  if (item) item.dispatchEvent(new win.Event('click', { bubbles: true }));
  return text;
}
function cmdZ() {
  const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = 'z';
  ev.metaKey = true;
  document.body.dispatchEvent(ev);
}
const toastText = () => {
  const t = document.querySelector('#undo-toast span');
  return t ? t.textContent : null;
};

beforeEach(() => {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
    return el;
  };
  globalThis.document = doc;
  globalThis.CSS = { escape: s => String(s) };
  globalThis.getComputedStyle = () => ({});
  PageAssignments.graderOpen = () => false;
  runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  seed('cA');
  seed('cB');
});

afterEach(() => {
  dismissUndoToast();
  PageGradebook.destroy();
  globalThis.document = stubDocument;
});

describe('Mark Blank Cells Missing', () => {
  it('says it fills the blank cells', () => {
    open('cA');
    expect(menu('markUngradedNS')).toBe('Mark Blank Cells Missing');
    expect(menu('markUngradedEXC')).toBe('Mark Blank Cells Excused');
  });

  it('shows an Undo toast with the count, and its Undo takes the marks off', () => {
    open('cA');
    menu('markUngradedNS');
    expect(statuses('cA')).toEqual({ 's2:a1': 'NS', 's3:a1': 'NS' });
    expect(toastText()).toBe('2 blank cells marked Missing');
    executeUndo();
    expect(statuses('cA')).toEqual({});
    expect(toastText()).toBe(null);
    // Nothing is left for Undo Marking Blank Cells to take off.
    expect(menu('undoBulkStatus')).toBe(null);
  });

  it('is undone by Cmd+Z, which closes the toast', () => {
    open('cA');
    menu('markUngradedEXC');
    expect(toastText()).toBe('2 blank cells marked Excused');
    cmdZ();
    expect(statuses('cA')).toEqual({});
    expect(toastText()).toBe(null);
  });

  it('Cmd+Z does nothing in another class', () => {
    open('cA');
    menu('markUngradedNS');
    open('cB');
    cmdZ();
    expect(statuses('cA')).toEqual({ 's2:a1': 'NS', 's3:a1': 'NS' });
    open('cA');
    cmdZ();
    expect(statuses('cA')).toEqual({});
  });

  it('Cmd+Z leaves the marks once one of those cells has changed since', () => {
    open('cA');
    menu('markUngradedNS');
    dismissUndoToast();
    // Ben hands it in late: the teacher takes his Missing off and marks Late.
    const st = getAssignmentStatuses('cA');
    st['s2:a1'] = 'LATE';
    saveAssignmentStatuses('cA', st);
    cmdZ();
    expect(statuses('cA')).toEqual({ 's2:a1': 'LATE', 's3:a1': 'NS' });
  });

  it('Undo Marking Blank Cells still takes off every mark it set', () => {
    open('cA');
    menu('markUngradedNS');
    dismissUndoToast();
    expect(menu('undoBulkStatus')).toBe('Undo Marking Blank Cells');
    expect(statuses('cA')).toEqual({});
  });
});
