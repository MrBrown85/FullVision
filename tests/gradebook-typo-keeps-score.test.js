/**
 * A typo in a gradebook number box wiped the saved score (Nov 3 bug sweep,
 * Gradebook group 2). A number input reports a typo ("8..5", "7-", "1e",
 * any letter in Safari) as an empty value, so Edit Score and the
 * Competencies view's points box took it for a blank box and cleared the
 * score. The rule (the Assignments ledger's): blank clears, a typed 0 is a
 * score, a typo leaves the saved score.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cA';
const quiz = { id: 'qz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
const lab = { id: 'lv', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-09' };
const entry = (aid, score) => ({ assessmentId: aid, tagId: 'T1', score, date: '2026-10-10', note: '' });

let stubDocument;
let nodeEvent;
let win;

beforeEach(() => {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  // The slanted header measures its titles on a canvas; a number box
  // selects its text when it opens; a selected cell scrolls into view.
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
    return el;
  };
  win.HTMLElement.prototype.select = () => {};
  win.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.document = doc;
  nodeEvent = globalThis.Event;
  globalThis.Event = win.Event;
  globalThis.CSS = { escape: s => String(s) };
  globalThis.getComputedStyle = () => ({});
  PageAssignments.graderOpen = () => false;
  runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  _cache.assessments[CID] = [quiz, lab];
  _cache.scores[CID] = { s1: [entry('qz', 7), entry('lv', 3)] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  PageGradebook.init({ course: CID });
});

afterEach(() => {
  PageGradebook.destroy();
  globalThis.document = stubDocument;
  globalThis.Event = nodeEvent;
});

const scoreOf = aid => (getScores(CID).s1 || []).filter(e => e.assessmentId === aid).map(e => e.score);

// What the browser does with a typo in a number box: an empty value and
// validity.badInput.
function typeTypo(inp) {
  inp.value = '';
  Object.defineProperty(inp, 'validity', { value: { badInput: true } });
  inp.dispatchEvent(new win.Event('blur'));
}
function typeBlank(inp) {
  inp.value = '';
  Object.defineProperty(inp, 'validity', { value: { badInput: false } });
  inp.dispatchEvent(new win.Event('blur'));
}
function editScore(aid) {
  const cell = document.querySelector('.gb-scores-cell[data-aid="' + aid + '"][data-sid="s1"]');
  cell.dispatchEvent(new win.Event('contextmenu', { bubbles: true, cancelable: true }));
  document.querySelector('[data-ctx="editCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  return cell.querySelector('.gb-scores-input');
}
function pointsBox() {
  document.querySelector('[data-action="setView"][data-mode="detailed"]').click();
  const cell = document.querySelector('td.gb-score[data-aid="qz"][data-sid="s1"][data-pts="1"]');
  cell.classList.add('gb-focus');
  const key = new win.Event('keydown', { bubbles: true, cancelable: true });
  key.key = '8';
  document.body.dispatchEvent(key);
  return cell.querySelector('.gb-pts-input');
}

describe('a typo in a gradebook number box', () => {
  it('leaves a points score in Edit Score', () => {
    typeTypo(editScore('qz'));
    expect(scoreOf('qz')).toEqual([7]);
  });

  it('leaves a level in Edit Score', () => {
    typeTypo(editScore('lv'));
    expect(scoreOf('lv')).toEqual([3]);
  });

  it('leaves the score in the Competencies points box', () => {
    typeTypo(pointsBox());
    expect(scoreOf('qz')).toEqual([7]);
  });

  it('is not a blank box, which still clears', () => {
    typeBlank(editScore('qz'));
    expect(scoreOf('qz')).toEqual([]);
  });
});
