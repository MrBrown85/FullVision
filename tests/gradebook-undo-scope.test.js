/**
 * Cmd+Z in the gradebook (Nov 3 bug sweep, Gradebook group 1): the undo list
 * was never cleared and never checked, so Cmd+Z in one class changed a score
 * in another, and an old edit was put back over newer grading done in the
 * grader or on the Assignments page. Undo now acts only on the class on
 * screen, and leaves a cell that has changed since the edit.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const lab = { id: 'a1', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-10', type: 'summative' };
const level = (score, note) => ({ assessmentId: 'a1', tagId: 'T1', score, date: '2026-10-10', note: note || '' });

let stubDocument;
let win;

function seed(cid, score) {
  _cache.students[cid] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  _cache.assessments[cid] = [lab];
  _cache.scores[cid] = { s1: [level(score)] };
  _cache.statuses[cid] = {};
  _cache.courseConfigs[cid] = {};
}
const scoreIn = cid => (getScores(cid).s1 || []).map(e => e.score);

function open(cid) {
  if (globalThis.PageGradebook.destroy) PageGradebook.destroy();
  PageGradebook.init({ course: cid });
}
function clearScore() {
  const cell = document.querySelector('.gb-scores-cell[data-aid="a1"][data-sid="s1"]');
  const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  ev.clientX = 10;
  ev.clientY = 10;
  cell.dispatchEvent(ev);
  document.querySelector('[data-ctx="clearCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
}
function cmdZ() {
  const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = 'z';
  ev.metaKey = true;
  document.body.dispatchEvent(ev);
}

beforeEach(() => {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  // The slanted header measures its titles on a canvas.
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
  seed('cA', 3);
  seed('cB', 2);
});

afterEach(() => {
  PageGradebook.destroy();
  globalThis.document = stubDocument;
});

describe('Cmd+Z in the gradebook', () => {
  it('puts back a cleared score', () => {
    open('cA');
    clearScore();
    expect(scoreIn('cA')).toEqual([]);
    cmdZ();
    expect(scoreIn('cA')).toEqual([3]);
  });

  it('does nothing to another class', () => {
    open('cA');
    clearScore();
    open('cB');
    cmdZ();
    expect(scoreIn('cA')).toEqual([]);
    expect(scoreIn('cB')).toEqual([2]);
    // Back in Science 8 the edit can still be undone.
    open('cA');
    cmdZ();
    expect(scoreIn('cA')).toEqual([3]);
  });

  it('leaves a cell graded again since the edit', () => {
    open('cA');
    clearScore();
    // The grader, or the Assignments page, gives Ava a 4 with a comment.
    upsertScore('cA', 's1', 'a1', 'T1', 4, '2026-10-10', 'summative', 'Clear labels.');
    cmdZ();
    expect(scoreIn('cA')).toEqual([4]);
    expect(getScoreComment('cA', 's1', 'a1')).toBe('Clear labels.');
  });

  it('still undoes after a refresh brings back a cleared cell as an empty row', () => {
    open('cA');
    clearScore();
    // A class refresh gives the cleared cell back as a level row with no score.
    _cache.scores.cA.s1 = [level(0)];
    cmdZ();
    expect(scoreIn('cA')).toEqual([3]);
  });

  it('still undoes an older edit to another cell', () => {
    _cache.students.cA.push({ id: 's2', firstName: 'Ben', lastName: 'Test' });
    _cache.scores.cA.s2 = [level(2)];
    open('cA');
    const ben = document.querySelector('.gb-scores-cell[data-aid="a1"][data-sid="s2"]');
    const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
    ben.dispatchEvent(ev);
    document.querySelector('[data-ctx="clearCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(getScores('cA').s2).toEqual([]);
    cmdZ();
    expect(getScores('cA').s2.map(e => e.score)).toEqual([2]);
  });
});
