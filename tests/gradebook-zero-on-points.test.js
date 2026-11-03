/**
 * Typing 0 on a points cell in the Competencies view deleted the score
 * instead of entering 0 (Nov 3 bug sweep, Gradebook group 2). A blank
 * counts toward nothing and a 0 counts as 0%, so a student who earned 0
 * got a higher course %. On points work 0 is now typed like any other
 * digit; on a level it still clears, and Delete still clears both.
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
  document.querySelector('[data-action="setView"][data-mode="detailed"]').click();
});

afterEach(() => {
  PageGradebook.destroy();
  globalThis.document = stubDocument;
  globalThis.Event = nodeEvent;
});

const scoreOf = aid => (getScores(CID).s1 || []).filter(e => e.assessmentId === aid).map(e => e.score);
function press(selector, key) {
  const cell = document.querySelector(selector);
  cell.classList.add('gb-focus');
  const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = key;
  document.body.dispatchEvent(ev);
  return cell;
}
const PTS = 'td.gb-score[data-aid="qz"][data-sid="s1"][data-pts="1"]';

describe('typing 0 in the Competencies view', () => {
  it('opens the points box with 0 on points work, and saves a score of 0', () => {
    const cell = press(PTS, '0');
    const inp = cell.querySelector('.gb-pts-input');
    expect(inp).not.toBeNull();
    expect(inp.value).toBe('0');
    expect(scoreOf('qz')).toEqual([7]);
    inp.dispatchEvent(new win.Event('blur'));
    expect(scoreOf('qz')).toEqual([0]);
  });

  it('still clears a level', () => {
    press('td.gb-score[data-aid="lv"][data-sid="s1"][data-tid="T1"]', '0');
    expect(scoreOf('lv').filter(v => v > 0)).toEqual([]);
  });

  it('leaves Delete clearing a points score', () => {
    press(PTS, 'Delete');
    expect(scoreOf('qz')).toEqual([]);
  });
});
